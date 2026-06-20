import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, runtimeInstances } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

export async function POST(req: Request) {
  try {
    const account = await requireSdkAccount(req);
    const body = await req.json().catch(() => ({}));
    if (typeof body.runtimeId !== 'string' || typeof body.instanceId !== 'string') {
      return NextResponse.json({ error: 'Runtime and instance IDs are required.' }, { status: 400 });
    }
    const now = new Date();
    const [runtime] = await db.update(agentRuntimes).set({ status: 'online', lastSeenAt: now, updatedAt: now })
      .where(and(eq(agentRuntimes.id, body.runtimeId), eq(agentRuntimes.ownerUserId, account.userId)))
      .returning();
    if (!runtime) return NextResponse.json({ error: 'Runtime not found.' }, { status: 404 });
    await db.update(runtimeInstances).set({
      status: 'online',
      activeSessions: Number.isFinite(body.activeSessions) ? Math.max(0, Math.floor(body.activeSessions)) : 0,
      lastSeenAt: now,
    }).where(and(eq(runtimeInstances.id, body.instanceId), eq(runtimeInstances.runtimeId, runtime.id)));
    return NextResponse.json({ ok: true, serverTime: now.toISOString() });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Heartbeat failed.' }, { status: 500 });
  }
}
