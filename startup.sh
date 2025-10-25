#!/bin/bash
set -e

echo "Running Alembic migrations..."
uv run alembic -c /app/alembic.ini upgrade head

echo "Running data loader..."
uv run python /app/backend/db/data_loader.py

echo "Starting FastAPI server..."
uv run uvicorn backend.main:app --host 0.0.0.0 --port 8000 --no-access-log --log-level warning
