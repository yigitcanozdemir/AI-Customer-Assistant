#!/bin/bash
set -e

echo "⚡ Quick update (no rebuild)..."

git pull origin main

docker-compose -f docker-compose.prod.yml restart fastapi

echo "✅ Updated! Services restarted."
docker-compose -f docker-compose.prod.yml logs -f fastapi