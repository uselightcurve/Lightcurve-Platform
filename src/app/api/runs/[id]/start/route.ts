import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, replayJobs, runs } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [row] = await db.select({ run: runs, experiment: experiments }).from(runs)
      .innerJoin(experiments, eq(experiments.id, runs.experimentId))
      .where(and(eq(runs.id, id), eq(runs.ownerUserId, account.userId))).limit(1);
    if (!row) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    const [existing] = await db.select().from(replayJobs).where(eq(replayJobs.runId, row.run.id)).limit(1);
    if (!existing) await db.insert(replayJobs).values({ ownerUserId: account.userId, runId: row.run.id, runtimeId: row.experiment.runtimeId, status: 'queued' });
    await db.update(runs).set({ status: 'queued' }).where(eq(runs.id, row.run.id));
    return NextResponse.json({ success: true, status: 'queued' });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Replay could not be queued.' }, { status: 500 });
  }
}
