#!/bin/bash
set -e

echo "🔧 Setting up the application..."

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ .env.production not found!"
    echo "Please create .env.production with your environment variables"
    exit 1
fi

# Build containers
echo "🔨 Building Docker containers..."
docker-compose -f docker-compose.prod.yml build --no-cache

# Start services
echo "▶️  Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for database
echo "⏳ Waiting for services to be ready..."
sleep 10

# Run migrations
echo "🗄️  Running database migrations..."
docker-compose -f docker-compose.prod.yml exec -T fastapi alembic upgrade head

# Load initial data
echo "📊 Loading initial data..."
docker-compose -f docker-compose.prod.yml exec -T fastapi python backend/db/data_loader.py

echo "✅ Setup complete!"
echo ""
echo "🌐 Your API will be available at: https://api.yigitcanozdemir.com" # Change this with your api domain!
echo "📝 Don't forget to:"
echo "   1. Get SSL certificate: ./scripts/get-ssl.sh"
echo "   2. Update Vercel env vars with your API URL"