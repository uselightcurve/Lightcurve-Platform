import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the production migration.');
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');
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
      IF to_regclass('public.scores') IS NOT NULL THEN DELETE FROM scores; END IF;
      IF to_regclass('public.traces') IS NOT NULL THEN DELETE FROM traces; END IF;
      IF to_regclass('public.runs') IS NOT NULL THEN DELETE FROM runs; END IF;
      IF to_regclass('public.experiments') IS NOT NULL THEN DELETE FROM experiments; END IF;
      IF to_regclass('public.scenarios') IS NOT NULL THEN DELETE FROM scenarios; END IF;
      IF to_regclass('public.agent_connections') IS NOT NULL THEN DELETE FROM agent_connections; END IF;
    END $$;
  `);
  await client.query('COMMIT');
  console.log('Legacy scenarios, connections, experiments, runs, traces, and scores removed.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
