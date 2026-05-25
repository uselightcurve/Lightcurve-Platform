import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios, scores } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';

function parseThreshold(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function resolveExperiment(experimentId?: string | null) {
  if (experimentId) {
    const found = await db.select().from(experiments).where(eq(experiments.id, experimentId));
    return found[0];
  }

  const latest = await db.select().from(experiments).orderBy(desc(experiments.createdAt)).limit(1);
  return latest[0];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minMos = parseThreshold(url.searchParams.get('minMos'), Number(process.env.LIGHTCURVE_GATE_MIN_MOS ?? 3.8));
  const minTask = parseThreshold(url.searchParams.get('minTask'), Number(process.env.LIGHTCURVE_GATE_MIN_TASK ?? 0.8));
  const experiment = await resolveExperiment(url.searchParams.get('experimentId'));

  if (!experiment) {
    return NextResponse.json({ pass: false, status: 'pending', error: 'No experiment found' }, { status: 404 });
  }

  const expRuns = await db.select().from(runs).where(eq(runs.experimentId, experiment.id));
  const failures = [];
  const mosValues = [];
  const taskValues = [];

  for (const run of expRuns) {
    const runScores = await db.select().from(scores).where(eq(scores.runId, run.id));
    const scenarioData = run.scenarioId
      ? await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId))
      : [];
    const scenario = scenarioData[0];
    const mos = runScores.find((score) => score.metricName === 'mos')?.value ?? null;
    const task = runScores.find((score) => score.metricName === 'task_completed')?.value ?? null;
    const reasons = [];

    if (typeof mos === 'number') mosValues.push(mos);
    if (typeof task === 'number') taskValues.push(task);
    if (run.status !== 'complete') reasons.push(`run status is ${run.status ?? 'pending'}`);
    if (mos == null) reasons.push('MOS pending');
    else if (mos < minMos) reasons.push(`MOS ${mos.toFixed(2)} is below ${minMos.toFixed(2)}`);
    if (task == null) reasons.push('task completion pending');
    else if (task < minTask) reasons.push(`task ${(task * 100).toFixed(0)}% is below ${(minTask * 100).toFixed(0)}%`);

    if (reasons.length) {
      failures.push({
        runId: run.id,
        scenarioId: run.scenarioId,
        scenarioName: scenario?.name ?? run.scenarioId,
        mos,
        taskCompletion: task,
        reasons,
      });
    }
  }

  const avgMos = average(mosValues);
  const avgTaskCompletion = average(taskValues);
  const pass = expRuns.length > 0 && failures.length === 0;

  return NextResponse.json({
    pass,
    status: pass ? 'pass' : failures.some((failure) => failure.reasons.some((reason: string) => reason.includes('pending'))) ? 'pending' : 'fail',
    experimentId: experiment.id,
    experimentName: experiment.name,
    thresholds: {
      minMos,
      minTask,
    },
    metrics: {
      avgMos,
      avgTaskCompletion,
      runs: expRuns.length,
    },
    failures,
  });
}
