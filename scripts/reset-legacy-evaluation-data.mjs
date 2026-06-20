import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the production migration.');
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let transactionStarted = false;

try {
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
  const { rows } = await client.query(
    `SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
       FROM unnest($1::text[]) AS name`,
    [requiredTables],
  );

  if (rows.every((row) => row.present)) {
    console.log('Human-grounded dataset schema already exists; legacy reset skipped.');
  } else {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query(`
      DO $$
      BEGIN
        IF to_regclass('public.usage_events') IS NOT NULL THEN
          UPDATE usage_events SET source_run_id = NULL, source_experiment_id = NULL;
        END IF;
        IF to_regclass('public.sandbox_tool_events') IS NOT NULL THEN
          UPDATE sandbox_tool_events SET run_id = NULL;
        END IF;
        IF to_regclass('public.sandbox_environments') IS NOT NULL THEN
          UPDATE sandbox_environments SET run_id = NULL;
        END IF;
      END $$;
    `);
    await client.query(`
      DROP TABLE IF EXISTS
        replay_results,
        replay_jobs,
        dataset_contributions,
        dataset_case_versions,
        dataset_cases,
        capture_events,
        capture_sessions,
        runtime_instances,
        scores,
        traces,
        runs,
        experiments,
        datasets,
        agent_runtimes,
        api_keys,
        scenarios,
        agent_connections
      CASCADE
    `);
    await client.query('COMMIT');
    transactionStarted = false;
    console.log('Incomplete evaluation schema removed; ready for non-interactive dataset schema creation.');
  }
} catch (error) {
  if (transactionStarted) {
    await client.query('ROLLBACK').catch(() => undefined);
  }
  throw error;
} finally {
  await client.end();
}
