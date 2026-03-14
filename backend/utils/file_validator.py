import os
from pathlib import Path

class FileValidator:
    def __init__(self):
        # Define supported extensions for the workshop prototype
        self.doc_extensions = {'.pdf', '.docx', '.pptx', '.txt', '.csv', '.xlsx'}
        self.video_extensions = {'.mp4', '.mov', '.mkv', '.webm', '.avi'}

    def get_file_type(self, filename):
        """
        Determines if a file is a document or a video based on its extension.
        """
        if not filename:
            return 'unknown'
            
        ext = Path(filename).suffix.lower()
        
        if ext in self.doc_extensions:
            return 'document'
        if ext in self.video_extensions:
            return 'video'
            
        return 'unknown'

    def validate(self, file):
        """
        Basic validation to ensure the file is not empty and has a supported extension.
        """
        if not file or file.filename == '':
            return {'valid': False, 'error': 'No file selected'}
            
        file_type = self.get_file_type(file.filename)
        if file_type == 'unknown':
            return {'valid': False, 'error': f'Unsupported file type: {Path(file.filename).suffix}'}
            
        return {'valid': True, 'error': None}