#!/bin/bash

# Strict Solana Token Sniper - Startup Script

echo "🎯 Starting Strict Solana Token Sniper..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found!"
    echo "📝 Creating from .env.example..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file with your configuration before running!"
    echo "Required settings:"
    echo "  - HELIUS_API_KEY"
    echo "  - HELIUS_RPC_URL"
    echo "  - COPY_WALLET_SEED_PHRASE"
    echo ""
    exit 1
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build
echo ""

# Check if ENABLE_LIVE_TRADING is true
if grep -q "ENABLE_LIVE_TRADING=true" .env; then
    echo "🔴 LIVE TRADING MODE"
    echo "⚠️  Real SOL will be used!"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "❌ Cancelled"
        exit 0
    fi
else
    echo "📝 PAPER TRADING MODE"
    echo "✅ Safe mode - no real trades will be executed"
fi

echo ""
echo "🚀 Starting sniper bot..."
echo ""

# Run the bot
npm start
