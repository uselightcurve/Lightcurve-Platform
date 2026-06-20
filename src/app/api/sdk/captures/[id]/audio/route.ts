import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions } from '@/db/schema';
import { storeCaptureAudio } from '@/lib/captureStorage';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (typeof body.audioBase64 !== 'string' || body.audioBase64.length > 70_000_000) {
      return NextResponse.json({ error: 'A valid agent audio payload is required.' }, { status: 400 });
    }
    const [row] = await db.select({ capture: captureSessions })
      .from(captureSessions)
      .innerJoin(agentRuntimes, eq(agentRuntimes.id, captureSessions.runtimeId))
      .where(and(eq(captureSessions.id, id), eq(agentRuntimes.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    const url = await storeCaptureAudio({
      ownerUserId: account.userId,
      captureSessionId: row.capture.id,
      leg: 'agent',
      contentType: 'audio/wav',
      bytes: Buffer.from(body.audioBase64, 'base64'),
    });
    await db.update(captureSessions).set({ agentAudioUrl: url }).where(eq(captureSessions.id, row.capture.id));
    return NextResponse.json({ audioUrl: url });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Agent audio could not be stored.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
