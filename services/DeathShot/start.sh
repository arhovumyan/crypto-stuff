#!/bin/bash

# DeathShot Trading Bot Startup Script

echo "🚀 Starting DeathShot Trading Bot..."

# Load environment variables
if [ -f "../../.env" ]; then
    echo "✅ Loading configuration from root .env"
    export $(cat ../../.env | grep -v '^#' | xargs)
else
    echo "⚠️  No .env file found in root directory"
fi

# Check if database is accessible
echo "🔍 Checking database connection..."
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not set"
    exit 1
fi

# Build the project
echo "🔨 Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

# Start the bot
echo "✅ Starting bot..."
npm start
