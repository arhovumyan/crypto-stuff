#!/bin/bash
# Quick demo of the sandbox system

echo "════════════════════════════════════════════════════════════════"
echo "🎮 SANDBOX DEMO - Quick Test"
echo "════════════════════════════════════════════════════════════════"
echo ""

echo "📋 Step 1: Build the project"
echo "  → npm run build"
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Build failed"
  exit 1
fi
echo "✅ Build successful"
echo ""

echo "📋 Step 2: Record swaps (30 seconds demo)"
echo "  → npm run record -- --duration 30"
echo ""
echo "⏱️  Recording for 30 seconds..."
timeout 35 npm run record -- --duration 30 2>&1 | grep -E "INFO|swap recorded|Total swaps" | tail -20
echo ""
echo "✅ Recording complete"
echo ""

echo "📋 Step 3: Check recorded file"
FILE=$(ls -t swaps_*.jsonl 2>/dev/null | head -1)
if [ -f "$FILE" ]; then
  SIZE=$(wc -l < "$FILE")
  echo "✅ Found: $FILE"
  echo "   Lines: $SIZE swaps"
  echo ""
  echo "   First swap:"
  head -1 "$FILE" | jq '.' 2>/dev/null || head -1 "$FILE"
  echo ""
else
  echo "⚠️  No swap file found (recording might have been too short)"
  exit 0
fi

echo "📋 Step 4: Replay (if we have data)"
if [ "$SIZE" -gt 0 ]; then
  echo "  → npm run replay -- --input $FILE --speed max"
  npm run replay -- --input "$FILE" --speed max 2>&1 | grep -E "INFO|Position|Trade" | head -20
  echo ""
  echo "✅ Replay complete"
else
  echo "⚠️  No swaps recorded (might need longer recording time)"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ DEMO COMPLETE"
echo ""
echo "To run a full test:"
echo "  1. npm run record -- --duration 300  (5 minutes)"
echo "  2. npm run replay -- --input ./swaps_*.jsonl --speed 10x"
echo "  3. cat simulation-output/report.md"
echo ""
echo "See SANDBOX-USAGE.md for full documentation"
echo "════════════════════════════════════════════════════════════════"
