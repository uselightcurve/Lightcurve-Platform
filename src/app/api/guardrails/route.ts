import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { guardrails } from '@/db/schema';
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
      .from(guardrails)
      .where(eq(guardrails.ownerUserId, account.userId))
      .orderBy(desc(guardrails.updatedAt));
    return NextResponse.json({ guardrails: rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load guardrails', error);
    return NextResponse.json({ error: 'Guardrails are unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requestAccount(req);
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const rule = typeof body.rule === 'string' ? body.rule.trim() : '';
    
    if (!name) return NextResponse.json({ error: 'Guardrail name is required.' }, { status: 400 });
    if (!rule) return NextResponse.json({ error: 'Guardrail rule is required.' }, { status: 400 });
    
    const [created] = await db.insert(guardrails).values({
      ownerUserId: account.userId,
      name,
      description,
      rule,
    }).returning();
    return NextResponse.json({ guardrail: created }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create guardrail', error);
    return NextResponse.json({ error: 'Guardrail could not be created.' }, { status: 500 });
  }
}
