#!/bin/bash
set -e

echo "🔄 Updating from Git and deploying..."

# Pull latest code
git pull origin main

# Run deployment
./scripts/deploy.sh