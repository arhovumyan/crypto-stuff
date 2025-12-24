import { WalletMirror } from './wallet-mirror.js';
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
});

async function main() {
  logger.info({ context: '🚀 Starting Wallet Mirror Service' });

  const service = new WalletMirror();

  // Ensure database table exists
  await service.ensureTable();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info({ context: 'Received SIGINT, shutting down gracefully...' });
    service.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info({ context: 'Received SIGTERM, shutting down gracefully...' });
    service.stop();
    process.exit(0);
  });

  // Start the service
  await service.start();
}

main().catch((error) => {
  logger.error({
    context: 'Fatal error',
    error: error.message,
  });
  process.exit(1);
});
