import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs, scores, scenarios } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function scoreValue(rows: Array<typeof scores.$inferSelect>, metric: string) {
  return rows.find((score) => score.metricName === metric)?.value ?? null;
}

function seriesFrom(values: number[], fallback = 0) {
  const series = values.slice(-7);
  return series.length ? series : [fallback];
}

function formatDate(value: Date | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(value);
}

export async function GET() {
  try {
    const account = await requireAccount();
    const runRows = await db
      .select()
      .from(runs)
      .where(eq(runs.ownerUserId, account.userId))
      .orderBy(desc(runs.startedAt), desc(runs.endedAt));
    const experimentRows = await db
      .select()
      .from(experiments)
      .where(eq(experiments.ownerUserId, account.userId))
      .orderBy(desc(experiments.createdAt));

    const runsWithScores = [];
    for (const run of runRows) {
      const runScores = await db.select().from(scores).where(eq(scores.runId, run.id));
      const [scenario] = run.scenarioId
        ? await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId)).limit(1)
        : [];
      const mos = scoreValue(runScores, 'mos');
      const task = scoreValue(runScores, 'task_completed') ?? scoreValue(runScores, 'capture_overall');
      const latency = scoreValue(runScores, 'latency_p95');
      runsWithScores.push({ run, scenario, mos, task, latency });
    }

    const mosValues = runsWithScores.map((item) => item.mos).filter((value): value is number => typeof value === 'number');
    const taskValues = runsWithScores.map((item) => item.task).filter((value): value is number => typeof value === 'number');
    const latencyValues = runsWithScores.map((item) => item.latency).filter((value): value is number => typeof value === 'number');
    const failed = runsWithScores.filter((item) => item.run.status === 'failed' || item.run.status === 'fail');

    const recentExperiments = [];
    for (const experiment of experimentRows.slice(0, 5)) {
      const expRuns = runRows.filter((run) => run.experimentId === experiment.id);
      const expScores = [];
      for (const run of expRuns) {
        expScores.push(...await db.select().from(scores).where(eq(scores.runId, run.id)));
      }
      const expMos = expScores.filter((score) => score.metricName === 'mos').map((score) => Number(score.value ?? 0));
      recentExperiments.push({
        id: experiment.id,
        name: experiment.name,
        status: experiment.status,
        mos: average(expMos),
        date: formatDate(experiment.createdAt),
      });
    }

    return NextResponse.json({
      panels: {
        calls: {
          value: runRows.length,
          series: seriesFrom(runRows.map((_, index) => index + 1), runRows.length),
        },
        mos: {
          value: average(mosValues),
          series: seriesFrom(mosValues, average(mosValues)),
        },
        task: {
          value: average(taskValues),
          series: seriesFrom(taskValues.map((value) => value * 100), average(taskValues) * 100),
        },
        latency: {
          value: latencyValues.length ? Math.max(...latencyValues) : 0,
          series: seriesFrom(latencyValues.map((value) => value / 1000), 0),
        },
        failures: {
          value: failed.length,
          series: seriesFrom(runRows.map((run) => (run.status === 'failed' || run.status === 'fail' ? 1 : 0)), failed.length),
        },
        experiments: {
          value: experimentRows.length,
          series: seriesFrom(experimentRows.map((_, index) => index + 1), experimentRows.length),
        },
      },
      recentExperiments,
      failingScenarios: failed.slice(0, 5).map((item) => ({
        runId: item.run.id,
        experimentId: item.run.experimentId,
        name: item.scenario?.name ?? 'Unknown scenario',
        reason: item.run.failureSummary ?? 'Missed release gate',
        score: item.task ?? 0,
      })),
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load overview', error);
    return NextResponse.json({ error: 'Overview unavailable' }, { status: 503 });
  }
}
