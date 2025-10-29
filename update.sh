#!/bin/bash
set -e

echo "🔄 Updating application from Git..."

# Pull latest code
git pull origin main

# Run deployment
./deploy.sh