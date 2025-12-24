#!/bin/bash
# Quick start script for Wallet Mirror service

set -e

echo "════════════════════════════════════════════════════════"
echo "  Wallet Mirror Service - Quick Start"
echo "════════════════════════════════════════════════════════"
echo ""

# Get script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
ENV_FILE="$PROJECT_ROOT/.env"

# Check if .env exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: .env file not found at $ENV_FILE"
    exit 1
fi

echo "✅ Configuration file found"
echo ""
echo "🚀 Starting wallet-mirror service..."
echo "   (Service will load config from .env automatically)"
echo ""

# Just run the service - it loads .env internally
npm run dev
