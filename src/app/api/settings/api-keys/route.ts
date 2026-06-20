import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { generateApiKey } from '@/lib/sdkAuth';

export async function GET() {
  try {
    const account = await requireAccount();
    const rows = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    }).from(apiKeys).where(and(eq(apiKeys.ownerUserId, account.userId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
    return NextResponse.json({ apiKeys: rows });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'API keys are unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    const generated = generateApiKey();
    const [created] = await db.insert(apiKeys).values({
      ownerUserId: account.userId,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'SDK key',
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
    }).returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt });
    return NextResponse.json({ apiKey: created, secret: generated.value }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'API key could not be created.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    if (typeof body.id !== 'string') return NextResponse.json({ error: 'API key ID is required.' }, { status: 400 });
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(
      eq(apiKeys.id, body.id),
      eq(apiKeys.ownerUserId, account.userId),
    ));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'API key could not be revoked.' }, { status: 500 });
  }
}
