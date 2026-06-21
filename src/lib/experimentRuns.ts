import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, datasets, experiments, replayJobs, runs, usageEvents, agentRuntimes } from '@/db/schema';
import { compileReplayManifests, type ReplayCompilerConfig } from '@/lib/replayCompiler';

export async function createCompiledExperiment(params: {
  ownerUserId: string;
  dataset: typeof datasets.$inferSelect;
  runtime: typeof agentRuntimes.$inferSelect;
  cases: Array<typeof datasetCases.$inferSelect>;
  config?: ReplayCompilerConfig;
  name?: string;
  gitSha?: string | null;
}) {
  const history = await db.select({
    caseId: runs.caseId,
    total: sql<number>`count(*)::int`,
    failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')::int`,
  }).from(runs).where(and(eq(runs.ownerUserId, params.ownerUserId), isNotNull(runs.caseId))).groupBy(runs.caseId);
  const historyByCase = new Map(history.map((item) => [item.caseId, item.total ? item.failed / item.total : 0]));
  const compiled = compileReplayManifests(params.cases.map((item) => ({
    id: item.id,
    name: item.name,
    language: item.language,
    domain: item.domain,
    behaviorGraph: item.behaviorGraph,
    riskWeight: item.riskWeight,
    variationPolicy: item.variationPolicy,
    historicalFailureRate: historyByCase.get(item.id) ?? 0,
  })), params.config);

  return db.transaction(async (tx) => {
    const [experiment] = await tx.insert(experiments).values({
      ownerUserId: params.ownerUserId,
      name: params.name?.trim() || `${params.dataset.name} ${compiled.config.preset} evaluation`,
      datasetId: params.dataset.id,
      datasetVersion: params.dataset.currentVersion,
      runtimeId: params.runtime.id,
      status: 'queued',
      config: {
        ...compiled.config,
        graphSchema: 'lightcurve.human_behavior_graph.v2',
        judgeThresholds: { confidence: 0.8, borderlineDistance: 0.1, pass: 0.75 },
      },
      totalRuns: compiled.manifests.length,
      completedRuns: 0,
      effectiveConcurrency: 0,
      gitSha: params.gitSha ?? params.runtime.gitSha,
    }).returning();
    const createdRuns = await tx.insert(runs).values(compiled.manifests.map((manifest) => ({
      ownerUserId: params.ownerUserId,
      experimentId: experiment.id,
      caseId: manifest.caseId,
      variantIndex: manifest.variantIndex,
      replayManifest: manifest,
      impairmentProfile: manifest.impairment,
      status: 'queued',
      scoringStatus: 'pending',
    }))).returning();
    const runsByVariant = new Map(createdRuns.map((run) => [run.variantIndex, run]));
    await tx.insert(replayJobs).values(compiled.manifests.map((manifest) => {
      const run = runsByVariant.get(manifest.variantIndex);
      if (!run) throw new Error(`Run was not created for variant ${manifest.variantIndex}.`);
      return {
        ownerUserId: params.ownerUserId,
        runId: run.id,
        runtimeId: params.runtime.id,
        status: 'queued',
        replaySeed: manifest.seed,
        maxAttempts: 3,
      };
    }));
    await tx.insert(usageEvents).values({
      ownerUserId: params.ownerUserId,
      eventType: 'replay_scheduled',
      actions: compiled.manifests.length,
      minutes: 0,
      sourceExperimentId: experiment.id,
    });
    return { experiment, runs: createdRuns, config: compiled.config };
  });
}

export async function refreshExperimentProgress(experimentId: string) {
  const [progress] = await db.select({
    total: sql<number>`count(*)::int`,
    completed: sql<number>`count(*) filter (where ${runs.status} in ('complete', 'failed', 'scoring_failed'))::int`,
    failed: sql<number>`count(*) filter (where ${runs.status} in ('failed', 'scoring_failed'))::int`,
    running: sql<number>`count(*) filter (where ${runs.status} = 'running')::int`,
  }).from(runs).where(eq(runs.experimentId, experimentId));
  const terminal = progress.total > 0 && progress.completed === progress.total;
  await db.update(experiments).set({
    totalRuns: progress.total,
    completedRuns: progress.completed,
    effectiveConcurrency: progress.running,
    status: terminal ? (progress.failed ? 'failed' : 'complete') : progress.running ? 'running' : 'queued',
    completedAt: terminal ? new Date() : null,
  }).where(eq(experiments.id, experimentId));
  return progress;
}
