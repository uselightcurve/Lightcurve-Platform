import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { scenarios, datasetCases } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { requireSdkAccount } from '@/lib/sdkAuth';

async function requestAccount(req: Request) {
  return req.headers.get('authorization')?.startsWith('Bearer ')
    ? requireSdkAccount(req)
    : requireAccount();
}

export async function GET(req: Request) {
  try {
    const account = await requestAccount(req);
    const rows = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.ownerUserId, account.userId))
      .orderBy(desc(scenarios.updatedAt));
    return NextResponse.json({ scenarios: rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load scenarios', error);
    return NextResponse.json({ error: 'Scenarios are unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requestAccount(req);
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const type = typeof body.type === 'string' && ['jailbreak', 'custom'].includes(body.type) ? body.type : 'custom';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const datasetId = typeof body.datasetId === 'string' ? body.datasetId : null;
    
    if (!name) return NextResponse.json({ error: 'Scenario name is required.' }, { status: 400 });
    if (!prompt) return NextResponse.json({ error: 'Scenario prompt is required.' }, { status: 400 });
    
    const [created] = await db.insert(scenarios).values({
      ownerUserId: account.userId,
      name,
      type,
      prompt,
    }).returning();

    if (datasetId) {
      await db.insert(datasetCases).values({
        datasetId,
        name: `Scenario: ${name}`,
        behaviorGraph: { nodes: [{ id: 'start', type: 'scenario', prompt }] },
      });
    }

    return NextResponse.json({ scenario: created }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create scenario', error);
    return NextResponse.json({ error: 'Scenario could not be created.' }, { status: 500 });
  }
}
