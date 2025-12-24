import pg from 'pg';
import { config } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('database');
const { Pool } = pg;

// Create connection pool
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('connect', () => {
  logger.debug('New database connection established');
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database error');
});

// Helper to execute queries
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug({ text, duration, rows: result.rowCount }, 'Query executed');
    return result;
  } catch (error) {
    logger.error({ text, error }, 'Query failed');
    throw error;
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  logger.info('Closing database connection pool...');
  await pool.end();
  logger.info('Database connection pool closed');
}
