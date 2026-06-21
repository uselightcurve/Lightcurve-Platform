import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, datasetContributions, datasets } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { requireSdkAccount } from '@/lib/sdkAuth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = req.headers.get('authorization')?.startsWith('Bearer ')
      ? await requireSdkAccount(req)
      : await requireAccount();
    const { id } = await params;
    const [dataset] = await db.select().from(datasets).where(and(
      eq(datasets.id, id),
      eq(datasets.ownerUserId, account.userId),
    )).limit(1);
    if (!dataset) return NextResponse.json({ error: 'Dataset not found.' }, { status: 404 });
    const cases = await db
      .select()
      .from(datasetCases)
      .where(eq(datasetCases.datasetId, dataset.id))
      .orderBy(desc(datasetCases.createdAt));
    const contributions = cases.length
      ? await db.select({ caseId: datasetContributions.caseId, status: datasetContributions.status })
          .from(datasetContributions)
          .where(eq(datasetContributions.ownerUserId, account.userId))
      : [];
    return NextResponse.json({ dataset, cases, contributions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Dataset could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (typeof body.caseId !== 'string') return NextResponse.json({ error: 'Case ID is required.' }, { status: 400 });
    const [owned] = await db.select({ id: datasetCases.id }).from(datasetCases)
      .innerJoin(datasets, eq(datasets.id, datasetCases.datasetId))
      .where(and(
        eq(datasetCases.id, body.caseId),
        eq(datasetCases.datasetId, id),
        eq(datasets.ownerUserId, account.userId),
      )).limit(1);
    if (!owned) return NextResponse.json({ error: 'Dataset Case not found.' }, { status: 404 });
    const riskWeight = Math.max(1, Math.min(10, Math.round(Number(body.riskWeight) || 1)));
    const variationPolicy = body.variationPolicy && typeof body.variationPolicy === 'object' && !Array.isArray(body.variationPolicy)
      ? body.variationPolicy
      : {};
    const [updated] = await db.update(datasetCases).set({
      riskWeight,
      variationPolicy,
      updatedAt: new Date(),
    }).where(eq(datasetCases.id, body.caseId)).returning();
    return NextResponse.json({ case: updated });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Replay policy could not be saved.' }, { status: 500 });
  }
}
