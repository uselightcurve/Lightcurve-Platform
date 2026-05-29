import { NextResponse } from 'next/server';
import { db } from '@/db';
import { scenarios } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { REAL_SCENARIO_LIBRARY, mergeWithRealScenarioLibrary } from '@/lib/realScenarioLibrary';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET() {
  try {
    const account = await requireAccount();
    const data = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.ownerUserId, account.userId))
      .orderBy(desc(scenarios.createdAt));

    return NextResponse.json(
      { scenarios: mergeWithRealScenarioLibrary(data as any) },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load scenarios', error);
    return NextResponse.json(
      {
        scenarios: REAL_SCENARIO_LIBRARY,
        degraded: true,
        error: 'Workspace scenario sync is unavailable. Showing the global scenario library.',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json();
    const persona = body.persona && typeof body.persona === 'object' ? body.persona : {};
    const successCriteria = Array.isArray(body.successCriteria) ? body.successCriteria : [];
    const created = await db.insert(scenarios).values({
      ownerUserId: account.userId,
      name: String(body.name ?? 'custom_scenario'),
      language: String(body.language ?? 'en-US'),
      domain: String(body.domain ?? 'general'),
      persona,
      successCriteria,
      callerSeed: Number(body.callerSeed ?? Date.now() % 100000),
      isPreset: false,
    }).returning();
    return NextResponse.json({ scenario: created[0] });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create scenario', error);
    return NextResponse.json({ error: 'Scenario could not be created' }, { status: 500 });
  }
}
