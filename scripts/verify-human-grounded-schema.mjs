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
  'noise_assets',
  'scoring_jobs',
  'replay_utterances',
];

const requiredColumns = {
  dataset_cases: ['risk_weight', 'variation_policy'],
  experiments: ['config', 'total_runs', 'completed_runs', 'effective_concurrency'],
  runs: ['variant_index', 'replay_manifest', 'impairment_profile', 'scoring_status', 'audio_clean_caller_url', 'audio_impaired_caller_url', 'judge_metadata', 'retry_count'],
  scores: ['metadata'],
  replay_jobs: ['attempt_count', 'max_attempts', 'last_error'],
  replay_results: ['artifacts', 'judge_metadata'],
};

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

  const missingColumns = [];
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const result = await client.query(
      `SELECT expected.column_name
         FROM unnest($2::text[]) AS expected(column_name)
        WHERE NOT EXISTS (
          SELECT 1 FROM information_schema.columns actual
           WHERE actual.table_schema = 'public'
             AND actual.table_name = $1
             AND actual.column_name = expected.column_name
        )`,
      [table, columns],
    );
    missingColumns.push(...result.rows.map((row) => `${table}.${row.column_name}`));
  }
  if (missingColumns.length) throw new Error(`Migration incomplete; missing columns: ${missingColumns.join(', ')}`);

  console.log(`Verified ${requiredTables.length} human-grounded dataset tables and Voice Graph v2 columns.`);
} finally {
  await client.end();
}
