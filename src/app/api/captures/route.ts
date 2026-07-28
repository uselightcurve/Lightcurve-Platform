import { NextResponse } from 'next/server';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions, runtimeInstances } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function availableCapacity(instance: typeof runtimeInstances.$inferSelect, onlineSince: Date) {
  if (!instance.lastSeenAt || instance.lastSeenAt <= onlineSince) return 0;
  const metadata = record(instance.metadata);
  const reported = Number(metadata.availableCapacity);
  if (Number.isFinite(reported)) return Math.max(0, Math.floor(reported));
  return Math.max(0, instance.capacity - instance.activeSessions);
}

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
    const runtimes = await db
      .select()
      .from(agentRuntimes)
      .where(and(
        eq(agentRuntimes.ownerUserId, account.userId),
        gt(agentRuntimes.lastSeenAt, onlineSince),
        ...(runtimeId ? [eq(agentRuntimes.id, runtimeId)] : []),
      ))
      .orderBy(desc(agentRuntimes.lastSeenAt))
      .limit(runtimeId ? 1 : 20);
    if (!runtimes.length) {
      return NextResponse.json({ error: 'Agent runtime is offline. Start the app with Lightcurve enabled.' }, { status: 409 });
    }
    const instances = await db.select().from(runtimeInstances).where(
      inArray(runtimeInstances.runtimeId, runtimes.map((runtime) => runtime.id)),
    );
    const runtime = runtimes.find((candidate) => (
      instances
        .filter((instance) => instance.runtimeId === candidate.id)
        .some((instance) => availableCapacity(instance, onlineSince) > 0)
    ));
    if (!runtime) {
      return NextResponse.json({ error: 'Agent runtime is online but has no idle worker. Wait for the current LiveKit/Pipecat job to become idle, then try again.' }, { status: 409 });
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
