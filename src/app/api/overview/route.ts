import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, experiments, runs, scores } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { isMockMode, mockOverview } from '@/lib/mockData';

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function series(values: number[], fallback = 0) {
  return values.slice(-7).length ? values.slice(-7) : [fallback];
}

export async function GET() {
  if (isMockMode()) return NextResponse.json(mockOverview);
  try {
    const account = await requireAccount();
    const runRows = await db.select({ run: runs, case: datasetCases }).from(runs)
      .leftJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .where(eq(runs.ownerUserId, account.userId))
      .orderBy(desc(runs.startedAt), desc(runs.endedAt));
    const experimentRows = await db.select().from(experiments).where(eq(experiments.ownerUserId, account.userId)).orderBy(desc(experiments.createdAt));
    const runIds = runRows.map((row) => row.run.id);
    const allScores = runIds.length ? await db.select().from(scores).where(inArray(scores.runId, runIds)) : [];
    const metric = (runId: string, name: string) => allScores.find((score) => score.runId === runId && score.metricName === name)?.value ?? null;
    const mos = runRows.flatMap(({ run }) => { const value = metric(run.id, 'dnsmos_overall') ?? metric(run.id, 'visqol_mos') ?? metric(run.id, 'mos'); return typeof value === 'number' ? [value] : []; });
    const task = runRows.flatMap(({ run }) => { const value = metric(run.id, 'task_completed') ?? metric(run.id, 'outcome_match'); return typeof value === 'number' ? [value] : []; });
    const latency = runRows.flatMap(({ run }) => { const value = metric(run.id, 'latency_p95'); return typeof value === 'number' ? [value] : []; });
    const failed = runRows.filter(({ run }) => run.status === 'failed');
    return NextResponse.json({
      panels: {
        calls: { value: runRows.length, series: series(runRows.map((_, index) => index + 1), runRows.length) },
        mos: { value: average(mos), series: series(mos, average(mos)) },
        task: { value: average(task), series: series(task.map((value) => value * 100), average(task) * 100) },
        latency: { value: latency.length ? Math.max(...latency) : 0, series: series(latency.map((value) => value / 1000), 0) },
        failures: { value: failed.length, series: series(runRows.map(({ run }) => run.status === 'failed' ? 1 : 0), failed.length) },
        experiments: { value: experimentRows.length, series: series(experimentRows.map((_, index) => index + 1), experimentRows.length) },
      },
      recentExperiments: experimentRows.slice(0, 5).map((experiment) => ({
        id: experiment.id,
        name: experiment.name,
        status: experiment.status,
        mos: average(mos),
        date: experiment.createdAt ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(experiment.createdAt) : '-',
      })),
      failingCases: failed.slice(0, 5).map(({ run, case: item }) => ({
        runId: run.id,
        experimentId: run.experimentId,
        name: item?.name ?? 'Dataset case',
        reason: run.failureSummary ?? 'Missed release gate',
        score: metric(run.id, 'outcome_match') ?? 0,
      })),
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Overview unavailable.' }, { status: 503 });
  }
}
