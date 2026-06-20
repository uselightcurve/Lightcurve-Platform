import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, experiments, runs, scores } from '@/db/schema';

function threshold(value: string | null, fallback: number) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const experimentId = url.searchParams.get('experimentId');
  if (!experimentId) return NextResponse.json({ pass: false, status: 'pending', error: 'experimentId is required' }, { status: 400 });
  const [experiment] = await db.select().from(experiments).where(eq(experiments.id, experimentId)).limit(1);
  if (!experiment) return NextResponse.json({ pass: false, status: 'pending', error: 'Experiment not found' }, { status: 404 });
  const runRows = await db.select().from(runs).where(eq(runs.experimentId, experiment.id));
  const runIds = runRows.map((run) => run.id);
  const caseIds = runRows.flatMap((run) => run.caseId ? [run.caseId] : []);
  const [scoreRows, cases] = await Promise.all([
    runIds.length ? db.select().from(scores).where(inArray(scores.runId, runIds)) : [],
    caseIds.length ? db.select().from(datasetCases).where(inArray(datasetCases.id, caseIds)) : [],
  ]);
  const minMos = threshold(url.searchParams.get('minMos'), Number(process.env.LIGHTCURVE_GATE_MIN_MOS ?? 3.8));
  const minTask = threshold(url.searchParams.get('minTask'), Number(process.env.LIGHTCURVE_GATE_MIN_TASK ?? 0.8));
  const failures = runRows.flatMap((run) => {
    const runScores = scoreRows.filter((score) => score.runId === run.id);
    const mos = runScores.find((score) => score.metricName === 'mos')?.value ?? null;
    const outcome = runScores.find((score) => ['outcome_match', 'task_completed'].includes(score.metricName ?? ''))?.value ?? null;
    const reasons: string[] = [];
    if (run.status !== 'complete') reasons.push(`run status is ${run.status}`);
    if (mos == null || mos < minMos) reasons.push(mos == null ? 'MOS pending' : `MOS ${mos.toFixed(2)} is below ${minMos.toFixed(2)}`);
    if (outcome == null || outcome < minTask) reasons.push(outcome == null ? 'outcome score pending' : `outcome ${Math.round(outcome * 100)}% is below ${Math.round(minTask * 100)}%`);
    if (!reasons.length) return [];
    return [{ runId: run.id, caseId: run.caseId, caseName: cases.find((item) => item.id === run.caseId)?.name ?? 'Dataset case', mos, outcome, reasons }];
  });
  const pass = runRows.length > 0 && failures.length === 0;
  return NextResponse.json({
    pass,
    status: pass ? 'pass' : runRows.some((run) => ['queued', 'running'].includes(run.status)) ? 'pending' : 'fail',
    experimentId: experiment.id,
    experimentName: experiment.name,
    datasetId: experiment.datasetId,
    datasetVersion: experiment.datasetVersion,
    thresholds: { minMos, minTask },
    metrics: { runs: runRows.length },
    failures,
  });
}
