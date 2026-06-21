import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, apiKeys } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET() {
  try {
    const account = await requireAccount();
    const [runtimes, keys] = await Promise.all([
      db.select({ id: agentRuntimes.id, lastSeenAt: agentRuntimes.lastSeenAt }).from(agentRuntimes).where(eq(agentRuntimes.ownerUserId, account.userId)),
      db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.ownerUserId, account.userId)),
    ]);
    const onlineSince = new Date(Date.now() - 45_000);
    return NextResponse.json({
      sdkEverRegistered: runtimes.length > 0,
      onlineRuntimeCount: runtimes.filter((runtime) => runtime.lastSeenAt && runtime.lastSeenAt > onlineSince).length,
      apiKeyCount: keys.length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Onboarding status is unavailable.' }, { status: 500 });
  }
}
