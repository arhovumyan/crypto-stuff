import { createClient } from 'redis';
import { config } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('redis');

// Track if we're in initial connection phase to suppress error spam
let isInitialConnection = true;
let connectionAttempted = false;

export const redis = createClient({
  url: config.REDIS_URL,
  socket: {
    reconnectStrategy: false, // Disable automatic reconnection - we handle it manually
  },
});

redis.on('connect', () => {
  logger.info('Redis connected');
  isInitialConnection = false;
});

redis.on('error', (err) => {
  // Suppress connection errors during initial connection attempts
  // They'll be handled by connectRedis function
  if (isInitialConnection && connectionAttempted) {
    // Check for ECONNREFUSED in various error formats
    const isConnectionRefused = 
      (err instanceof Error && (
        err.message?.includes('ECONNREFUSED') || 
        (err as any).code === 'ECONNREFUSED'
      )) ||
      (err && typeof err === 'object' && 'code' in err && err.code === 'ECONNREFUSED') ||
      (err && typeof err === 'object' && 'type' in err && err.type === 'AggregateError' &&
       (err as any).aggregateErrors?.some((e: any) => 
         e?.code === 'ECONNREFUSED' || e?.message?.includes('ECONNREFUSED')
       ));
    
    if (isConnectionRefused) {
      // Suppress during initial connection - connectRedis will handle it
      return;
    }
  }
  
  // Log other errors (not during initial connection phase)
  if (!isInitialConnection) {
    logger.error({ err }, 'Redis error');
  }
});

redis.on('reconnecting', () => {
  // Disabled - we handle reconnection manually
});

/**
 * Connect to Redis with retry logic and helpful error messages
 * @param maxRetries Maximum number of connection attempts (default: 30)
 * @param retryDelayMs Initial delay between retries in ms (default: 1000)
 */
export async function connectRedis(maxRetries = 10, retryDelayMs = 1000): Promise<void> {
  const maxAttempts = maxRetries;
  let attempts = 0;
  connectionAttempted = true;

  // Check if already connected
  if (redis.isOpen || redis.isReady) {
    logger.info('Redis already connected');
    isInitialConnection = false;
    return;
  }

  while (attempts < maxAttempts) {
    try {
      attempts++;
      
      // Try to connect
      await redis.connect();
      logger.info('Redis connection established');
      isInitialConnection = false;
      return;
    } catch (error: any) {
      // If already connected/ready (might have connected during error), we're done
      if (redis.isOpen || redis.isReady) {
        logger.info('Redis connection established');
        isInitialConnection = false;
        return;
      }
      
      // Check if it's a connection refused error (handle various formats)
      const isConnectionRefused = 
        error?.code === 'ECONNREFUSED' || 
        error?.message?.includes('ECONNREFUSED') ||
        (error?.type === 'AggregateError' && 
         error?.aggregateErrors?.some((e: any) => 
           e?.code === 'ECONNREFUSED' || e?.message?.includes('ECONNREFUSED')
         ));
      
      if (isConnectionRefused) {
        if (attempts === 1) {
          logger.error('❌ Cannot connect to Redis server');
          logger.error(`   Trying to connect to: ${config.REDIS_URL}`);
          logger.error('');
          logger.error('💡 Redis is not running. Please start it first:');
          logger.error('   docker-compose up -d redis');
          logger.error('   OR');
          logger.error('   redis-server');
          logger.error('');
          logger.warn(`   Will retry ${maxAttempts - 1} more times...`);
        }
        
        if (attempts >= maxAttempts) {
          logger.error('');
          logger.error('❌ Failed to connect to Redis after maximum retries');
          logger.error(`   Attempted ${maxAttempts} times`);
          logger.error('');
          logger.error('📋 To fix this:');
          logger.error('   1. Ensure Redis is installed and running');
          logger.error('   2. Check Redis is accessible at: ' + config.REDIS_URL);
          logger.error('   3. If using Docker: Start Docker Desktop, then: docker-compose up -d redis');
          logger.error('   4. If running locally: redis-server');
          logger.error('');
          isInitialConnection = false; // Allow error logging after we give up
          throw new Error(
            `Redis connection failed: Cannot connect to Redis at ${config.REDIS_URL}. ` +
            `Please ensure Redis is running. See logs above for instructions.`
          );
        }
        
        const delay = Math.min(retryDelayMs * attempts, 3000);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Handle "already connecting" error - wait a bit and check again
      if (error?.message?.includes('Socket already opened') || 
          error?.message?.includes('already connecting') ||
          error?.message?.includes('Client is already connecting')) {
        logger.debug('Redis connection already in progress, waiting...');
        await new Promise(resolve => setTimeout(resolve, 500));
        // Check again after waiting
        if (redis.isOpen || redis.isReady) {
          logger.info('Redis connection established');
          isInitialConnection = false;
          return;
        }
        attempts--; // Don't count this as an attempt
        continue;
      }
      
      // For other errors, log and throw
      isInitialConnection = false;
      logger.error({ error }, 'Redis connection error');
      throw error;
    }
  }
  
  // Should never reach here, but just in case
  isInitialConnection = false;
}

export async function closeRedis(): Promise<void> {
  try {
    if (redis.isOpen) {
      await redis.quit();
      logger.info('Redis connection closed');
    } else {
      logger.debug('Redis was not connected, skipping close');
    }
  } catch (error) {
    logger.warn({ error }, 'Error closing Redis connection');
  }
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
