import { NextResponse } from 'next/server';
import { db } from '@/db';
import { scenarios } from '@/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { REAL_SCENARIO_LIBRARY } from '@/lib/realScenarioLibrary';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const body = await req.json().catch(() => ({})); // { name: '...', patch: [...] }

    const parentData = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.id, id), or(isNull(scenarios.ownerUserId), eq(scenarios.ownerUserId, account.userId))));

    const libraryParent = REAL_SCENARIO_LIBRARY.find((scenario) => scenario.id === id);
    if (!parentData.length && !libraryParent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const parent = parentData[0] ?? libraryParent!;

    const newScenario = {
      ownerUserId: account.userId,
      parentId: parentData[0] ? id : null,
      name: body.name || `${parent.name}_fork`,
      language: parent.language,
      domain: parent.domain ?? 'general',
      persona: structuredClone(parent.persona),
      successCriteria: structuredClone(parent.successCriteria ?? []),
      callerSeed: parent.callerSeed ?? 42,
      isPreset: false,
    };

    for (const p of body.patch || []) {
      if (p.path === '/language') newScenario.language = p.value;
      else if (p.path === '/persona/accent') (newScenario.persona as any).accent = p.value;
      else if (p.path === '/persona/name') (newScenario.persona as any).name = p.value;
      else if (p.path === '/persona/emotional_state') (newScenario.persona as any).emotional_state = p.value;
      else if (p.path === '/persona/goal') (newScenario.persona as any).goal = p.value;
    }

    const created = await db.insert(scenarios).values(newScenario).returning();
    return NextResponse.json({ scenario: created[0] });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Scenario could not be forked' }, { status: 500 });
  }
}
