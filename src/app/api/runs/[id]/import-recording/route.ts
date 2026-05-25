import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scores, traces } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { finalizeImportedRecording } from '@/lib/sandboxProviders';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runData = await db.select().from(runs).where(eq(runs.id, id));
  const run = runData[0];
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const normalized = await finalizeImportedRecording(body);

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

  const updatedRunData = await db
    .update(runs)
    .set({
      status: normalized.runStatus,
      externalStatus: normalized.externalStatus,
      audioCallerUrl: normalized.audioCallerUrl,
      audioAgentUrl: normalized.audioAgentUrl,
      durationMs: normalized.durationMs,
      turnCount: normalized.traces.length,
      endedAt: normalized.endedAt ?? new Date(),
      failureSummary: normalized.failureSummary,
    })
    .where(eq(runs.id, id))
    .returning();

  if (run.experimentId) {
    const expRuns = await db.select().from(runs).where(eq(runs.experimentId, run.experimentId));
    const allDone = expRuns.every((item) => item.id === id || item.status === 'complete' || item.status === 'failed');
    if (allDone) {
      await db
        .update(experiments)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(experiments.id, run.experimentId));
    }
  }

  const runTraces = await db.select().from(traces).where(eq(traces.runId, id));
  const runScores = await db.select().from(scores).where(eq(scores.runId, id));

  return NextResponse.json({
    success: true,
    run: updatedRunData[0],
    traces: runTraces,
    scores: runScores,
  });
}
