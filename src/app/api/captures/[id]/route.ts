import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { captureEvents, captureSessions } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [capture] = await db.select().from(captureSessions).where(and(
      eq(captureSessions.id, id),
      eq(captureSessions.ownerUserId, account.userId),
    )).limit(1);
    if (!capture) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    const events = await db.select().from(captureEvents)
      .where(eq(captureEvents.captureSessionId, capture.id))
      .orderBy(captureEvents.sequence);
    return NextResponse.json({ capture, events }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Capture could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};
    if (body.status === 'complete' || body.status === 'cancelled') {
      updates.status = body.status;
      updates.endedAt = new Date();
    }
    const [updated] = await db.update(captureSessions).set(updates).where(and(
      eq(captureSessions.id, id),
      eq(captureSessions.ownerUserId, account.userId),
    )).returning();
    if (!updated) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    return NextResponse.json({ capture: updated });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Capture could not be updated.' }, { status: 500 });
  }
}
