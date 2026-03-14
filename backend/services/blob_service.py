from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
from datetime import datetime, timedelta

class BlobStorageService:
    def __init__(self, connection_string, container_name):
        self.blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        self.container_name = container_name.lower()
        self.container_client = self.blob_service_client.get_container_client(self.container_name)
        
        self._ensure_container_exists()

    def _ensure_container_exists(self):
        try:
            if not self.container_client.exists():
                print(f"Blob Setup: Container '{self.container_name}' not found. Creating it now...")
                self.container_client.create_container()
                print(f"Blob Setup: Container '{self.container_name}' successfully created!")
            else:
                print(f"Blob Setup: Container '{self.container_name}' already exists.")
        except Exception as e:
            print(f"Blob Setup: Critical error creating container '{self.container_name}': {e}")

    def upload_to_azure_blob_storage(self, containerName, files):
        try:
            for file in files:
                blob_client_direct = self.container_client.get_blob_client(file.filename)
                file.seek(0) 
                blob_client_direct.upload_blob(file, overwrite=True, connection_timeout=600)
            return True
        except Exception as error:
            print(f"Error uploading file: {error}")
            return False

    def delete_file(self, blob_name):
        try:
            blob_client = self.container_client.get_blob_client(blob_name)
            blob_client.delete_blob()
            return True
        except Exception as e:
            print(f"Failed to delete {blob_name}: {e}")
            return False

    def list_files(self):
        """
        Lists all blobs in the container and generates a SAS URL for each.
        """
        files = []
        try:
            blobs = self.container_client.list_blobs()
            for blob in blobs:
                # Generate a 1-hour SAS token for secure viewing 
                sas_token = generate_blob_sas(
                    account_name=self.blob_service_client.account_name,
                    container_name=self.container_name,
                    blob_name=blob.name,
                    account_key=self.blob_service_client.credential.account_key,
                    permission=BlobSasPermissions(read=True),
                    expiry=datetime.utcnow() + timedelta(hours=1)
                )
                
                # Construct the full URL
                blob_url = (
                    f"https://{self.blob_service_client.account_name}.blob.core.windows.net/"
                    f"{self.container_name}/{blob.name}?{sas_token}"
                )
                
                files.append({
                    "name": blob.name,
                    # Fallback to current time if creation_time is missing
                    "date": blob.creation_time.strftime('%Y-%m-%d') if blob.creation_time else datetime.utcnow().strftime('%Y-%m-%d'),
                    "url": blob_url
                })
            return files
            
        except Exception as e:
            print(f"Error listing blobs: {e}")
            return []