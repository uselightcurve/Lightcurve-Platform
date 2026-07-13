import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  conversationEvaluations,
  datasetCases,
  experiments,
  replayJobs,
  replayResults,
  runs,
  traces,
} from '@/db/schema';
import { buildModelOrbitEvaluation, type ModelOrbitEvaluation } from '@/lib/modelOrbit';
import { MODEL_ORBIT_RUBRIC } from '@/lib/modelOrbitRubric';
import { analyzeConversationVoices } from '@/lib/modelOrbitService';

export async function evaluateStoredConversation(params: {
  ownerUserId: string;
  runId: string;
  force?: boolean;
}) {
  const [row] = await db.select({ run: runs, case: datasetCases, experiment: experiments })
    .from(runs)
    .leftJoin(datasetCases, eq(datasetCases.id, runs.caseId))
    .leftJoin(experiments, eq(experiments.id, runs.experimentId))
    .where(and(eq(runs.id, params.runId), eq(runs.ownerUserId, params.ownerUserId)))
    .limit(1);
  if (!row) throw new Error('Call not found.');

  const [traceRows, jobRows] = await Promise.all([
    db.select().from(traces).where(eq(traces.runId, params.runId)).orderBy(asc(traces.turnIndex)),
    db.select().from(replayJobs).where(eq(replayJobs.runId, params.runId)).limit(1),
  ]);
  const resultRows = jobRows[0]
    ? await db.select().from(replayResults).where(eq(replayResults.jobId, jobRows[0].id)).limit(1)
    : [];
  const transcript = Array.isArray(resultRows[0]?.transcript) && resultRows[0].transcript.length
    ? resultRows[0].transcript
    : traceRows;
  if (!Array.isArray(transcript) || !transcript.length) throw new Error('This call does not have a transcript yet.');

  const sourceHash = createHash('sha256').update(JSON.stringify({
    transcript,
    traces: traceRows.map((trace) => ({
      turnIndex: trace.turnIndex,
      speaker: trace.speaker,
      text: trace.text,
      latency: trace.totalLatencyMs,
    })),
    graph: row.case?.behaviorGraph,
    humanAudio: row.run.audioImpairedCallerUrl ?? row.run.audioCleanCallerUrl,
    agentAudio: row.run.audioAgentUrl,
    rubric: MODEL_ORBIT_RUBRIC.version,
  })).digest('hex');

  const [cached] = await db.select().from(conversationEvaluations).where(and(
    eq(conversationEvaluations.runId, params.runId),
    eq(conversationEvaluations.rubricVersion, MODEL_ORBIT_RUBRIC.version),
  )).limit(1);
  if (!params.force && cached?.status === 'complete' && cached.sourceHash === sourceHash) {
    return {
      run: {
        id: row.run.id,
        name: row.case?.name ?? 'Voice call',
        experiment: row.experiment?.name ?? 'Automated test',
        status: row.run.status,
      },
      evaluation: cached.result as ModelOrbitEvaluation,
      storedAt: cached.updatedAt,
      cached: true,
    };
  }

  await db.insert(conversationEvaluations).values({
    ownerUserId: params.ownerUserId,
    runId: params.runId,
    status: 'processing',
    rubricVersion: MODEL_ORBIT_RUBRIC.version,
    sourceHash,
    result: {},
    voiceSignals: {},
    lastError: null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [conversationEvaluations.runId, conversationEvaluations.rubricVersion],
    set: { status: 'processing', sourceHash, lastError: null, updatedAt: new Date() },
  });

  let voice = null;
  let voiceWarning: string | null = null;
  try {
    voice = await analyzeConversationVoices({
      humanUri: row.run.audioImpairedCallerUrl ?? row.run.audioCleanCallerUrl,
      agentUri: row.run.audioAgentUrl,
    });
  } catch (error) {
    voiceWarning = error instanceof Error ? error.message : 'Voice measurements were unavailable.';
  }

  try {
    const evaluation = buildModelOrbitEvaluation({
      transcript,
      traces: traceRows,
      graph: row.case?.behaviorGraph,
      voice: voice ? { human: voice.human, agent: voice.agent } : undefined,
    });
    if (voiceWarning) evaluation.summary.limitations.push('Voice measurements could not be completed for this call.');
    const [stored] = await db.insert(conversationEvaluations).values({
      ownerUserId: params.ownerUserId,
      runId: params.runId,
      status: 'complete',
      rubricVersion: MODEL_ORBIT_RUBRIC.version,
      sourceHash,
      result: evaluation,
      voiceSignals: voice ?? {},
      lastError: voiceWarning,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [conversationEvaluations.runId, conversationEvaluations.rubricVersion],
      set: {
        status: 'complete',
        sourceHash,
        result: evaluation,
        voiceSignals: voice ?? {},
        lastError: voiceWarning,
        updatedAt: new Date(),
      },
    }).returning();
    return {
      run: {
        id: row.run.id,
        name: row.case?.name ?? 'Voice call',
        experiment: row.experiment?.name ?? 'Automated test',
        status: row.run.status,
      },
      evaluation,
      storedAt: stored.updatedAt,
      cached: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Evaluation failed.';
    await db.update(conversationEvaluations).set({ status: 'failed', lastError: message, updatedAt: new Date() }).where(and(
      eq(conversationEvaluations.runId, params.runId),
      eq(conversationEvaluations.rubricVersion, MODEL_ORBIT_RUBRIC.version),
    ));
    throw error;
  }
}

