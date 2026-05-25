import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const databaseUrl =
  process.env.DATABASE_URL || 'postgresql://lightcurve:lightcurve@127.0.0.1:5432/lightcurve';

const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
});

export const db = drizzle(pool, { schema });
