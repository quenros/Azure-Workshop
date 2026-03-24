#!/bin/bash

# Start Flask backend in the background using threads
echo "Starting Flask Backend"
cd backend
gunicorn --timeout 600 --threads 4 --workers 1 --bind 0.0.0.0:$FLASK_PORT app:app &
cd ..

# Start Next.js frontend in the foreground
echo "Starting Next.js Frontend"
cd frontend
npm run start