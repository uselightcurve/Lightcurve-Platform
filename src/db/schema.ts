import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('api_keys_key_hash_idx').on(table.keyHash)]);

export const agentRuntimes = pgTable('agent_runtimes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  framework: text('framework').notNull().default('pipecat'),
  version: text('version'),
  gitSha: text('git_sha'),
  status: text('status').notNull().default('offline'),
  metadata: jsonb('metadata').notNull().default({}),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('agent_runtimes_owner_name_idx').on(table.ownerUserId, table.name)]);

export const runtimeInstances = pgTable('runtime_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  runtimeId: uuid('runtime_id').notNull().references(() => agentRuntimes.id, { onDelete: 'cascade' }),
  instanceKey: text('instance_key').notNull(),
  status: text('status').notNull().default('online'),
  capacity: integer('capacity').notNull().default(1),
  activeSessions: integer('active_sessions').notNull().default(0),
  metadata: jsonb('metadata').notNull().default({}),
  connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('runtime_instances_key_idx').on(table.runtimeId, table.instanceKey)]);

export const datasets = pgTable('datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  visibility: text('visibility').notNull().default('private'),
  sourceType: text('source_type').notNull().default('playground_capture'),
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('datasets_owner_name_idx').on(table.ownerUserId, table.name)]);

export const captureSessions = pgTable('capture_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  runtimeId: uuid('runtime_id').references(() => agentRuntimes.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('created'),
  humanAudioUrl: text('human_audio_url'),
  agentAudioUrl: text('agent_audio_url'),
  transcript: jsonb('transcript').notNull().default([]),
  metadata: jsonb('metadata').notNull().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const captureEvents = pgTable('capture_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  captureSessionId: uuid('capture_session_id').notNull().references(() => captureSessions.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  eventType: text('event_type').notNull(),
  speaker: text('speaker'),
  timestampMs: integer('timestamp_ms').notNull(),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('capture_events_sequence_idx').on(table.captureSessionId, table.sequence)]);

