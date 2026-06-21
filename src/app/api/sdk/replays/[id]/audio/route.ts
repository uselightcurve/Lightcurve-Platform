import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { replayJobs, runs } from '@/db/schema';
import { storeReplayAudio } from '@/lib/captureStorage';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (typeof body.audioBase64 !== 'string' || body.audioBase64.length > 70_000_000) {
      return NextResponse.json({ error: 'A valid replay audio payload is required.' }, { status: 400 });
    }
    const [row] = await db.select({ job: replayJobs, run: runs }).from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .where(and(eq(replayJobs.id, id), eq(replayJobs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Replay job not found.' }, { status: 404 });
    const audioUrl = await storeReplayAudio({
      ownerUserId: account.userId,
      replayJobId: row.job.id,
      name: 'agent.wav',
      bytes: Buffer.from(body.audioBase64, 'base64'),
    });
    await db.update(runs).set({ audioAgentUrl: audioUrl }).where(eq(runs.id, row.run.id));
    return NextResponse.json({ audioUrl });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Replay audio could not be stored.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
