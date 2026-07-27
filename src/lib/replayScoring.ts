import { createHash } from 'node:crypto';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, replayJobs, replayResults, runs, scores, scoringJobs, traces } from '@/db/schema';
import { refreshExperimentProgress } from '@/lib/experimentRuns';
import { anonymizeBehaviorGraph } from '@/lib/humanDatasets';
import { scoreVoiceReplay } from '@/lib/voiceScoring';
import { evaluateStoredConversation } from '@/lib/modelOrbitBackend';
import { downloadPrivateAudioObject, isPrivateAudioUri } from '@/lib/captureStorage';

function retryAt(attempt: number) {
  return new Date(Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1)));
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

async function audioHash(uri: unknown) {
  if (typeof uri !== 'string' || !isPrivateAudioUri(uri)) return null;
  return sha256(await downloadPrivateAudioObject(uri));
}

async function callerPairHashes(params: {
  artifacts: unknown;
  cleanCallerUri: unknown;
  impairedCallerUri: unknown;
}) {
  const artifacts = params.artifacts && typeof params.artifacts === 'object' && !Array.isArray(params.artifacts)
    ? params.artifacts as Record<string, unknown>
    : {};
  const turns = Array.isArray(artifacts.callerTurns) ? artifacts.callerTurns : [];
  const pairs = turns.flatMap((item) => {
    const turn = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const clean = typeof turn.cleanAudioUrl === 'string' && isPrivateAudioUri(turn.cleanAudioUrl) ? turn.cleanAudioUrl : null;
    const impaired = typeof turn.impairedAudioUrl === 'string' && isPrivateAudioUri(turn.impairedAudioUrl) ? turn.impairedAudioUrl : null;
    return clean && impaired
      ? [{ clean, impaired }]
      : [];
  });
  const sourcePairs = pairs.length
    ? pairs
    : typeof params.cleanCallerUri === 'string'
      && typeof params.impairedCallerUri === 'string'
      && isPrivateAudioUri(params.cleanCallerUri)
      && isPrivateAudioUri(params.impairedCallerUri)
      ? [{ clean: params.cleanCallerUri, impaired: params.impairedCallerUri }]
      : [];
  return Promise.all(sourcePairs.map(async (pair) => ({
    cleanSha256: await audioHash(pair.clean),
    impairedSha256: await audioHash(pair.impaired),
  })));
}

async function scoringInputHash(params: {
  graph: unknown;
  successCriteria: unknown;
  manifest: unknown;
  transcript: Array<{ speaker: string; text: string }>;
  cleanCallerUri: unknown;
  impairedCallerUri: unknown;
  agentUri: unknown;
  artifacts: unknown;
  judgePolicy: string;
}) {
  const callerPairs = await callerPairHashes(params);
  const agentSha256 = await audioHash(params.agentUri);
  const hasAudioIdentity = Boolean(agentSha256 || callerPairs.some((pair) => pair.cleanSha256 || pair.impairedSha256));
  return sha256(stableJson({
    version: 1,
    graph: params.graph,
    successCriteria: params.successCriteria,
    manifest: params.manifest,
    ...(!hasAudioIdentity ? { transcript: params.transcript } : {}),
    judgePolicy: params.judgePolicy,
    callerPairs,
    agentSha256,
  }));
}

async function copyCachedScores(params: {
  ownerUserId: string;
  runId: string;
  caseId: string | null;
  inputHash: string;
}) {
  const [cached] = await db.select({
    runId: scores.runId,
    status: runs.status,
    failureSummary: runs.failureSummary,
    judgeMetadata: runs.judgeMetadata,
  })
    .from(scores)
    .innerJoin(runs, eq(runs.id, scores.runId))
    .where(and(
      eq(runs.ownerUserId, params.ownerUserId),
      params.caseId ? eq(runs.caseId, params.caseId) : sql`true`,
      eq(scores.metricName, 'outcome_match'),
      sql`${scores.metadata}->>'scoringInputHash' = ${params.inputHash}`,
    ))
    .limit(1);
  if (!cached?.runId || cached.runId === params.runId) return false;
  const cachedRows = await db.select().from(scores).where(eq(scores.runId, cached.runId));
  if (!cachedRows.length) return false;
  const metricValues = Object.fromEntries(cachedRows.flatMap((score) => (
    score.metricName && typeof score.value === 'number' ? [[score.metricName, score.value]] : []
  )));
  const judgeMetadata = cached.judgeMetadata as Record<string, unknown>;
  const final = {
    ...(judgeMetadata.pro && typeof judgeMetadata.pro === 'object' ? judgeMetadata.pro as Record<string, unknown> : {}),
    ...(judgeMetadata.flash && typeof judgeMetadata.flash === 'object' ? judgeMetadata.flash as Record<string, unknown> : {}),
    ...judgeMetadata,
    metrics: metricValues,
    cached: true,
    copiedFromRunId: cached.runId,
    scoringInputHash: params.inputHash,
  };
  await db.transaction(async (tx) => {
    await tx.delete(scores).where(eq(scores.runId, params.runId));
    await tx.insert(scores).values(cachedRows.map((score) => ({
      runId: params.runId,
      metricName: score.metricName,
      value: score.value,
      method: score.method,
      rationale: score.rationale,
      metadata: { ...(score.metadata as Record<string, unknown>), scoringInputHash: params.inputHash, copiedFromRunId: cached.runId },
    })));
    await tx.update(runs).set({
      status: cached.status,
      scoringStatus: 'complete',
      failureSummary: cached.failureSummary,
      judgeMetadata: { ...(cached.judgeMetadata as Record<string, unknown>), scoringInputHash: params.inputHash, copiedFromRunId: cached.runId },
      endedAt: new Date(),
    }).where(eq(runs.id, params.runId));
    await tx.update(scoringJobs).set({ status: 'complete', lastError: null, updatedAt: new Date() }).where(eq(scoringJobs.runId, params.runId));
  });
  return final;
}

