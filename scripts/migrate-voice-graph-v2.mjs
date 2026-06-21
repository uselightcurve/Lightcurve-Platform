import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Voice Graph v2 migration.');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query('BEGIN');
  await client.query(`
    ALTER TABLE dataset_cases ADD COLUMN IF NOT EXISTS risk_weight integer NOT NULL DEFAULT 1;
    ALTER TABLE dataset_cases ADD COLUMN IF NOT EXISTS variation_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE experiments ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE experiments ADD COLUMN IF NOT EXISTS total_runs integer NOT NULL DEFAULT 0;
    ALTER TABLE experiments ADD COLUMN IF NOT EXISTS completed_runs integer NOT NULL DEFAULT 0;
    ALTER TABLE experiments ADD COLUMN IF NOT EXISTS effective_concurrency integer NOT NULL DEFAULT 0;

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS variant_index integer;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS replay_manifest jsonb;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS impairment_profile jsonb;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS scoring_status text NOT NULL DEFAULT 'pending';
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS audio_clean_caller_url text;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS audio_impaired_caller_url text;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS judge_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

    ALTER TABLE scores ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE replay_jobs ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
    ALTER TABLE replay_jobs ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;
    ALTER TABLE replay_jobs ADD COLUMN IF NOT EXISTS last_error text;
    ALTER TABLE replay_results ADD COLUMN IF NOT EXISTS artifacts jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE replay_results ADD COLUMN IF NOT EXISTS judge_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS scoring_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'queued',
      attempt_count integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5,
      next_attempt_at timestamptz DEFAULT now(),
      last_error text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS scoring_jobs_run_idx ON scoring_jobs(run_id);
    CREATE INDEX IF NOT EXISTS scoring_jobs_due_idx ON scoring_jobs(status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS replay_utterances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      node_id text NOT NULL,
      text text NOT NULL,
      embedding jsonb NOT NULL,
      nearest_similarity double precision,
      created_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS replay_utterances_run_node_idx ON replay_utterances(run_id, node_id);

    CREATE TABLE IF NOT EXISTS noise_assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL,
      category text NOT NULL,
      gcs_uri text NOT NULL,
      license text NOT NULL,
      source_url text NOT NULL,
      attribution text,
      checksum text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      enabled integer NOT NULL DEFAULT 1,
      created_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS noise_assets_key_idx ON noise_assets(key);
    CREATE UNIQUE INDEX IF NOT EXISTS runs_experiment_variant_idx ON runs(experiment_id, variant_index);
    CREATE INDEX IF NOT EXISTS replay_jobs_runtime_status_idx ON replay_jobs(runtime_id, status, created_at);
  `);
  await client.query('COMMIT');
  console.log('Voice Graph v2 additive schema applied.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
