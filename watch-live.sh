#!/bin/bash

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║      🔥 BEAST MODE - WAITING FOR NEXT SWAP 🔥                 ║"
echo "║  Will monitor until a swap is EXECUTED                         ║"
echo "║  Press Ctrl+C to stop                                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "🎯 Monitoring leader: ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT"
echo "⏰ Started at: $(date)"
echo ""

LISTENER_LOG="/Users/aro/Documents/Trading/CopyTrader/services/listener/listener.log"
EXECUTOR_LOG="/Users/aro/Documents/Trading/CopyTrader/services/copy-executor/copy-executor.log"

# Tail both logs in real-time
tail -f "$LISTENER_LOG" "$EXECUTOR_LOG" | while read line; do
    # Highlight important events
    if echo "$line" | grep -q "Transaction detected"; then
        echo "📡 $line"
    elif echo "$line" | grep -q "Token deltas computed"; then
        echo "🔍 $line"
    elif echo "$line" | grep -qE "BOUGHT|SOLD"; then
        echo "✅ $line"
    elif echo "$line" | grep -q "LIVE BUY\|LIVE SELL"; then
        echo "🚀🚀🚀 $line"
    elif echo "$line" | grep -q "Signature:"; then
        echo "🔗 $line"
    elif echo "$line" | grep -q "Not a simple swap"; then
        echo "⚠️  $line"
    else
        echo "$line"
    fi
done
