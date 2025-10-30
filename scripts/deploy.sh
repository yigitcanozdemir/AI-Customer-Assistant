#!/bin/bash
set -e

echo "🚀 Deploying application..."

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "❌ .env.production not found!"
    exit 1
fi

# Stop existing containers
echo "⏹️  Stopping containers..."
docker-compose -f docker-compose.prod.yml down

# Clean up
echo "🧹 Cleaning up..."
docker system prune -f

# Build new image
echo "🔨 Building new image..."
docker-compose -f docker-compose.prod.yml build --no-cache

# Start services
echo "▶️  Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait and check health
echo "⏳ Waiting for services..."
sleep 15

MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:8000/health > /dev/null 2>&1; then
        echo "✅ Deployment successful!"
        docker-compose -f docker-compose.prod.yml ps
        exit 0
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "⏳ Waiting... (attempt $RETRY_COUNT/$MAX_RETRIES)"
        sleep 5
    fi
done

echo "❌ Deployment failed!"
docker-compose -f docker-compose.prod.yml logs --tail=50
exit 1