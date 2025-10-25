#!/bin/bash
set -e

echo "Starting FastAPI server immediately..."
uv run uvicorn backend.main:app --host 0.0.0.0 --port 8000 --no-access-log --log-level warning &
SERVER_PID=$!

echo "Server started with PID $SERVER_PID, now running migrations..."

# Run migrations
uv run alembic -c /app/alembic.ini upgrade head

echo "Migrations complete, running data loader..."

# Run data loader
uv run python /app/backend/db/data_loader.py

echo "Data loader complete, waiting for server..."

# Wait for the server process
wait $SERVER_PID