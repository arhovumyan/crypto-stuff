import { Connection } from '@solana/web3.js';
import { TransactionParser } from './transaction-parser.js';
import { config, createLogger } from '@copytrader/shared';

const logger = createLogger('test-parser');

async function testParseMissedTransaction() {
  const connection = new Connection(config.HELIUS_RPC_URL, 'confirmed');
  const parser = new TransactionParser(connection);
  
  // Test SELL transaction that was rejected
  const sellSig = 'rVreecUdPnn9y7woQgJ6iL8QWCHx1uoEg2eFnaC4QXAgEjTVXtRFZusMDsoMG77ZkADFQZYjj8WrR7FwJAHnrQ3';
  const wallet = 'ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT';
  
  logger.info(`Testing SELL transaction: ${sellSig}`);
  
  const swap = await parser.parseSwap(sellSig, wallet);
  
  if (swap) {
    logger.info('✅ Successfully parsed SELL!');
    logger.info(`   Token IN: ${swap.tokenIn.mint.slice(0, 6)}... Amount: ${swap.tokenIn.amount}`);
    logger.info(`   Token OUT: ${swap.tokenOut.mint === 'So11111111111111111111111111111111111111112' ? 'SOL' : swap.tokenOut.mint.slice(0, 6)}... Amount: ${swap.tokenOut.amount}`);
  } else {
    logger.error('❌ Failed to parse SELL');
  }
}

testParseMissedTransaction().catch((error) => {
  logger.error({ error }, 'Test failed');
  process.exit(1);
});
