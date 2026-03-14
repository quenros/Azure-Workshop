from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
import os
from dotenv import load_dotenv
import uuid
import requests
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient

# Import our custom modules
from services.blob_service import BlobStorageService
from services.search_service import SearchService
from services.document_processor import DocumentProcessor
from utils.file_validator import FileValidator

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Initialize services
blob_service = BlobStorageService(
    connection_string=os.getenv('AZURE_STORAGE_CONNECTION_STRING'),
    container_name=os.getenv('BLOB_CONTAINER_NAME', 'uploads')
)

blob_service_videos = BlobStorageService(
    connection_string=os.getenv('AZURE_STORAGE_CONNECTION_STRING'),
    container_name='videos'
)

search_service = SearchService(
    endpoint=os.getenv('AI_SEARCH_ENDPOINT'),
    api_key=os.getenv('AI_SEARCH_KEY'),
    index_name=os.getenv('AI_SEARCH_INDEX_NAME', 'documents-index')
)

document_processor = DocumentProcessor()
file_validator = FileValidator()

# Centralized Azure Backend URL
ASKNARELLE_API_URL = "https://asknarelle-portal.azurewebsites.net"

# ============================================
# HEALTH CHECK
# ============================================
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()}), 200

# ============================================
# FILE ENDPOINTS
# ============================================
@app.route('/api/files', methods=['GET'])
def get_files():
    """Get all uploaded files directly from BOTH Azure Blob Storage containers"""
    try:
        # Fetch from documents container
        blobs = blob_service.list_files()
        
        # Fetch from videos container and merge
        try:
            video_blobs = blob_service_videos.list_files()
            blobs.extend(video_blobs)
        except Exception as e:
            app.logger.warning(f"Could not fetch from videos container (it might be empty/missing): {e}")

        formatted_files = []
        for blob in blobs:
            file_type = file_validator.get_file_type(blob['name'])
            formatted_files.append({
                "id": blob['name'],  
                "name": blob['name'],
                "type": file_type,
                "date": blob['date'],
                "status": "COMPLETED", 
                "url": blob['url']
            })
            
        return jsonify(formatted_files), 200
    except Exception as e:
        app.logger.error(f"Error fetching files: {str(e)}")
        return jsonify({'error': 'Failed to fetch files'}), 500


