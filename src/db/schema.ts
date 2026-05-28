import { pgTable, uuid, text, integer, jsonb, timestamp, boolean, doublePrecision } from 'drizzle-orm/pg-core';
import { AnyPgColumn } from 'drizzle-orm/pg-core';

export const scenarios = pgTable('scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id'),
  name: text('name').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => scenarios.id),
  language: text('language').notNull(),
  persona: jsonb('persona').notNull(),
  successCriteria: jsonb('success_criteria').notNull(),
  callerSeed: integer('caller_seed').default(42),
  domain: text('domain'),
  isPreset: boolean('is_preset').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id'),
  name: text('name').notNull(),
  agentType: text('agent_type').notNull(),
  agentConnectionId: uuid('agent_connection_id').references((): AnyPgColumn => agentConnections.id),
  agentConfig: jsonb('agent_config').notNull(),
  webrtcEndpoint: text('webrtc_endpoint').notNull(),
  scenarioIds: uuid('scenario_ids').array(),
  status: text('status').default('pending'),
  aggregateScores: jsonb('aggregate_scores'),
  gitSha: text('git_sha'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id'),
  experimentId: uuid('experiment_id').references(() => experiments.id),
  scenarioId: uuid('scenario_id').references(() => scenarios.id),
  status: text('status').default('pending'),
  provider: text('provider'),
  externalCallId: text('external_call_id'),
  externalStatus: text('external_status'),
  failureSummary: text('failure_summary'),
  dailyRoomUrl: text('daily_room_url'),
  audioCallerUrl: text('audio_caller_url'),
  audioAgentUrl: text('audio_agent_url'),
  turnCount: integer('turn_count'),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const agentConnections = pgTable('agent_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: text('owner_user_id').notNull().references((): AnyPgColumn => users.id),
  provider: text('provider').notNull(),
  displayName: text('display_name').notNull(),
  endpointType: text('endpoint_type').notNull(),
  endpoint: text('endpoint'),
  encryptedCredentials: text('encrypted_credentials'),
  credentialsPreview: jsonb('credentials_preview'),
  healthStatus: text('health_status').notNull().default('untested'),
  healthMessage: text('health_message'),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const traces = pgTable('traces', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => runs.id),
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
  runId: uuid('run_id').references(() => runs.id),
  metricName: text('metric_name'),
  value: doublePrecision('value'),
  method: text('method'),
  rationale: text('rationale'),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

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
  sourceRunId: uuid('source_run_id').references(() => runs.id),
  sourceExperimentId: uuid('source_experiment_id').references(() => experiments.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const billingEvents = pgTable('billing_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  ownerUserId: text('owner_user_id'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
