#!/bin/bash
# Live monitoring script for copy trading system

echo "=========================================="
echo "🚀 LIVE COPY TRADING MONITOR"
echo "=========================================="
echo "Wallet: ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT"
echo "Mode: 🔴 LIVE TRADING"
echo "Buy Amount: 0.2 SOL per trade"
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop monitoring"
echo ""

# Function to display recent logs with color
display_logs() {
    echo "----------------------------------------"
    echo "⏰ $(date '+%Y-%m-%d %H:%M:%S')"
    echo "----------------------------------------"
    
    echo ""
    echo "📡 LISTENER (Last 10 lines):"
    tail -n 10 /Users/aro/Documents/Trading/CopyTrader/services/listener/listener.log | grep -E "(BUY DETECTED|SELL DETECTED|Transaction detected|Now monitoring)" || echo "  Waiting for transactions..."
    
    echo ""
    echo "🤖 COPY EXECUTOR (Last 10 lines):"
    tail -n 10 /Users/aro/Documents/Trading/CopyTrader/services/copy-executor/copy-executor.log | grep -E "(LIVE BUY|LIVE SELL|Processing|Balance)" || echo "  Waiting for trades to copy..."
    
    echo ""
    echo "----------------------------------------"
}

# Monitor loop
while true; do
    clear
    display_logs
    sleep 10
done
