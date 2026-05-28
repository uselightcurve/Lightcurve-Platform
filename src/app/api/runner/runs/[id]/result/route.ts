import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { runs, scores, traces } from '@/db/schema';

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requireRunnerToken(req: Request) {
  const expected = process.env.RUNNER_INGEST_TOKEN;
  if (!expected) return true;
  const actual = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return actual === expected;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireRunnerToken(req)) {
    return NextResponse.json({ error: 'Unauthorized runner' }, { status: 401 });
  }

  const { id } = await params;
  const [run] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const body = await req.json();
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const judgeScores = asRecord(body.judgeScores ?? body.scores);
  const captureReport = asRecord(body.captureReport);

  await db.delete(traces).where(eq(traces.runId, id));
  if (transcript.length) {
    await db.insert(traces).values(
      transcript.map((turn: Record<string, unknown>, index: number) => ({
        runId: id,
        turnIndex: numberValue(turn.turnIndex) ?? index,
        speaker: String(turn.speaker ?? 'agent'),
        text: String(turn.text ?? ''),
        audioUrl: typeof turn.audioUrl === 'string' ? turn.audioUrl : null,
        sttConfidence: numberValue(turn.sttConfidence),
        totalLatencyMs: numberValue(turn.totalLatencyMs),
      })),
    );
  }

  await db.delete(scores).where(eq(scores.runId, id));
  const scoreRows = [
    ['mos', judgeScores.mos],
    ['task_completed', judgeScores.taskCompletion ?? judgeScores.task_completed],
    ['latency_p95', judgeScores.latencyP95 ?? judgeScores.latency_p95],
    ['capture_accuracy', captureReport.accuracy ?? judgeScores.captureAccuracy],
    ['pacing_drift', captureReport.pacingDrift ?? judgeScores.pacingDrift],
  ]
    .map(([metricName, value]) => ({ metricName: String(metricName), value: numberValue(value) }))
    .filter((item): item is { metricName: string; value: number } => typeof item.value === 'number');

  if (scoreRows.length) {
    await db.insert(scores).values(
      scoreRows.map((score) => ({
        runId: id,
        metricName: score.metricName,
        value: score.value,
        method: 'runner-result',
        rationale: String(body.failureSummary ?? body.recommendation ?? 'Runner submitted normalized result.'),
      })),
    );
  }

  const status = body.status === 'failed' ? 'failed' : 'complete';
  const [updatedRun] = await db
    .update(runs)
    .set({
      status,
      provider: String(body.provider ?? run.provider ?? 'bot_to_bot'),
      externalStatus: String(body.externalStatus ?? 'runner_result_received'),
      audioCallerUrl: typeof body.audioCallerUrl === 'string' ? body.audioCallerUrl : run.audioCallerUrl,
      audioAgentUrl: typeof body.audioAgentUrl === 'string' ? body.audioAgentUrl : run.audioAgentUrl,
      turnCount: transcript.length,
      durationMs: numberValue(body.durationMs) ?? run.durationMs,
      failureSummary: typeof body.failureSummary === 'string' ? body.failureSummary : run.failureSummary,
      endedAt: new Date(),
    })
    .where(eq(runs.id, id))
    .returning();

  return NextResponse.json({ run: updatedRun, traces: transcript.length, scores: scoreRows.length });
}
