import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios, scores } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { releaseWorkflowForExperiment } from '@/lib/releaseWorkflow';

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

  if (process.env.LIGHTCURVE_ALLOW_GLOBAL_RELEASE_GATE !== '1') {
    return null;
  }

  const latest = await db.select().from(experiments).orderBy(desc(experiments.createdAt)).limit(1);
  return latest[0];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minMos = parseThreshold(url.searchParams.get('minMos'), Number(process.env.LIGHTCURVE_GATE_MIN_MOS ?? 3.8));
  const minTask = parseThreshold(url.searchParams.get('minTask'), Number(process.env.LIGHTCURVE_GATE_MIN_TASK ?? 0.8));
  const experimentId = url.searchParams.get('experimentId');
  if (!experimentId && process.env.LIGHTCURVE_ALLOW_GLOBAL_RELEASE_GATE !== '1') {
    return NextResponse.json(
      { pass: false, status: 'pending', error: 'experimentId is required for release gate checks' },
      { status: 400 },
    );
  }

  const experiment = await resolveExperiment(experimentId);

  if (!experiment) {
    return NextResponse.json({ pass: false, status: 'pending', error: 'No experiment found' }, { status: 404 });
  }

  const expRuns = await db.select().from(runs).where(eq(runs.experimentId, experiment.id));
  const failures = [];
  const mosValues = [];
  const taskValues = [];
  const allScores = [];

  for (const run of expRuns) {
    const runScores = await db.select().from(scores).where(eq(scores.runId, run.id));
    allScores.push(...runScores);
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
  const workflow = releaseWorkflowForExperiment(experiment, expRuns, allScores, { minMos, minTask });
  const pass = workflow.releaseStage === 'final_pass' || workflow.releaseStage === 'low_cost_screen';
  const status =
    workflow.releaseStage === 'pending'
      ? 'pending'
      : workflow.releaseStage === 'needs_real_verification'
        ? 'needs_real_verification'
        : pass
          ? 'pass'
          : 'fail';

  return NextResponse.json({
    pass,
    status,
    experimentId: experiment.id,
    experimentName: experiment.name,
    release: {
      stage: workflow.releaseStage,
      label: workflow.releaseLabel,
      message: workflow.releaseMessage,
      sourceLane: workflow.sourceLane,
      riskyScenarioCount: workflow.riskyScenarioIds.length,
      promotedFromId: workflow.promotedFromId,
    },
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
