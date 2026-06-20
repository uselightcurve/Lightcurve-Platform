import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureEvents, captureSessions } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const [owned] = await db.select({ id: captureSessions.id })
      .from(captureSessions)
      .innerJoin(agentRuntimes, eq(agentRuntimes.id, captureSessions.runtimeId))
      .where(and(eq(captureSessions.id, id), eq(agentRuntimes.ownerUserId, account.userId)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    const incoming = Array.isArray(body.events) ? body.events : [];
    const rows = incoming.flatMap((event: unknown, index: number) => {
      if (!event || typeof event !== 'object') return [];
      const value = event as Record<string, unknown>;
      if (typeof value.eventType !== 'string') return [];
      return [{
        captureSessionId: id,
        sequence: Number.isFinite(value.sequence) ? Number(value.sequence) : index,
        eventType: value.eventType,
        speaker: typeof value.speaker === 'string' ? value.speaker : null,
        timestampMs: Number.isFinite(value.timestampMs) ? Number(value.timestampMs) : 0,
        payload: value.payload && typeof value.payload === 'object' ? value.payload : {},
      }];
    });
    if (rows.length) await db.insert(captureEvents).values(rows).onConflictDoNothing();
    if (Array.isArray(body.transcript)) {
      await db.update(captureSessions).set({ transcript: body.transcript }).where(eq(captureSessions.id, id));
    }
    return NextResponse.json({ accepted: rows.length });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Capture events could not be stored.' }, { status: 500 });
  }
}
