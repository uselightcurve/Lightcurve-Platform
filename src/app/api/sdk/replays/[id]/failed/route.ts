import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { replayJobs, runs } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { refreshExperimentProgress } from '@/lib/experimentRuns';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const [row] = await db.select({ job: replayJobs, run: runs }).from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .where(and(eq(replayJobs.id, id), eq(replayJobs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Replay job not found.' }, { status: 404 });
    const message = typeof body.error === 'string' ? body.error.slice(0, 1000) : 'SDK replay execution failed.';
    const exhausted = row.job.attemptCount >= row.job.maxAttempts;
    await db.transaction(async (tx) => {
      await tx.update(replayJobs).set({ status: exhausted ? 'failed' : 'queued', lastError: message, leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(replayJobs.id, row.job.id));
      await tx.update(runs).set({ status: exhausted ? 'failed' : 'queued', failureSummary: exhausted ? message : null }).where(eq(runs.id, row.run.id));
    });
    if (row.run.experimentId) await refreshExperimentProgress(row.run.experimentId);
    return NextResponse.json({ ok: true, retrying: !exhausted });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Replay failure could not be recorded.' }, { status: 500 });
  }
}
