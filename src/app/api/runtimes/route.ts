import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { isMockMode } from '@/lib/mockData';

export async function GET() {
  if (isMockMode()) {
    return NextResponse.json({
      runtimes: [
        { id: 'rt-001', name: 'Demo Runtime', status: 'online', lastSeenAt: new Date().toISOString(), ownerUserId: 'mock_demo_user' },
      ],
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const account = await requireAccount();
    const onlineSince = new Date(Date.now() - 45_000);
    const runtimes = await db.select().from(agentRuntimes).where(
      eq(agentRuntimes.ownerUserId, account.userId),
    ).orderBy(desc(agentRuntimes.lastSeenAt));
    return NextResponse.json({
      runtimes: runtimes.map((runtime) => ({
        ...runtime,
        status: runtime.lastSeenAt && runtime.lastSeenAt > onlineSince ? 'online' : 'offline',
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Agent runtimes are unavailable.' }, { status: 500 });
  }
}
