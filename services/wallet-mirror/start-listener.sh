#!/bin/bash

# Start the Wallet Watch Listener
# This script monitors wallets from WATCH_ADDRESSES and records their transactions

echo "╔══════════════════════════════════════════════════╗"
echo "║   🔍 Starting Wallet Watch Listener...           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "This will monitor wallets from WATCH_ADDRESSES in .env"
echo "and record their live transactions to the database."
echo ""

cd "$(dirname "$0")"
npm run listener
