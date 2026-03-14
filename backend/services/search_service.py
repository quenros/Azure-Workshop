import uuid
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SimpleField,
    SearchableField,
    SearchFieldDataType
)

class SearchService:
    def __init__(self, endpoint, api_key, index_name):
        self.endpoint = endpoint
        self.api_key = api_key
        self.index_name = index_name
        self.credential = AzureKeyCredential(api_key)
        
        # 1. Initialize the Index Client (used to CREATE/MANAGE the index)
        self.index_client = SearchIndexClient(
            endpoint=endpoint,
            credential=self.credential
        )

        # 2. Check and Create the Index if missing
        self._ensure_index_exists()
        
        # 3. Initialize the Search Client (used to PUSH/QUERY data)
        self.search_client = SearchClient(
            endpoint=endpoint, 
            index_name=index_name, 
            credential=self.credential
        )

    def _ensure_index_exists(self):
        """
        Checks if the configured index exists on the Azure service. 
        If it doesn't, it creates it programmatically.
        """
        try:
            self.index_client.get_index(self.index_name)
            print(f"Search Setup: Index '{self.index_name}' already exists.")
        except Exception:
            print(f"Search Setup: Index '{self.index_name}' not found. Creating it now...")
            index_schema = SearchIndex(
                name=self.index_name,
                fields=[
                    SimpleField(name="id", type=SearchFieldDataType.String, key=True),
                    # filterable=True is REQUIRED here so we can delete by filename later!
                    SearchableField(name="filename", type=SearchFieldDataType.String, filterable=True),
                    SearchableField(name="content", type=SearchFieldDataType.String),
                    SimpleField(name="url", type=SearchFieldDataType.String, filterable=True)
                ]
            )
            try:
                self.index_client.create_index(index_schema)
                print(f"Search Setup: Index '{self.index_name}' successfully created!")
            except Exception as e:
                 print(f"Search Setup: Critical error creating index '{self.index_name}': {e}")

    def index_document(self, filename, content, url):
        """
        Pushes a single document's text into the search index.
        """
        document = {
            "id": str(uuid.uuid4()), # Use a standard UUID for Azure's internal ID
            "filename": filename,
            "content": content,
            "url": url
        }
        
        try:
            result = self.search_client.upload_documents(documents=[document])
            if not result[0].succeeded:
                print(f"Azure Search Error for {filename}: {result[0].error_message}")
            return result[0].succeeded
        except Exception as e:
            print(f"Failed to index {filename}: {e}")
            return False

    def search(self, query, top_k=3, score_threshold=3):
        """
        Searches the index for the user's query and returns the top matches.
        Uses BM25 Keyword Search and filters out weak matches using a score threshold.
        """
        try:
            results = self.search_client.search(
                search_text=query, 
                select=["content", "filename", "url"], 
                top=top_k
            )
            
            formatted_results = []
            print(f"Keyword search index '{self.index_name}' for '{query}'")
            
            for result in results:
                score = result.get('@search.score', 0)
                filename = result.get('filename', 'Unknown')
                
                print(f"Found doc '{filename}' with score: {score}")
                
                # Filter out bad matches based on the threshold
                if score >= score_threshold:
                    formatted_results.append({
                        "filename": filename,
                        "content": result.get("content"),
                        "url": result.get("url"),
                        "score": score
                    })
                else:
                    print(f"Keyword Doc '{filename}' skipped due to low score ({score} < {score_threshold}).")
                    
            return formatted_results
            
        except Exception as e:
            print(f"Search failed: {e}")
            return []

    def delete_document(self, filename):
        """
        Deletes all indexed documents associated with a specific filename.
        Adapted from delete_embeddings_function logic.
        """
        try:
            # Step 1: Query the index to find all documents with this filename
            search_result = self.search_client.search(filter=f"filename eq '{filename}'")
            
            # Step 2: Collect their internal IDs
            ids_to_delete = []
            for result in search_result:
                ids_to_delete.append({'id': result['id']})
            
            # Step 3: Delete them if any were found
            if len(ids_to_delete) > 0:
                self.search_client.delete_documents(ids_to_delete)
                print(f"Successfully deleted {len(ids_to_delete)} document(s) for '{filename}' from AI Search.")
                return True
            else:
                print(f"No indexed documents found for '{filename}'.")
                return True # Still return True because the end goal (it not being there) is met
                
        except Exception as e:
            print(f"An error occurred while deleting '{filename}' from index: {e}")
            return False