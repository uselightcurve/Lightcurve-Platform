import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs, scenarios, scores, traces } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

function scoreValue(rows: Array<typeof scores.$inferSelect>, metric: string) {
  return rows.find((score) => score.metricName === metric)?.value ?? null;
}

function formatDuration(durationMs: number | null | undefined) {
  if (!durationMs) return '-';
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatDate(value: Date | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(value);
}

export async function GET() {
  try {
    const account = await requireAccount();
    const runRows = await db
      .select()
      .from(runs)
      .where(eq(runs.ownerUserId, account.userId))
      .orderBy(desc(runs.startedAt), desc(runs.endedAt));

    const data = [];
    for (const run of runRows) {
      const [scenario] = run.scenarioId
        ? await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId)).limit(1)
        : [];
      const [experiment] = run.experimentId
        ? await db.select().from(experiments).where(eq(experiments.id, run.experimentId)).limit(1)
        : [];
      const runScores = await db.select().from(scores).where(eq(scores.runId, run.id));
      const runTraces = await db.select().from(traces).where(eq(traces.runId, run.id));
      const mos = scoreValue(runScores, 'mos');
      const task = scoreValue(runScores, 'task_completed') ?? scoreValue(runScores, 'capture_overall');
      const latency = scoreValue(runScores, 'latency_p95');
      const stt = scoreValue(runScores, 'stt_confidence');
      const persona = scenario?.persona && typeof scenario.persona === 'object' ? scenario.persona as Record<string, unknown> : {};

      data.push({
        id: run.id,
        experimentId: run.experimentId,
        scenarioId: run.scenarioId,
        scenarioName: scenario?.name ?? 'Unknown scenario',
        language: scenario?.language ?? '-',
        domain: scenario?.domain ?? '-',
        emotion: typeof persona.emotional_state === 'string' ? persona.emotional_state : '-',
        agent: experiment?.webrtcEndpoint || experiment?.agentType || run.provider || '-',
        status: run.status ?? 'pending',
        mos,
        task,
        duration: formatDuration(run.durationMs),
        durationMs: run.durationMs ?? 0,
        latencyP95: latency ?? 0,
        sttConfidence: stt ?? 0,
        date: formatDate(run.startedAt ?? run.endedAt),
        transcript: runTraces.map((trace) => trace.text).filter(Boolean).join(' '),
        traces: runTraces,
        scores: runScores,
        failureSummary: run.failureSummary,
        externalStatus: run.externalStatus,
      });
    }

    return NextResponse.json({ runs: data });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load runs', error);
    return NextResponse.json({ error: 'Runs unavailable' }, { status: 503 });
  }
}
