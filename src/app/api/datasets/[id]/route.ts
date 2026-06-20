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
