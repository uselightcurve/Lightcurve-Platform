import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios, scores, traces } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getVapiCall, normalizeVapiCall } from '@/lib/vapi';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runData = await db.select().from(runs).where(eq(runs.id, id));
  const run = runData[0];
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const experimentData = await db.select().from(experiments).where(eq(experiments.id, run.experimentId!));
  const experiment = experimentData[0];
  if (!experiment) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });

  if (run.provider !== 'vapi' && experiment.agentType !== 'vapi') {
    return NextResponse.json({ error: 'Run is not backed by Vapi' }, { status: 400 });
  }

  if (!run.externalCallId) {
    return NextResponse.json({ error: 'Run does not have a Vapi call id yet' }, { status: 409 });
  }

  const scenarioData = await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId!));
  const scenario = scenarioData[0];
  const call = await getVapiCall(experiment, run.externalCallId);
  const normalized = normalizeVapiCall(call, scenario);

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
}
