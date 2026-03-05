#!/bin/bash
set -e

echo "🔧 Setting up the application..."

if [ ! -f .env.production ]; then
    echo "❌ .env.production not found!"
    echo "Please create .env.production with your environment variables"
    exit 1
fi

echo "🔨 Building Docker containers..."
docker compose -f docker-compose.prod.yml build --no-cache

echo "▶️  Starting services..."
docker compose -f docker-compose.prod.yml up -d

echo "⏳ Waiting for services to be ready..."
sleep 10

echo "🗄️  Running database migrations..."
docker compose -f docker-compose.prod.yml exec -T fastapi alembic upgrade head

echo "📊 Loading initial data..."
docker compose -f docker-compose.prod.yml exec -T fastapi python backend/db/data_loader.py

echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Get SSL certificate: ./scripts/get-ssl.sh"
echo "   2. Update Vercel with: https://api.yigitcanozdemir.com"