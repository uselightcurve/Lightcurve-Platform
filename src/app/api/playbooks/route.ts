import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { playbooks } from '@/db/schema';
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
      .from(playbooks)
      .where(eq(playbooks.ownerUserId, account.userId))
      .orderBy(desc(playbooks.updatedAt));
    return NextResponse.json({ playbooks: rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load playbooks', error);
    return NextResponse.json({ error: 'Playbooks are unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requestAccount(req);
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : '';
    
    if (!name) return NextResponse.json({ error: 'Playbook name is required.' }, { status: 400 });
    if (!instructions) return NextResponse.json({ error: 'Playbook instructions are required.' }, { status: 400 });
    
    const [created] = await db.insert(playbooks).values({
      ownerUserId: account.userId,
      name,
      instructions,
    }).returning();
    return NextResponse.json({ playbook: created }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create playbook', error);
    return NextResponse.json({ error: 'Playbook could not be created.' }, { status: 500 });
  }
}
