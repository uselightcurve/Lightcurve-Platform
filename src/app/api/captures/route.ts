import { NextResponse } from 'next/server';
import { and, desc, eq, gt } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET() {
  try {
    const account = await requireAccount();
    const captures = await db
      .select()
      .from(captureSessions)
      .where(eq(captureSessions.ownerUserId, account.userId))
      .orderBy(desc(captureSessions.createdAt))
      .limit(50);
    return NextResponse.json({ captures });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Captures are unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    const onlineSince = new Date(Date.now() - 45_000);
    const runtimeId = typeof body.runtimeId === 'string' ? body.runtimeId : null;
    const [runtime] = await db
      .select()
      .from(agentRuntimes)
      .where(and(
        eq(agentRuntimes.ownerUserId, account.userId),
        gt(agentRuntimes.lastSeenAt, onlineSince),
        ...(runtimeId ? [eq(agentRuntimes.id, runtimeId)] : []),
      ))
      .orderBy(desc(agentRuntimes.lastSeenAt))
      .limit(1);
    if (!runtime) {
      return NextResponse.json({ error: 'Agent runtime is offline. Start the app with Lightcurve enabled.' }, { status: 409 });
    }
    const [capture] = await db.insert(captureSessions).values({
      ownerUserId: account.userId,
      runtimeId: runtime.id,
      status: 'awaiting_offer',
      metadata: { source: 'playground', runtimeName: runtime.name },
    }).returning();
    return NextResponse.json({ capture, runtime }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create capture', error);
    return NextResponse.json({ error: 'Call could not be started.' }, { status: 500 });
  }
}
