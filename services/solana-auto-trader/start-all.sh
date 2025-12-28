#!/bin/bash

# Start all three services in separate terminal tabs/windows

echo "Starting Solana Automated Trading System..."
echo "=============================================="
echo ""
echo "This will open 3 terminal windows for:"
echo "1. Token Discovery Service"
echo "2. Token Validator Service"
echo "3. Trading Executor Service"
echo ""

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Load environment variables
export $(cat "$DIR/../../.env" | grep -v '^#' | xargs)

# Check if MongoDB is running
if ! pgrep -x "mongod" > /dev/null; then
    echo "⚠️  MongoDB is not running. Starting MongoDB..."
    brew services start mongodb-community@7.0
    sleep 3
fi

echo "✓ MongoDB is running"
echo ""

# Function to open a new terminal tab and run a command
open_terminal_tab() {
    local title=$1
    local command=$2
    
    osascript -e "tell application \"Terminal\"
        do script \"echo '═══════════════════════════════════════' && echo '$title' && echo '═══════════════════════════════════════' && echo '' && cd '$DIR' && $command\"
        activate
    end tell"
}

# Open terminals for each service
echo "Opening Service 1: Token Discovery..."
open_terminal_tab "SERVICE 1: TOKEN DISCOVERY" "npm run discovery"

sleep 2

echo "Opening Service 2: Token Validator..."
open_terminal_tab "SERVICE 2: TOKEN VALIDATOR" "npm run validator"

sleep 2

echo "Opening Service 3: Trading Executor..."
open_terminal_tab "SERVICE 3: TRADING EXECUTOR" "npm run executor"

echo ""
echo "✓ All services started!"
echo ""
echo "Monitor each terminal window to see:"
echo "  - Service 1: New tokens being discovered"
echo "  - Service 2: Token validation results"
echo "  - Service 3: Trade execution and position monitoring"
echo ""
echo "Press Ctrl+C in each terminal to stop the services"
