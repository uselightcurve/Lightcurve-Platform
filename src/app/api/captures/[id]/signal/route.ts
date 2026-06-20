import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { captureSessions } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { iceServers } from '@/lib/webrtc';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [capture] = await db.select().from(captureSessions).where(and(
      eq(captureSessions.id, id),
      eq(captureSessions.ownerUserId, account.userId),
    )).limit(1);
    if (!capture) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    const metadata = record(capture.metadata);
    return NextResponse.json({
      status: capture.status,
      answer: metadata.answer ?? null,
      iceServers: iceServers(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Signaling state is unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.offer?.type !== 'offer' || typeof body.offer?.sdp !== 'string') {
      return NextResponse.json({ error: 'A valid WebRTC offer is required.' }, { status: 400 });
    }
    const [capture] = await db.select().from(captureSessions).where(and(
      eq(captureSessions.id, id),
      eq(captureSessions.ownerUserId, account.userId),
    )).limit(1);
    if (!capture) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    const [updated] = await db.update(captureSessions).set({
      status: 'offer_ready',
      metadata: { ...record(capture.metadata), offer: body.offer },
      startedAt: capture.startedAt ?? new Date(),
    }).where(eq(captureSessions.id, capture.id)).returning();
    return NextResponse.json({ capture: updated, iceServers: iceServers() });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'WebRTC offer could not be saved.' }, { status: 500 });
  }
}
