#!/bin/bash
set -e


GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

MODE=${1:---full}

echo "🔄 Backend Update Script"
echo "Mode: $MODE"
echo ""

echo "💾 Creating backup..."
docker-compose -f docker-compose.prod.yml logs fastapi > "backup-$(date +%Y%m%d-%H%M%S).log"

echo "📥 Pulling latest code from Git..."
git fetch origin
git pull origin main

CHANGES=$(git diff HEAD@{1} HEAD --name-only)
echo -e "${YELLOW}Changed files:${NC}"
echo "$CHANGES"
echo ""

REBUILD_NEEDED=false
if echo "$CHANGES" | grep -q "pyproject.toml\|uv.lock\|Dockerfile.prod\|docker-compose"; then
    REBUILD_NEEDED=true
    echo -e "${YELLOW}⚠️  Dependencies or Docker config changed - rebuild required${NC}"
fi

if [ "$MODE" = "--quick" ] && [ "$REBUILD_NEEDED" = false ]; then
    echo "⚡ Quick restart (no rebuild)..."
    docker-compose -f docker-compose.prod.yml restart fastapi
    
elif [ "$MODE" = "--full" ] || [ "$REBUILD_NEEDED" = true ]; then
    echo "🔨 Full rebuild and deploy..."
    ./scripts/deploy.sh
    
else
    echo -e "${RED}Unknown mode: $MODE${NC}"
    echo "Usage: ./scripts/update-backend.sh [--quick|--full]"
    exit 1
fi

echo ""
echo "🏥 Health check..."
sleep 5

if docker exec fastapi curl -f http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend updated successfully!${NC}"
    echo "🌐 API: https://api.yigitcanozdemir.com"
    docker-compose -f docker-compose.prod.yml ps
else
    echo -e "${RED}❌ Health check failed!${NC}"
    echo "Rolling back..."
    git reset --hard HEAD@{1}
    ./scripts/deploy.sh
    exit 1
fi