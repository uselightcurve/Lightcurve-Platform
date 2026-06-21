import { NextResponse } from 'next/server';
import { db } from '@/db';
import { agentRuntimes, runtimeInstances } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

export async function POST(req: Request) {
  try {
    const account = await requireSdkAccount(req);
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Pipecat agent';
    const now = new Date();
    const [runtime] = await db.insert(agentRuntimes).values({
      ownerUserId: account.userId,
      name,
      framework: 'pipecat',
      version: typeof body.version === 'string' ? body.version : null,
      gitSha: typeof body.gitSha === 'string' ? body.gitSha : null,
      status: 'online',
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
      lastSeenAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [agentRuntimes.ownerUserId, agentRuntimes.name],
      set: {
        framework: 'pipecat',
        version: typeof body.version === 'string' ? body.version : null,
        gitSha: typeof body.gitSha === 'string' ? body.gitSha : null,
        status: 'online',
        lastSeenAt: now,
        updatedAt: now,
      },
    }).returning();

    const instanceKey = typeof body.instanceKey === 'string' && body.instanceKey.trim()
      ? body.instanceKey.trim()
      : 'default';
    const [instance] = await db.insert(runtimeInstances).values({
      runtimeId: runtime.id,
      instanceKey,
      status: 'online',
      capacity: Number.isFinite(body.capacity) ? Math.max(1, Math.floor(body.capacity)) : 1,
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
      lastSeenAt: now,
    }).onConflictDoUpdate({
      target: [runtimeInstances.runtimeId, runtimeInstances.instanceKey],
      set: {
        status: 'online',
        capacity: Number.isFinite(body.capacity) ? Math.max(1, Math.floor(body.capacity)) : 1,
        metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
        lastSeenAt: now,
      },
    }).returning();
    return NextResponse.json({ runtime, instance });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Runtime registration failed', error);
    return NextResponse.json({ error: 'Runtime registration failed.' }, { status: 500 });
  }
}