export const datasetCases = pgTable('dataset_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  datasetId: uuid('dataset_id').notNull().references(() => datasets.id, { onDelete: 'cascade' }),
  sourceCaptureId: uuid('source_capture_id').references(() => captureSessions.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  language: text('language').notNull().default('en-US'),
  domain: text('domain').notNull().default('general'),
  status: text('status').notNull().default('draft'),
  visibility: text('visibility').notNull().default('private'),
  behaviorGraph: jsonb('behavior_graph').notNull(),
  successCriteria: jsonb('success_criteria').notNull().default([]),
  provenance: jsonb('provenance').notNull().default({}),
  riskWeight: integer('risk_weight').notNull().default(1),
  variationPolicy: jsonb('variation_policy').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const datasetCaseVersions = pgTable('dataset_case_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => datasetCases.id, { onDelete: 'cascade' }),
  datasetVersion: integer('dataset_version').notNull(),
  graphVersion: integer('graph_version').notNull().default(1),
  behaviorGraph: jsonb('behavior_graph').notNull(),
  successCriteria: jsonb('success_criteria').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('dataset_case_versions_idx').on(table.caseId, table.datasetVersion, table.graphVersion)]);

export const datasetContributions = pgTable('dataset_contributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id').notNull().references(() => datasetCases.id, { onDelete: 'cascade' }),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  status: text('status').notNull().default('pending'),
  consentVersion: text('consent_version').notNull(),
  consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
  anonymizedGraph: jsonb('anonymized_graph').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  datasetId: uuid('dataset_id').notNull().references(() => datasets.id),
  datasetVersion: integer('dataset_version').notNull(),
  runtimeId: uuid('runtime_id').references(() => agentRuntimes.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  aggregateScores: jsonb('aggregate_scores'),
  config: jsonb('config').notNull().default({}),
  totalRuns: integer('total_runs').notNull().default(0),
  completedRuns: integer('completed_runs').notNull().default(0),
  effectiveConcurrency: integer('effective_concurrency').notNull().default(0),
  gitSha: text('git_sha'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  experimentId: uuid('experiment_id').references(() => experiments.id, { onDelete: 'cascade' }),
  caseId: uuid('case_id').references(() => datasetCases.id, { onDelete: 'set null' }),
  captureSessionId: uuid('capture_session_id').references(() => captureSessions.id, { onDelete: 'set null' }),
  variantIndex: integer('variant_index'),
  replayManifest: jsonb('replay_manifest'),
  impairmentProfile: jsonb('impairment_profile'),
  status: text('status').notNull().default('pending'),
  scoringStatus: text('scoring_status').notNull().default('pending'),
  externalStatus: text('external_status'),
  failureSummary: text('failure_summary'),
  audioCallerUrl: text('audio_caller_url'),
  audioCleanCallerUrl: text('audio_clean_caller_url'),
  audioImpairedCallerUrl: text('audio_impaired_caller_url'),
  audioAgentUrl: text('audio_agent_url'),
  judgeMetadata: jsonb('judge_metadata').notNull().default({}),
  retryCount: integer('retry_count').notNull().default(0),
  turnCount: integer('turn_count'),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const traces = pgTable('traces', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  turnIndex: integer('turn_index'),
  speaker: text('speaker'),
  text: text('text'),
  audioUrl: text('audio_url'),
  sttConfidence: doublePrecision('stt_confidence'),
  totalLatencyMs: integer('total_latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
  metricName: text('metric_name'),
  value: doublePrecision('value'),
  method: text('method'),
  rationale: text('rationale'),
  metadata: jsonb('metadata').notNull().default({}),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow(),
});

export const replayJobs = pgTable('replay_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  runtimeId: uuid('runtime_id').references(() => agentRuntimes.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('queued'),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  replaySeed: integer('replay_seed').notNull().default(42),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const replayResults = pgTable('replay_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => replayJobs.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  transcript: jsonb('transcript').notNull().default([]),
  metrics: jsonb('metrics').notNull().default({}),
  artifacts: jsonb('artifacts').notNull().default({}),
  judgeMetadata: jsonb('judge_metadata').notNull().default({}),
  graphPath: jsonb('graph_path').notNull().default([]),
  failureSummary: text('failure_summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const scoringJobs = pgTable('scoring_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('scoring_jobs_run_idx').on(table.runId)]);

export const replayUtterances = pgTable('replay_utterances', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  text: text('text').notNull(),
  embedding: jsonb('embedding').notNull(),
  nearestSimilarity: doublePrecision('nearest_similarity'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('replay_utterances_run_node_idx').on(table.runId, table.nodeId)]);

export const noiseAssets = pgTable('noise_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  category: text('category').notNull(),
  gcsUri: text('gcs_uri').notNull(),
  license: text('license').notNull(),
  sourceUrl: text('source_url').notNull(),
  attribution: text('attribution'),
  checksum: text('checksum').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  enabled: integer('enabled').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [uniqueIndex('noise_assets_key_idx').on(table.key)]);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  plan: text('plan').notNull().default('starter'),
  status: text('status').notNull().default('active'),
  dodoCustomerId: text('dodo_customer_id'),
  dodoSubscriptionId: text('dodo_subscription_id'),
  dodoPaymentId: text('dodo_payment_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const usageEvents = pgTable('usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  eventType: text('event_type').notNull(),
  minutes: doublePrecision('minutes').notNull().default(0),
  actions: integer('actions').notNull().default(0),
  sourceRunId: uuid('source_run_id').references(() => runs.id, { onDelete: 'set null' }),
  sourceExperimentId: uuid('source_experiment_id').references(() => experiments.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const billingEvents = pgTable('billing_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  ownerUserId: text('owner_user_id'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const sandboxSources = pgTable('sandbox_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  type: text('type').notNull(),
  name: text('name').notNull(),
  sourceKind: text('source_kind').notNull().default('upload'),
  schemaMapping: jsonb('schema_mapping'),
  sampleRows: jsonb('sample_rows').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const sandboxEnvironments = pgTable('sandbox_environments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  sourceId: uuid('source_id').references(() => sandboxSources.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  status: text('status').notNull().default('ready'),
  seedMetadata: jsonb('seed_metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const sandboxRecords = pgTable('sandbox_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  environmentId: uuid('environment_id').notNull().references(() => sandboxEnvironments.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  externalRef: text('external_ref'),
  data: jsonb('data').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const sandboxToolEvents = pgTable('sandbox_tool_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id),
  environmentId: uuid('environment_id').notNull().references(() => sandboxEnvironments.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  tool: text('tool').notNull(),
  action: text('action').notNull(),
  input: jsonb('input').notNull(),
  output: jsonb('output').notNull(),
  status: text('status').notNull().default('200 OK'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
