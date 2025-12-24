#!/usr/bin/env tsx

import { config } from 'dotenv';
import { resolve } from 'path';
import pkg from 'pg';
const { Pool } = pkg;

// Load environment variables
config({ path: resolve(process.cwd(), '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface Trade {
  id: number;
  leader_wallet: string;
  signature: string;
  slot: number;
  block_time: Date;
  token_in_mint: string;
  token_in_symbol: string | null;
  token_out_mint: string;
  token_out_symbol: string | null;
  amount_in: number;
  amount_out: number;
  dex_program: string | null;
}

async function viewTrades(limit: number = 10) {
  try {
    // First, get total count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM leader_trades');
    const totalTrades = parseInt(countResult.rows[0].total);

    console.log(`\nTotal trades in database: ${totalTrades}\n`);

    const result = await pool.query<Trade>(
      `SELECT 
        id,
        leader_wallet,
        signature,
        slot,
        block_time,
        token_in_mint,
        token_in_symbol,
        token_out_mint,
        token_out_symbol,
        amount_in,
        amount_out,
        dex_program
      FROM leader_trades 
      ORDER BY id DESC 
      LIMIT $1`,
      [limit]
    );

    if (result.rows.length === 0) {
      console.log('No trades found in database.');
      return;
    }

    console.log(`${'='.repeat(100)}`);
    console.log(`LATEST ${result.rows.length} TRADES (newest first)`);
    console.log(`${'='.repeat(100)}\n`);

    for (const trade of result.rows) {
      const timestamp = new Date(trade.block_time).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      console.log(`Trade ID: ${trade.id}`);
      console.log(`Time: ${timestamp}`);
      console.log(`Wallet: ${trade.leader_wallet}`);
      console.log(`Signature: ${trade.signature}`);
      console.log(`Slot: ${trade.slot}`);
      console.log('');
      console.log(`  SOLD: ${trade.amount_in} ${trade.token_in_symbol || 'Unknown'}`);
      console.log(`  Token: ${trade.token_in_mint}`);
      console.log('');
      console.log(`  BOUGHT: ${trade.amount_out} ${trade.token_out_symbol || 'Unknown'}`);
      console.log(`  Token: ${trade.token_out_mint}`);
      console.log('');
      console.log(`  DEX: ${trade.dex_program || 'Unknown'}`);
      console.log(`\n${'-'.repeat(100)}\n`);
    }

    console.log(`Total trades shown: ${result.rows.length}\n`);
  } catch (error) {
    console.error('Error fetching trades:', error);
  } finally {
    await pool.end();
  }
}

// Get limit from command line args or default to 10
const limit = parseInt(process.argv[2]) || 10;
viewTrades(limit);
