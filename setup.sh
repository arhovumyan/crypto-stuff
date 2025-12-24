#!/bin/bash

# Solana Copy Trading Bot - Quick Setup Script
# Run this after getting your Helius API key

set -e

echo "🚀 Solana Copy Trading Bot - Setup"
echo "====================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo "   Please start Docker Desktop and try again."
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "   Please create .env from .env.example"
    exit 1
fi

# Check if Helius API key is configured
if grep -q "your_helius_api_key_here" .env; then
    echo "⚠️  WARNING: Helius API key not configured!"
    echo ""
    echo "Please update .env with your Helius API key:"
    echo "1. Get a free key from https://helius.dev"
    echo "2. Update HELIUS_API_KEY in .env"
    echo "3. Update HELIUS_RPC_URL and HELIUS_WS_URL with your key"
    echo ""
    exit 1
fi

echo "✅ Configuration looks good"
echo ""

# Start Docker containers
echo "📦 Starting PostgreSQL and Redis..."
npm run docker:down > /dev/null 2>&1 || true
npm run docker:up

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Check if containers are running
if docker ps | grep -q "copytrader-postgres"; then
    echo "✅ PostgreSQL is running"
else
    echo "❌ PostgreSQL failed to start"
    exit 1
fi

if docker ps | grep -q "copytrader-redis"; then
    echo "✅ Redis is running"
else
    echo "❌ Redis failed to start"
    exit 1
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  npm run dev        # Start the listener"
echo ""
echo "To stop:"
echo "  Ctrl+C             # Stop the listener"
echo "  npm run docker:down   # Stop Docker containers"
echo ""
