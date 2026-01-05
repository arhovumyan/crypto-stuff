import { Connection } from '@solana/web3.js';
import { TransactionParser } from './transaction-parser.js';
import { config, createLogger } from '@copytrader/shared';

const logger = createLogger('test-parser');

async function testParseMissedTransaction() {
  const connection = new Connection(config.HELIUS_RPC_URL, 'confirmed');
  const parser = new TransactionParser(connection);
  
  // One of the missed transactions from the screenshot
  const signature = '2MQ4wfE1mWQZHy6xQFMeu5taPG7YwzaCPKrR5D8KWwMUovnL4MofNzXLguxki5Rx4DxNJuz4ZZtqkUxrRmzFxFcJ';
  const wallet = 'ERBVcqUW8CyLF26CpZsMzi1Fq3pB8d8q5LswRiWk7jwT';
  
  logger.info(`Testing parse of missed transaction: ${signature}`);
  
  const swap = await parser.parseSwap(signature, wallet);
  
  if (swap) {
    logger.info('✅ Successfully parsed as swap!', swap);
  } else {
    logger.error('❌ Failed to parse as swap');
  }
}

testParseMissedTransaction().catch((error) => {
  logger.error({ error }, 'Test failed');
  process.exit(1);
});
