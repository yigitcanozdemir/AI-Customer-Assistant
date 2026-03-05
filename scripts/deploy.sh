#!/bin/bash
set -a # automatically export all variables
if [ -f .env.production ]; then
    source .env.production
else
    echo "❌ .env.production not found!"
    exit 1
fi
set +a

set -e

echo "🚀 Deploying application..."

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "⏹️  Stopping containers..."
docker stop fastapi 2>/dev/null || true
docker rm fastapi 2>/dev/null || true

echo "🧹 Cleaning up..."
docker system prune -f

echo "🔨 Building new image..."
docker compose -f docker-compose.prod.yml build --no-cache fastapi

echo "▶️  Starting services..."
docker compose -f docker-compose.prod.yml up -d

echo "⏳ Waiting for services..."
sleep 30 

MAX_RETRIES=5
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker exec fastapi curl -f http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Deployment successful!${NC}"
        echo ""
        echo "📊 Service Status:"
        docker compose -f docker-compose.prod.yml ps
        echo ""
        echo "🌐 API: https://api.yigitcanozdemir.com"
        exit 0
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "⏳ Waiting... (attempt $RETRY_COUNT/$MAX_RETRIES)"
        sleep 5
    fi
done

echo -e "${RED}❌ Deployment failed!${NC}"
echo "📋 Error logs:"
docker compose -f docker-compose.prod.yml logs --tail=50 fastapi
exit 1