export async function queueReplayScoring(runId: string, message?: string) {
  await db.insert(scoringJobs).values({ runId, status: 'queued', lastError: message ?? null })
    .onConflictDoUpdate({
      target: scoringJobs.runId,
      set: { status: 'queued', lastError: message ?? null, nextAttemptAt: new Date(), updatedAt: new Date() },
    });
  await db.update(runs).set({ scoringStatus: 'queued' }).where(eq(runs.id, runId));
}

export async function scoreStoredReplay(runId: string) {
  const [row] = await db.select({ run: runs, case: datasetCases, job: replayJobs, result: replayResults })
    .from(runs)
    .innerJoin(datasetCases, eq(datasetCases.id, runs.caseId))
    .innerJoin(replayJobs, eq(replayJobs.runId, runs.id))
    .innerJoin(replayResults, eq(replayResults.jobId, replayJobs.id))
    .where(eq(runs.id, runId))
    .limit(1);
  if (!row) throw new Error('The replay is not ready for scoring.');
  const transcript = Array.isArray(row.result.transcript)
    ? row.result.transcript.flatMap((item) => {
      const turn = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return typeof turn.speaker === 'string' && typeof turn.text === 'string' ? [{ speaker: turn.speaker, text: turn.text }] : [];
    })
    : [];
  const judgePolicy = (() => {
    const manifest = row.run.replayManifest && typeof row.run.replayManifest === 'object' ? row.run.replayManifest as Record<string, unknown> : {};
    return manifest.judgePolicy === 'pro' || manifest.judgePolicy === 'flash' ? manifest.judgePolicy : 'flash-pro-review';
  })();
  const graph = anonymizeBehaviorGraph(row.case.behaviorGraph);
  const inputHash = await scoringInputHash({
    graph,
    successCriteria: row.case.successCriteria,
    manifest: row.run.replayManifest,
    transcript,
    cleanCallerUri: row.run.audioCleanCallerUrl,
    impairedCallerUri: row.run.audioImpairedCallerUrl,
    agentUri: row.run.audioAgentUrl,
    artifacts: row.result.artifacts,
    judgePolicy,
  });
  const cachedFinal = await copyCachedScores({ ownerUserId: row.run.ownerUserId, runId, caseId: row.run.caseId, inputHash });
  if (cachedFinal) {
    if (row.run.experimentId) await refreshExperimentProgress(row.run.experimentId);
    return { cached: true, scoringInputHash: inputHash, final: cachedFinal };
  }
  const result = await scoreVoiceReplay({
    graph,
    successCriteria: row.case.successCriteria,
    manifest: row.run.replayManifest,
    transcript,
    cleanCallerUri: row.run.audioCleanCallerUrl,
    impairedCallerUri: row.run.audioImpairedCallerUrl,
    agentUri: row.run.audioAgentUrl,
    artifacts: row.result.artifacts,
    judgePolicy,
  });
  const final = result.final;
  const traceRows = await db.select({ latency: traces.totalLatencyMs }).from(traces).where(eq(traces.runId, runId));
  const latencies = traceRows.flatMap((trace) => typeof trace.latency === 'number' ? [trace.latency] : []).sort((left, right) => left - right);
  const latencyP95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : null;
  const metadata = {
    confidence: final.confidence,
    failureTaxonomy: final.failureTaxonomy,
    hardConstraintFailure: final.hardConstraintFailure,
    failingGraphNode: final.failingGraphNode,
    pressurePoint: final.pressurePoint,
    rationale: final.rationale,
    actionableFixes: final.actionableFixes,
    decisionTrace: final.decisionTrace,
    flash: result.flash,
    pro: result.pro,
    flashModel: result.flashModel,
    proModel: result.proModel,
    mosServiceVersion: result.mos.serviceVersion,
    scoringInputHash: inputHash,
  };
  await db.transaction(async (tx) => {
    await tx.delete(scores).where(eq(scores.runId, runId));
    await tx.insert(scores).values([
      { runId, metricName: 'outcome_match', value: final.outcomeMatch, method: 'qwen-transcript-voice-graph-judge', rationale: final.rationale, metadata },
      { runId, metricName: 'behavioral_path', value: final.behavioralPath, method: 'qwen-transcript-voice-graph-judge', rationale: final.rationale, metadata },
      { runId, metricName: 'tool_correctness', value: final.toolCorrectness, method: 'qwen-transcript-voice-graph-judge', rationale: final.rationale, metadata },
      { runId, metricName: 'safety', value: final.safety, method: 'qwen-transcript-voice-graph-judge', rationale: final.rationale, metadata },
      { runId, metricName: 'latency_behavior', value: final.latencyBehavior, method: 'qwen-transcript-voice-graph-judge', rationale: final.rationale, metadata },
      { runId, metricName: 'interruption_handling', value: final.interruptionHandling, method: 'qwen-transcript-voice-graph-judge', rationale: final.rationale, metadata },
      { runId, metricName: 'gemini_conversation_quality', value: final.conversationalQuality, method: 'qwen-transcript', rationale: final.rationale, metadata },
      { runId, metricName: 'visqol_mos', value: result.mos.visqol.mosLqo, method: 'visqol', metadata: { pairCount: result.mos.visqol.pairCount, scoringInputHash: inputHash } },
      { runId, metricName: 'dnsmos_overall', value: result.mos.dnsmos.overall, method: 'dnsmos-p835', metadata: { scoringInputHash: inputHash } },
      { runId, metricName: 'dnsmos_signal', value: result.mos.dnsmos.signal, method: 'dnsmos-p835', metadata: { scoringInputHash: inputHash } },
      { runId, metricName: 'dnsmos_background', value: result.mos.dnsmos.background, method: 'dnsmos-p835', metadata: { scoringInputHash: inputHash } },
      ...(latencyP95 == null ? [] : [{ runId, metricName: 'latency_p95', value: latencyP95, method: 'sdk-measured', metadata: { scoringInputHash: inputHash } }]),
    ]);
    await tx.update(replayResults).set({
      status: final.passed ? 'pass' : 'fail',
      metrics: { ...result.mos, judgment: final },
      judgeMetadata: metadata,
      failureSummary: final.failureSummary,
    }).where(eq(replayResults.id, row.result.id));
    await tx.update(runs).set({
      status: final.passed ? 'complete' : 'failed',
      scoringStatus: 'complete',
      failureSummary: final.failureSummary,
      judgeMetadata: metadata,
      endedAt: new Date(),
    }).where(eq(runs.id, runId));
    await tx.update(scoringJobs).set({ status: 'complete', lastError: null, updatedAt: new Date() }).where(eq(scoringJobs.runId, runId));
  });
  await evaluateStoredConversation({
    ownerUserId: row.run.ownerUserId,
    runId,
    force: true,
  }).catch((error) => console.warn('Conversation evaluation will be retried when opened.', error));
  if (row.run.experimentId) await refreshExperimentProgress(row.run.experimentId);
  return result;
}

