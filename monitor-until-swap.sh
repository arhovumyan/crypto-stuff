#!/bin/bash

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║       🔥 BEAST MODE - LIVE SWAP EXECUTION MONITOR 🔥            ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Leader: ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT          ║"
echo "║  Status: 🔴 LIVE TRADING ACTIVE                                  ║"
echo "║  Will NOT exit until a swap is EXECUTED                          ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

LISTENER_LOG="/Users/aro/Documents/Trading/CopyTrader/services/listener/listener.log"
EXECUTOR_LOG="/Users/aro/Documents/Trading/CopyTrader/services/copy-executor/copy-executor.log"

LAST_LINE_COUNT=$(wc -l < "$LISTENER_LOG")
SWAP_EXECUTED=0

echo "⏳ Waiting for leader wallet to make a swap transaction..."
echo "   (Monitoring logs every 2 seconds)"
echo ""

while [ $SWAP_EXECUTED -eq 0 ]; do
    CURRENT_LINE_COUNT=$(wc -l < "$LISTENER_LOG")
    
    if [ $CURRENT_LINE_COUNT -gt $LAST_LINE_COUNT ]; then
        # New lines added, check for activity
        NEW_LINES=$(tail -n $((CURRENT_LINE_COUNT - LAST_LINE_COUNT)) "$LISTENER_LOG")
        
        # Check for transaction detected
        if echo "$NEW_LINES" | grep -q "Transaction detected"; then
            TX_SIG=$(echo "$NEW_LINES" | grep "Transaction detected" | awk '{print $NF}')
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "📡 $(date '+%H:%M:%S') - Transaction detected: $TX_SIG"
        fi
        
        # Check for token deltas
        if echo "$NEW_LINES" | grep -q "Token deltas computed"; then
            DELTA_INFO=$(echo "$NEW_LINES" | grep "Token deltas computed")
            echo "   └─ $DELTA_INFO"
        fi
        
        # Check for swap classification
        if echo "$NEW_LINES" | grep -q "Not a simple swap"; then
            echo "   └─ ⚠️  Not classified as swap"
        fi
        
        # Check for BOUGHT or SOLD (successful parse)
        if echo "$NEW_LINES" | grep -qE "BOUGHT|SOLD"; then
            SWAP_INFO=$(echo "$NEW_LINES" | grep -E "BOUGHT|SOLD")
            echo "   └─ ✅ $SWAP_INFO"
            echo ""
            echo "🎯 SWAP DETECTED! Checking if copy executor picks it up..."
            
            # Wait a few seconds for executor to process
            sleep 3
            
            # Check if executor executed
            RECENT_EXECUTOR=$(tail -n 20 "$EXECUTOR_LOG")
            if echo "$RECENT_EXECUTOR" | grep -q "LIVE BUY\|LIVE SELL"; then
                EXECUTION_INFO=$(echo "$RECENT_EXECUTOR" | grep -E "LIVE BUY|LIVE SELL|Signature:")
                echo ""
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                echo "🚀 SUCCESS! SWAP EXECUTED!"
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                echo "$EXECUTION_INFO"
                echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                SWAP_EXECUTED=1
            fi
        fi
        
        LAST_LINE_COUNT=$CURRENT_LINE_COUNT
    fi
    
    sleep 2
done

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                  ✅ MISSION ACCOMPLISHED ✅                      ║"
echo "║           A swap was successfully detected and executed!         ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
