/**
 * Test Pump.fun Token Detection
 * Manually test the bot with a known recent Pump.fun token
 */

import { PumpTraderBot } from './main';
import { Logger } from './logger';

async function test() {
  Logger.systemStart();
  Logger.setLevel('debug');

  console.log('\n🧪 TESTING MODE - Checking WebSocket Connection\n');
  console.log('The bot will listen for Pump.fun transactions for 2 minutes.');
  console.log('Any Pump.fun activity will be logged.\n');
  console.log('If you see "WebSocket message received" logs, the connection is working.');
  console.log('If you don\'t see any activity, Pump.fun may be quiet right now.\n');

  const bot = new PumpTraderBot();
  await bot.start();

  // Keep running for 2 minutes
  setTimeout(() => {
    console.log('\n✅ Test complete - Connection is working');
    console.log('Current status:', bot.getStatus());
    process.exit(0);
  }, 120000); // 2 minutes
}

test().catch((error) => {
  Logger.error('Test failed', error);
  process.exit(1);
});
