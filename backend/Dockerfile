# Use slim Python image
FROM python:3.11-slim AS base

WORKDIR /app

# Install curl and uv in a separate layer (cached)
RUN apt-get update && apt-get install -y curl && \
    pip install --no-cache-dir uv && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy ONLY dependency files first (this layer is cached unless deps change)
COPY ./pyproject.toml ./uv.lock ./

# Install dependencies - this layer is cached unless pyproject.toml or uv.lock changes
RUN uv sync --no-dev --frozen

# Copy backend source code LAST (this changes most often)
COPY ./backend /app/backend

# Set env vars
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Run FastAPI
CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-level", "warning"]
