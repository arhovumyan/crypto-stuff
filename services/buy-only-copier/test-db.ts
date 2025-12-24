import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const { Pool } = pg;

console.log('DATABASE_URL:', process.env.DATABASE_URL);

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function test() {
  try {
    const result = await db.query('SELECT 1 as num');
    console.log('Success:', result.rows);
    await db.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

test();
