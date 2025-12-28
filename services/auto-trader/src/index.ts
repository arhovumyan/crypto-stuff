/**
 * Entry Point
 * Starts the Automated Trading Bot
 */

import { AutoTrader } from './auto-trader';
import { Logger } from './logger';

async function main() {
  try {
    const bot = new AutoTrader();
    await bot.start();
  } catch (error: any) {
    Logger.error('Fatal error starting bot', error);
    process.exit(1);
  }
}

main();