@app.route('/api/files', methods=['POST'])
def upload_files():
    # ... (Keep your existing upload_files logic exactly the same, as it handles documents)
    try:
        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400
        
        files = request.files.getlist('files')
        container_name = os.getenv('BLOB_CONTAINER_NAME', 'uploads')
        
        upload_success = blob_service.upload_to_azure_blob_storage(container_name, files)
        if not upload_success:
            return jsonify({'error': 'Blob upload failed'}), 500

        uploaded_metadata = []
        for file in files:
            file_id = file.filename
            file_type = file_validator.get_file_type(file.filename)
            
            if file_type == 'document':
                extracted_text = document_processor.extract_text(file, file.filename)
                storage_account_name = blob_service.blob_service_client.account_name
                blob_url = f"https://{storage_account_name}.blob.core.windows.net/{container_name}/{file.filename}"

                if extracted_text:
                    index_success = search_service.index_document(
                        filename=file.filename, content=extracted_text, url=blob_url
                    )
                    if not index_success:
                        raise Exception(f"Failed to push {file.filename} to Azure AI Search.")
                else:
                    raise Exception(f"Could not extract any text from {file.filename}.")

            uploaded_metadata.append({
                "id": file_id, "name": file.filename, "type": file_type, "status": "COMPLETED"
            })

        return jsonify({'uploaded': uploaded_metadata}), 200
    except Exception as e:
        app.logger.error(f"Upload error: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/files/<path:file_id>', methods=['DELETE'])
def delete_file(file_id):
    """Delete a file from the correct blob container and its associated search index"""
    try:
        file_type = file_validator.get_file_type(file_id)
        
        # 1. Delete physical file from the correct Blob container
        if file_type == 'video':
            blob_deleted = blob_service_videos.delete_file(file_id)
            # Determine the transcript filename we need to hunt down in AI Search
            base_name = os.path.splitext(file_id)[0]
            target_search_filename = f"{base_name}_transcript.txt"
        else:
            blob_deleted = blob_service.delete_file(file_id)
            target_search_filename = file_id 
            
        if not blob_deleted:
             return jsonify({'error': 'Failed to delete from storage or file not found'}), 404
             
        # Query-Then-Delete from Azure AI Search
        try:
            search_endpoint = os.environ.get("AI_SEARCH_ENDPOINT")
            search_key = os.environ.get("AI_SEARCH_KEY")
            index_name = os.environ.get("AI_SEARCH_INDEX_NAME", "documents-index")
            
            search_client = SearchClient(
                endpoint=search_endpoint,
                index_name=index_name,
                credential=AzureKeyCredential(search_key)
            )

            # Query the index for any documents matching our exact filename
            # Note: Your Azure Search Index must have the 'filename' field set as 'Filterable' for this to work!
            results = search_client.search(
                search_text="*",
                filter=f"filename eq '{target_search_filename}'",
                select="id"
            )

            # Extract the random UUIDs Azure generated when we uploaded them
            docs_to_delete = [{"id": result["id"]} for result in results]

            if docs_to_delete:
                # Issue the batch delete command using the UUIDs
                search_client.delete_documents(documents=docs_to_delete)
                app.logger.info(f"Deleted {len(docs_to_delete)} search index entries for {target_search_filename}")
            else:
                app.logger.warning(f"No search index entry found to clean up for {target_search_filename}")

        except Exception as search_err:
            app.logger.error(f"Search index cleanup failed for {target_search_filename}: {search_err}")
            # We don't fail the whole API call here, because the physical file was successfully deleted.

        return jsonify({'message': 'File and transcript deleted successfully', 'id': file_id}), 200
        
    except Exception as e:
        app.logger.error(f"Error deleting file {file_id}: {str(e)}")
        return jsonify({'error': 'Failed to delete file', 'details': str(e)}), 500


# ============================================
# LOCAL VIDEO BLOB SAVE ENDPOINT
# ============================================
@app.route('/api/local/save_video_blob', methods=['POST'])
def save_video_blob():
    """Receives the original MP4 and saves it permanently to the 'videos' blob container."""
    try:
        if 'video' not in request.files:
            return jsonify({'error': 'No video provided'}), 400
        
        # We use getlist because upload_to_azure_blob_storage expects an iterable
        videos = request.files.getlist('video')
        
        upload_success = blob_service_videos.upload_to_azure_blob_storage('videos', videos)
        
        if upload_success:
            return jsonify({'message': 'Video saved to blob storage successfully'}), 200
        return jsonify({'error': 'Blob upload failed'}), 500
        
    except Exception as e:
        app.logger.error(f"Failed to save video to blob: {str(e)}")
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

# ============================================
# CHAT ENDPOINT
# ============================================

@app.route('/api/chat', methods=['POST'])
def chat():
    """Chat with the knowledge base via AskNarelle Microservice"""
    try:
        data = request.get_json()
        
        if not data or 'message' not in data:
            return jsonify({'error': 'Message is required'}), 400
        
        user_message = data['message']
        
        # Local Retrieval
        search_results = search_service.search(query=user_message, top_k=3, score_threshold=3)
        
        if search_results:
            context = "\n\n".join([
                f"[Document Source: {result['filename']}]\nContent: {result['content'][:]}" 
                for result in search_results
            ])
            
            payload = {
                "question": user_message,
                "documents": context
            }
            
            try:
                # Use the refactored base URL
                response = requests.post(f"{ASKNARELLE_API_URL}/api/processdocument", json=payload, timeout=30)
                response.raise_for_status()
                llm_answer = response.json().get('answer', "Error generating response.")
                
            except Exception as api_error:
                app.logger.error(f"AskNarelle API failed: {str(api_error)}")
                llm_answer = f"**[AI Generation offline. Showing raw extracts]**\n\n{context}"
            
            return jsonify({
                'answer': llm_answer,
                'source': 'documents',
                'sources': [
                    {
                        'title': result['filename'],
                        'url': result.get('url', '')
                    }
                    for result in search_results
                ]
            }), 200
            
        else:
            return jsonify({
                'answer': "I couldn't find any highly relevant information in your uploaded documents. Please try rephrasing or upload more files.",
                'source': 'documents',
                'sources': []
            }), 200
        
    except Exception as e:
        app.logger.error(f"Error in chat endpoint: {str(e)}")
        return jsonify({'error': 'Chat failed', 'details': str(e)}), 500


# ============================================
# PROXY ENDPOINTS FOR AZURE VIDEO INDEXER
# ============================================

@app.route('/api/local/video/upload', methods=['POST'])
def proxy_video_upload():
    """Proxies the video upload from the local React frontend to the Central Azure server."""
    if 'video' not in request.files:
        return jsonify({"error": "No video file provided"}), 400
        
    video_file = request.files['video']
    session_id = request.form.get('session_id', 'unknown')
    
    # Package the file and data to forward to Azure
    files = {'video': (video_file.filename, video_file.stream, video_file.content_type)}
    data = {'session_id': session_id}
    
    try:
        response = requests.post(
            f"{ASKNARELLE_API_URL}/api/workshop/video/upload",
            files=files,
            data=data,
            timeout=600 
        )
        
        if not response.ok:
            app.logger.error(f"Azure Upload Failed: {response.status_code} - {response.text}")
            return jsonify({"error": "Upstream Azure error", "details": response.text}), response.status_code
            
        return jsonify(response.json()), 202
        
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Proxy network failure to Azure: {str(e)}")
        return jsonify({"error": "Failed to reach central server", "details": str(e)}), 500


@app.route('/api/local/video/status/<tagged_name>', methods=['GET'])
def proxy_video_status(tagged_name):
    """Proxies the status check from the React frontend to the Central Azure server."""
    try:
        response = requests.get(f"{ASKNARELLE_API_URL}/api/workshop/video/status/{tagged_name}")
        
        if not response.ok:
            app.logger.error(f"Azure Status Failed: {response.status_code} - {response.text}")
            return jsonify({"error": "Upstream Azure error", "details": response.text}), response.status_code
            
        return jsonify(response.json()), 200
        
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Proxy network failure to Azure: {str(e)}")
        return jsonify({"error": "Failed to reach central server", "details": str(e)}), 500


# ============================================
# LOCAL TRANSCRIPT INDEXING ENDPOINT
# ============================================

@app.route('/api/local/index_transcript', methods=['POST'])
def index_transcript():
    """
    Receives the cleaned transcript from the React frontend and pushes it 
    into the local Azure AI Search index so it can be queried by the RAG chatbot.
    """
    try:
        data = request.get_json()
        
        if not data or 'filename' not in data or 'content' not in data:
            return jsonify({"error": "Missing filename or content"}), 400
            
        original_filename = data['filename']
        transcript_content = data['content']
        
        base_name = os.path.splitext(original_filename)[0]
        document_title = f"{base_name}_transcript.txt"

        search_endpoint = os.environ.get("AI_SEARCH_ENDPOINT")
        search_key = os.environ.get("AI_SEARCH_KEY")
        index_name = os.environ.get("AI_SEARCH_INDEX_NAME", "documents-index")
        
        search_client = SearchClient(
            endpoint=search_endpoint,
            index_name=index_name,
            credential=AzureKeyCredential(search_key)
        )

        document = {
            "id": str(uuid.uuid4()),            
            "filename": document_title,         
            "content": transcript_content       
        }

        result = search_client.upload_documents(documents=[document])
        
        if result[0].succeeded:
            app.logger.info(f"Successfully indexed transcript for {original_filename}")
            return jsonify({
                "message": "Transcript indexed successfully", 
                "filename": document_title
            }), 200
        else:
            return jsonify({"error": "Azure Search rejected the document"}), 500

    except Exception as e:
        app.logger.error(f"Failed to index transcript: {str(e)}")
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

@app.route('/api/chat/history', methods=['GET'])
def get_chat_history():
    """Get chat history (placeholder for now)"""
    return jsonify({'history': []}), 200

# ============================================
# ERROR HANDLERS
# ============================================
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

# ============================================
# RUN APP
# ============================================
if __name__ == "__main__":
    required_vars = [
        'AZURE_STORAGE_CONNECTION_STRING',
        'AI_SEARCH_ENDPOINT',
        'AI_SEARCH_KEY'
    ]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        app.logger.warning(f"Missing environment variables: {', '.join(missing_vars)}")
        app.logger.warning("Some features may not work correctly")
    
    app.run(debug=True, host='0.0.0.0', port=5000)