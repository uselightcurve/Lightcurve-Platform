import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, experiments, runs, scores, traces } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [row] = await db.select({ run: runs, case: datasetCases, experiment: experiments })
      .from(runs)
      .leftJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .leftJoin(experiments, eq(experiments.id, runs.experimentId))
      .where(and(eq(runs.id, id), eq(runs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    const [traceRows, scoreRows] = await Promise.all([
      db.select().from(traces).where(eq(traces.runId, id)).orderBy(asc(traces.turnIndex)),
      db.select().from(scores).where(eq(scores.runId, id)),
    ]);
    return NextResponse.json({ ...row, traces: traceRows, scores: scoreRows });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Run could not be loaded.' }, { status: 500 });
  }
}
