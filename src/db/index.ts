import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production.');
}

const pool = new Pool({
  connectionString: databaseUrl || 'postgresql://lightcurve:lightcurve@127.0.0.1:5432/lightcurve',
  max: 5,
});

export const db = drizzle(pool, { schema });
