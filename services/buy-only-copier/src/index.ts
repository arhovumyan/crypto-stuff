import dotenv from 'dotenv';
import { BuyOnlyCopier } from './buy-only-copier.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  console.log('🚀 Starting Buy-Only Copier Service...');

  const copier = new BuyOnlyCopier();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    copier.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    copier.stop();
    process.exit(0);
  });

  await copier.start();
}

main().catch((error) => {
  console.error('Fatal error in main:', error.message);
  process.exit(1);
});
