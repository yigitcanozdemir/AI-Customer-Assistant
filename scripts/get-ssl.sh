#!/bin/bash
set -e

DOMAIN="api.yigitcanozdemir.com"
EMAIL="${SSL_EMAIL:-}"

echo "🔒 Setting up SSL certificate for $DOMAIN..."

# Validate
if [[ "$EMAIL" == "your-email@example.com" ]]; then
    echo "❌ Please update EMAIL in this script"
    exit 1
fi

# Create directories
mkdir -p certbot/conf certbot/www

# Check if certificate already exists
if [ -f "certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
    echo "✓ Certificate already exists"
    echo "🔄 Using production config with HTTPS..."
    export NGINX_CONF=./nginx/nginx.conf
else
    echo "📝 No certificate found, using HTTP-only config for initial setup..."
    export NGINX_CONF=./nginx/nginx.http.conf
fi

# Start/restart services
docker-compose -f docker-compose.prod.yml up -d nginx
sleep 3

# Get certificate if it doesn't exist
if [ ! -f "certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
    echo "📝 Requesting certificate from Let's Encrypt..."
    
    docker-compose -f docker-compose.prod.yml run --rm certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email $EMAIL \
        --agree-tos \
        --no-eff-email \
        -d $DOMAIN
    
    if [ ! -f "certbot/conf/live/$DOMAIN/fullchain.pem" ]; then
        echo "❌ Failed to obtain certificate"
        exit 1
    fi
    
    echo "✓ Certificate obtained!"
    echo "🔄 Switching to production config with HTTPS..."
    
    # Switch to production config
    export NGINX_CONF=./nginx/nginx.conf
    docker-compose -f docker-compose.prod.yml up -d nginx
fi

echo ""
echo "✅ SSL setup complete!"
echo "🌐 API: https://$DOMAIN"
echo "💡 Certificate auto-renews via certbot container"