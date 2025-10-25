#!/bin/bash
set -e

echo "Running Alembic migrations..."
uv run alembic -c /app/alembic.ini upgrade head

echo "Starting FastAPI server..."
exec uv run uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log --log-level warning
