import { createClient } from 'redis';
import { config } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('redis');

export const redis = createClient({
  url: config.REDIS_URL,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis error');
});

redis.on('reconnecting', () => {
  logger.warn('Redis reconnecting...');
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
  logger.info('Redis connection established');
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed');
}

// Helper: Check if we've already processed a transaction
export async function isTransactionProcessed(signature: string): Promise<boolean> {
  const key = `processed:${signature}`;
  const exists = await redis.exists(key);
  return exists === 1;
}

// Helper: Mark transaction as processed (expires after 7 days)
export async function markTransactionProcessed(signature: string): Promise<void> {
  const key = `processed:${signature}`;
  await redis.setEx(key, 7 * 24 * 60 * 60, '1'); // 7 days
}
