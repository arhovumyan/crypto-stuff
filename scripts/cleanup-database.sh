#!/bin/bash
# Database Cleanup Script
# Use this to skip all old trades and start fresh

set -e

DB_URL="postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader"

echo "═══════════════════════════════════════════════════════"
echo "Database Cleanup - Skip Old Trades"
echo "═══════════════════════════════════════════════════════"
echo ""

# Get current status
echo "Current Status:"
psql "$DB_URL" -c "
SELECT 
  (SELECT MAX(id) FROM leader_trades) as latest_trade_in_db,
  (SELECT MAX(leader_trade_id) FROM copy_attempts) as last_processed_id,
  (SELECT COUNT(*) FROM leader_trades WHERE id > COALESCE((SELECT MAX(leader_trade_id) FROM copy_attempts), 0)) as unprocessed_trades;
"

echo ""
read -p "Mark all trades as processed? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]
then
    # Get the latest trade ID
    LATEST_ID=$(psql "$DB_URL" -t -c "SELECT MAX(id) FROM leader_trades;")
    LATEST_ID=$(echo $LATEST_ID | xargs) # trim whitespace
    
    echo "Marking trade ID $LATEST_ID as last processed..."
    
    psql "$DB_URL" -c "
    INSERT INTO copy_attempts (
      leader_trade_id, 
      status, 
      reason,
      created_at
    ) VALUES (
      $LATEST_ID,
      'skipped',
      'Database cleanup - marking all trades before this as processed',
      NOW()
    );
    "
    
    echo ""
    echo "✅ Cleanup complete! New status:"
    psql "$DB_URL" -c "
    SELECT 
      (SELECT MAX(id) FROM leader_trades) as latest_trade_in_db,
      (SELECT MAX(leader_trade_id) FROM copy_attempts) as last_processed_id,
      (SELECT COUNT(*) FROM leader_trades WHERE id > $LATEST_ID) as unprocessed_trades;
    "
    
    echo ""
    echo "✅ Copy-executor will now only process NEW trades going forward"
    echo "   (plus the 10-minute time filter is active)"
else
    echo "Cleanup cancelled"
fi
