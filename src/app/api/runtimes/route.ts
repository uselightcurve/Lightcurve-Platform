import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, runtimeInstances } from '@/db/schema';
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
    const onlineSince = new Date(Date.now() - 45_000);
    const runtimes = await db.select().from(agentRuntimes).where(
      eq(agentRuntimes.ownerUserId, account.userId),
    ).orderBy(desc(agentRuntimes.lastSeenAt));
    const instances = runtimes.length
      ? await db.select().from(runtimeInstances).where(inArray(runtimeInstances.runtimeId, runtimes.map((runtime) => runtime.id)))
      : [];
    return NextResponse.json({
      runtimes: runtimes.map((runtime) => {
        const runtimeInstancesForRuntime = instances.filter((instance) => instance.runtimeId === runtime.id);
        const totalAvailableCapacity = runtimeInstancesForRuntime.reduce((total, instance) => total + availableCapacity(instance, onlineSince), 0);
        const online = runtime.lastSeenAt && runtime.lastSeenAt > onlineSince;
        return {
          ...runtime,
          status: online ? 'online' : 'offline',
          availableCapacity: online ? totalAvailableCapacity : 0,
          availability: online && totalAvailableCapacity > 0 ? 'available' : online ? 'busy' : 'offline',
        };
      }),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Agent runtimes are unavailable.' }, { status: 500 });
  }
}
