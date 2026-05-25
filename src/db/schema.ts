import { pgTable, uuid, text, integer, jsonb, timestamp, boolean, doublePrecision } from 'drizzle-orm/pg-core';
import { AnyPgColumn } from 'drizzle-orm/pg-core';

export const scenarios = pgTable('scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  name: text('name').notNull(),
  agentType: text('agent_type').notNull(),
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
  experimentId: uuid('experiment_id').references(() => experiments.id),
  scenarioId: uuid('scenario_id').references(() => scenarios.id),
  status: text('status').default('pending'),
  dailyRoomUrl: text('daily_room_url'),
  audioCallerUrl: text('audio_caller_url'),
  audioAgentUrl: text('audio_agent_url'),
  turnCount: integer('turn_count'),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
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
