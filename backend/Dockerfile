# Use slim Python image
FROM python:3.11-slim AS base

WORKDIR /app

# Install curl and uv
RUN apt-get update && apt-get install -y curl && pip install --no-cache-dir uv

# Copy dependency files from root (where pyproject.toml & uv.lock are)
COPY ./pyproject.toml ./uv.lock ./

# Install dependencies (production only)
RUN uv sync --no-dev --frozen

# Copy backend source code
COPY ./backend /app/backend

# Set env vars
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Run FastAPI
CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
