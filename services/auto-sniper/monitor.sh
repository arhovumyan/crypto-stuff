#!/bin/bash

# Monitor Script - View logs from all 3 services
# This shows what's happening across all services

echo "📊 Auto Sniper - System Monitor"
echo "================================"
echo ""

# Connect to MongoDB and show stats
echo "💾 DATABASE STATUS:"
mongosh solana_auto_sniper --quiet --eval "
  print('Total tokens: ' + db.tokens.count());
  print('');
  print('By Status:');
  db.tokens.aggregate([
    { \$group: { _id: '\$status', count: { \$sum: 1 } } },
    { \$sort: { _id: 1 } }
  ]).forEach(function(doc) {
    print('  ' + doc._id + ': ' + doc.count);
  });
  print('');
  print('Recent tokens (last 5):');
  db.tokens.find().sort({createdAt: -1}).limit(5).forEach(function(doc) {
    print('  • ' + doc.mintAddress.substring(0, 12) + '... [' + doc.status + ']');
  });
"

echo ""
echo "🔄 SERVICE STATUS:"
echo "  Service 1 (Token Discovery): Check terminal 1"
echo "  Service 2 (Token Evaluation): Check terminal 2"
echo "  Service 3 (Trade Execution): Check terminal 3"
echo ""
echo "💡 TIP: Run this script periodically to monitor system progress"
echo ""
