#!/bin/bash
set -e

echo "🚀 Starting deployment to AWS..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}❌ .env.production not found!${NC}"
    exit 1
fi

# Stop existing containers
echo "⏹️  Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down || true

# Remove old images to save space
echo "🧹 Cleaning up old images..."
docker system prune -f

# Build new image
echo "🔨 Building new image..."
docker-compose -f docker-compose.prod.yml build --no-cache fastapi

# Start services
echo "▶️  Starting services..."
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 15

# Check if FastAPI is running
MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Deployment successful!${NC}"
        echo ""
        echo "📊 Service Status:"
        docker-compose -f docker-compose.prod.yml ps
        echo ""
        echo "📋 Recent logs:"
        docker-compose -f docker-compose.prod.yml logs --tail=30 fastapi
        exit 0
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "⏳ Waiting for API to be ready... (attempt $RETRY_COUNT/$MAX_RETRIES)"
        sleep 5
    fi
done

echo -e "${RED}❌ Deployment failed - API health check failed${NC}"
echo "📋 Error logs:"
docker-compose -f docker-compose.prod.yml logs --tail=100 fastapi
exit 1