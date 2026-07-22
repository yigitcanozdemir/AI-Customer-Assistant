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

# Copy backend source code + alembic config LAST (these change most often)
COPY ./alembic.ini /app/alembic.ini
COPY ./backend /app/backend

# Set env vars
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Apply DB migrations, then start FastAPI. Running migrations on boot means a
# fresh `docker compose up` produces a ready-to-use schema with no extra step.
CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-access-log --log-level warning"]