export async function processReplayScoring(runId: string) {
  const [job] = await db.select().from(scoringJobs).where(eq(scoringJobs.runId, runId)).limit(1);
  if (!job) throw new Error('Scoring job not found.');
  await db.update(scoringJobs).set({ status: 'running', attemptCount: job.attemptCount + 1, nextAttemptAt: new Date(Date.now() + 10 * 60_000), updatedAt: new Date() }).where(eq(scoringJobs.id, job.id));
  await db.update(runs).set({ scoringStatus: 'running', retryCount: job.attemptCount }).where(eq(runs.id, runId));
  try {
    return await scoreStoredReplay(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Replay scoring failed.';
    const exhausted = job.attemptCount + 1 >= job.maxAttempts;
    await db.update(scoringJobs).set({
      status: exhausted ? 'retry_exhausted' : 'queued',
      lastError: message,
      nextAttemptAt: retryAt(job.attemptCount + 1),
      updatedAt: new Date(),
    }).where(eq(scoringJobs.id, job.id));
    await db.update(runs).set({
      scoringStatus: exhausted ? 'retry_exhausted' : 'queued',
      retryCount: job.attemptCount + 1,
      ...(exhausted ? { status: 'scoring_failed', failureSummary: message, endedAt: new Date() } : {}),
    }).where(eq(runs.id, runId));
    if (exhausted) {
      const [run] = await db.select({ experimentId: runs.experimentId }).from(runs).where(eq(runs.id, runId)).limit(1);
      if (run?.experimentId) await refreshExperimentProgress(run.experimentId);
    }
    throw error;
  }
}

export async function processDueScoringJobs(limit = 5) {
  const due = await db.select().from(scoringJobs).where(and(
    or(eq(scoringJobs.status, 'queued'), eq(scoringJobs.status, 'running')),
    lte(scoringJobs.nextAttemptAt, new Date()),
  )).limit(Math.max(1, Math.min(25, limit)));
  const results = [];
  for (const job of due) {
    try {
      await processReplayScoring(job.runId);
      results.push({ runId: job.runId, status: 'complete' });
    } catch (error) {
      results.push({ runId: job.runId, status: 'retry', error: error instanceof Error ? error.message : 'Scoring failed.' });
    }
  }
  return results;
}
