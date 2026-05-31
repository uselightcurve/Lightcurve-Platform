import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios, scores, traces, usageEvents } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { isProviderBackedSandbox, pollProviderSandboxCall } from '@/lib/sandboxProviders';
import { recordUsageEvent, requireAccount, unauthorizedJson } from '@/lib/account';
import { hydrateExperimentAgentConfig } from '@/lib/agentConnections';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
  const account = await requireAccount();
  const { id } = await params;
  const runData = await db.select().from(runs).where(and(eq(runs.id, id), eq(runs.ownerUserId, account.userId)));
  const run = runData[0];
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const experimentData = await db.select().from(experiments).where(and(eq(experiments.id, run.experimentId!), eq(experiments.ownerUserId, account.userId)));
  const experiment = experimentData[0] ? await hydrateExperimentAgentConfig(experimentData[0]) : undefined;
  if (!experiment) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });

  if (!isProviderBackedSandbox(experiment) && !run.provider) {
    return NextResponse.json({ error: 'Run is not backed by a provider poller' }, { status: 400 });
  }

  if (!run.externalCallId) {
    return NextResponse.json({ error: 'Run does not have an external call id yet' }, { status: 409 });
  }

  const scenarioData = await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId!));
  const scenario = scenarioData[0];
  const normalized = await pollProviderSandboxCall(experiment, run, scenario);

  await db.delete(traces).where(eq(traces.runId, id));
  if (normalized.traces.length) {
    await db.insert(traces).values(
      normalized.traces.map((trace) => ({
        runId: id,
        turnIndex: trace.turnIndex,
        speaker: trace.speaker,
        text: trace.text,
        audioUrl: trace.audioUrl,
        sttConfidence: trace.sttConfidence,
        totalLatencyMs: trace.totalLatencyMs,
      })),
    );
  }

  await db.delete(scores).where(eq(scores.runId, id));
  if (normalized.scores.length) {
    await db.insert(scores).values(
      normalized.scores.map((score) => ({
        runId: id,
        metricName: score.metricName,
        value: score.value,
        method: score.method,
        rationale: score.rationale,
      })),
    );
  }

  const isTerminal = normalized.runStatus === 'complete' || normalized.runStatus === 'failed';
  const updatedRunData = await db
    .update(runs)
    .set({
      status: normalized.runStatus,
      externalStatus: normalized.externalStatus,
      audioCallerUrl: normalized.audioCallerUrl,
      audioAgentUrl: normalized.audioAgentUrl,
      durationMs: normalized.durationMs,
      turnCount: normalized.traces.length,
      endedAt: isTerminal ? (normalized.endedAt ?? new Date()) : undefined,
      failureSummary: normalized.runStatus === 'failed' ? normalized.failureSummary : undefined,
    })
    .where(eq(runs.id, id))
    .returning();

  if (isTerminal) {
    const expRuns = await db.select().from(runs).where(eq(runs.experimentId, experiment.id));
    const allDone = expRuns.every((item) => item.id === id || item.status === 'complete' || item.status === 'failed');
    if (allDone) {
      await db
        .update(experiments)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(experiments.id, experiment.id));
    }
    const shouldRecordUsage = normalized.runStatus === 'complete' && (updatedRunData[0].durationMs ?? 0) > 0;
    const existingUsage = shouldRecordUsage
      ? await db.select().from(usageEvents).where(and(eq(usageEvents.sourceRunId, id), eq(usageEvents.eventType, 'run_completed'))).limit(1)
      : [];
    if (shouldRecordUsage && !existingUsage.length) {
      await recordUsageEvent({
        userId: account.userId,
        eventType: 'run_completed',
        minutes: (updatedRunData[0].durationMs ?? 0) / 60000,
        actions: Math.max(1, normalized.traces.length),
        sourceRunId: id,
        sourceExperimentId: experiment.id,
      });
    }
  }

  const runTraces = await db.select().from(traces).where(eq(traces.runId, id));
  const runScores = await db.select().from(scores).where(eq(scores.runId, id));

  return NextResponse.json({
    success: true,
    run: updatedRunData[0],
    scenario: scenario ?? null,
    traces: runTraces,
    scores: runScores,
    externalStatus: normalized.externalStatus,
  });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to poll run', error);
    return NextResponse.json({ error: 'Run poll failed' }, { status: 500 });
  }
}
