import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { captureSessions } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { storeCaptureAudio } from '@/lib/captureStorage';

const MAX_CAPTURE_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [capture] = await db.select().from(captureSessions).where(and(
      eq(captureSessions.id, id),
      eq(captureSessions.ownerUserId, account.userId),
    )).limit(1);
    if (!capture) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    const form = await req.formData();
    const audio = form.get('audio');
    if (!(audio instanceof Blob) || audio.size === 0 || audio.size > MAX_CAPTURE_BYTES) {
      return NextResponse.json({ error: 'A valid audio recording under 50 MB is required.' }, { status: 400 });
    }
    const url = await storeCaptureAudio({
      ownerUserId: account.userId,
      captureSessionId: capture.id,
      leg: 'human',
      contentType: audio.type || 'audio/webm',
      bytes: Buffer.from(await audio.arrayBuffer()),
    });
    await db.update(captureSessions).set({ humanAudioUrl: url }).where(eq(captureSessions.id, capture.id));
    return NextResponse.json({ audioUrl: url });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Audio could not be stored.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
