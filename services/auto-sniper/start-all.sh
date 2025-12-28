#!/bin/bash

# Auto Sniper - Start All Services
# This script starts all 3 services in separate terminal tabs

echo "🚀 Starting Auto Sniper Services..."

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Function to open new terminal tab and run command (macOS)
open_terminal_tab() {
    local cmd=$1
    local title=$2
    
    osascript <<EOF
tell application "Terminal"
    activate
    tell application "System Events" to keystroke "t" using command down
    delay 0.5
    do script "cd '$DIR' && echo '=== $title ===' && $cmd" in front window
end tell
EOF
}

echo "📦 Installing dependencies..."
npm install

echo "�️  Clearing previous database..."
# Use Node.js script to clear MongoDB Atlas database
node -e "const { MongoClient } = require('mongodb'); (async () => { const client = new MongoClient('mongodb+srv://trader:2srEa7DsHGdFKNZ6@trader.whpvjg3.mongodb.net/'); await client.connect(); const db = client.db('solana_auto_sniper'); await db.collection('tokens').deleteMany({}); console.log('✅ Cleared tokens collection'); await client.close(); })()"

echo "�🔥 Starting services in separate terminal tabs..."

# Start Service 1: Token Discovery
open_terminal_tab "npm run service1" "Service 1: Token Discovery"
sleep 2

# Start Service 2: Token Evaluation
open_terminal_tab "npm run service2" "Service 2: Token Evaluation"
sleep 2

# Start Service 3: Trade Execution
open_terminal_tab "npm run service3" "Service 3: Trade Execution"

echo ""
echo "✅ All services started!"
echo ""
echo "📊 Monitor the 3 terminal tabs:"
echo "   1. Token Discovery - Listens for new tokens"
echo "   2. Token Evaluation - Checks tokens every minute"
echo "   3. Trade Execution - Executes trades and monitors positions"
echo ""
echo "🛑 To stop: Press Ctrl+C in each terminal tab"
echo ""
