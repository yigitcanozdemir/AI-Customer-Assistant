#!/bin/bash
set -e

echo "🔄 Updating from Git and deploying..."

git pull origin main

./scripts/deploy.sh