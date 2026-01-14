#!/bin/bash

# Monitor Copy Executor
# This script compiles and runs the copy-executor with detailed logging

cd "$(dirname "$0")/services/copy-executor"

echo "🔨 Compiling copy-executor..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Compilation successful!"
    echo "🚀 Starting copy-executor..."
    echo "⏰ Monitoring for 20 minutes..."
    echo ""
    npm run start
else
    echo "❌ Compilation failed!"
    exit 1
fi
