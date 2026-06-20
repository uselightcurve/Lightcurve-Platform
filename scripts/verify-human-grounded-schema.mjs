import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for schema verification.');
}

const requiredTables = [
  'api_keys',
  'agent_runtimes',
  'runtime_instances',
  'datasets',
  'capture_sessions',
  'capture_events',
  'dataset_cases',
  'dataset_case_versions',
  'dataset_contributions',
  'experiments',
  'runs',
  'traces',
  'scores',
  'replay_jobs',
  'replay_results',
];

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const { rows } = await client.query(
    `SELECT name
       FROM unnest($1::text[]) AS name
      WHERE to_regclass('public.' || name) IS NULL
      ORDER BY name`,
    [requiredTables],
  );

  if (rows.length > 0) {
    throw new Error(`Migration incomplete; missing tables: ${rows.map((row) => row.name).join(', ')}`);
  }

  console.log(`Verified ${requiredTables.length} human-grounded dataset tables.`);
} finally {
  await client.end();
}
