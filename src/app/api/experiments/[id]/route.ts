import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, datasetCases, datasets, experiments, runs, scores } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [row] = await db.select({ experiment: experiments, dataset: datasets, runtime: agentRuntimes })
      .from(experiments)
      .innerJoin(datasets, eq(datasets.id, experiments.datasetId))
      .leftJoin(agentRuntimes, eq(agentRuntimes.id, experiments.runtimeId))
      .where(and(eq(experiments.id, id), eq(experiments.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Experiment not found.' }, { status: 404 });
    const runRows = await db.select().from(runs).where(eq(runs.experimentId, id));
    const caseIds = runRows.flatMap((run) => run.caseId ? [run.caseId] : []);
    const cases = caseIds.length ? await db.select().from(datasetCases).where(inArray(datasetCases.id, caseIds)) : [];
    const runIds = runRows.map((run) => run.id);
    const scoreRows = runIds.length ? await db.select().from(scores).where(inArray(scores.runId, runIds)) : [];
    return NextResponse.json({ ...row, runs: runRows, cases, scores: scoreRows });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Experiment could not be loaded.' }, { status: 500 });
  }
}
