import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.answer?.type !== 'answer' || typeof body.answer?.sdp !== 'string') {
      return NextResponse.json({ error: 'A valid WebRTC answer is required.' }, { status: 400 });
    }
    const [capture] = await db.select({ capture: captureSessions, runtime: agentRuntimes })
      .from(captureSessions)
      .innerJoin(agentRuntimes, eq(agentRuntimes.id, captureSessions.runtimeId))
      .where(and(eq(captureSessions.id, id), eq(agentRuntimes.ownerUserId, account.userId)))
      .limit(1);
    if (!capture) return NextResponse.json({ error: 'Capture not found.' }, { status: 404 });
    const [updated] = await db.update(captureSessions).set({
      status: 'connected',
      metadata: { ...record(capture.capture.metadata), answer: body.answer },
      startedAt: capture.capture.startedAt ?? new Date(),
    }).where(eq(captureSessions.id, capture.capture.id)).returning();
    return NextResponse.json({ capture: updated });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'WebRTC answer could not be saved.' }, { status: 500 });
  }
}
