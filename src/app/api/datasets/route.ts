import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, datasets } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { ensurePlaygroundDataset } from '@/lib/humanDatasets';
import { requireSdkAccount } from '@/lib/sdkAuth';
import { isMockMode, mockDatasets } from '@/lib/mockData';

async function requestAccount(req: Request) {
  return req.headers.get('authorization')?.startsWith('Bearer ')
    ? requireSdkAccount(req)
    : requireAccount();
}

export async function GET(req: Request) {
  if (isMockMode()) return NextResponse.json({ datasets: mockDatasets }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const account = await requestAccount(req);
    await ensurePlaygroundDataset(account.userId);
    const rows = await db
      .select({
        id: datasets.id,
        name: datasets.name,
        description: datasets.description,
        visibility: datasets.visibility,
        sourceType: datasets.sourceType,
        currentVersion: datasets.currentVersion,
        createdAt: datasets.createdAt,
        updatedAt: datasets.updatedAt,
        caseCount: sql<number>`count(${datasetCases.id})::int`,
      })
      .from(datasets)
      .leftJoin(datasetCases, eq(datasetCases.datasetId, datasets.id))
      .where(eq(datasets.ownerUserId, account.userId))
      .groupBy(datasets.id)
      .orderBy(desc(datasets.updatedAt));
    return NextResponse.json({ datasets: rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load datasets', error);
    return NextResponse.json({ error: 'Datasets are unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requestAccount(req);
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Dataset name is required.' }, { status: 400 });
    const [created] = await db.insert(datasets).values({
      ownerUserId: account.userId,
      name,
      description: typeof body.description === 'string' ? body.description.trim() : null,
      visibility: 'private',
      sourceType: 'human_capture',
    }).returning();
    return NextResponse.json({ dataset: created }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create dataset', error);
    return NextResponse.json({ error: 'Dataset could not be created.' }, { status: 500 });
  }
}
