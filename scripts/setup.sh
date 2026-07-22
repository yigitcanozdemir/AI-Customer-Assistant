#!/bin/bash
set -a # automatically export all variables
if [ -f .env.prod ]; then
    source .env.prod
else
    echo "❌ .env.prod not found!"
    exit 1
fi
set +a

echo "🔧 Setting up the application..."

echo "🔨 Building Docker containers..."
docker compose -f docker-compose.prod.yml build --no-cache

echo "▶️  Starting services..."
docker compose -f docker-compose.prod.yml up -d

echo "⏳ Waiting for services to be ready..."
sleep 15

echo "🗄️  Running database migrations..."
docker compose -f docker-compose.prod.yml exec -T fastapi alembic upgrade head

echo "📊 Loading initial data..."
if [ -n "${DATA_DIR:-}" ]; then
    echo "   Using custom catalog directory: ${DATA_DIR}"
    docker compose -f docker-compose.prod.yml exec -T fastapi python backend/db/data_loader.py --data-dir "$DATA_DIR"
else
    docker compose -f docker-compose.prod.yml exec -T fastapi python backend/db/data_loader.py
fi

echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Link domain in NPM: https://api.yigitcanozdemir.com"
echo "   2. Update Vercel with: https://api.yigitcanozdemir.com"
