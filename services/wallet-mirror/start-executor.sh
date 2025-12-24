#!/bin/bash

# Start the Mirror Executor
# This script copies trades from watched wallets with fixed $0.10 buys

echo "╔══════════════════════════════════════════════════╗"
echo "║   💰 Starting Mirror Executor...                 ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "This will copy trades from watched wallets."
echo "Buy amount: \$0.10 per trade"
echo "Mode: $(grep ENABLE_LIVE_TRADING ../../../.env | cut -d'=' -f2)"
echo ""

cd "$(dirname "$0")"
npm run executor
