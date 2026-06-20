import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, datasetContributions, datasets } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { anonymizeBehaviorGraph } from '@/lib/humanDatasets';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.consent !== true) {
      return NextResponse.json({ error: 'Explicit contribution consent is required.' }, { status: 400 });
    }
    const [row] = await db.select({ case: datasetCases, dataset: datasets })
      .from(datasetCases)
      .innerJoin(datasets, eq(datasets.id, datasetCases.datasetId))
      .where(and(eq(datasetCases.id, id), eq(datasets.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Dataset case not found.' }, { status: 404 });
    const [existing] = await db.select().from(datasetContributions).where(and(
      eq(datasetContributions.caseId, row.case.id),
      eq(datasetContributions.ownerUserId, account.userId),
    )).limit(1);
    if (existing) return NextResponse.json({ contribution: existing });
    const [created] = await db.insert(datasetContributions).values({
      caseId: row.case.id,
      ownerUserId: account.userId,
      status: 'pending_review',
      consentVersion: 'community-benchmark-v1',
      consentedAt: new Date(),
      anonymizedGraph: anonymizeBehaviorGraph(row.case.behaviorGraph),
    }).returning();
    return NextResponse.json({ contribution: created }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Case could not be contributed.' }, { status: 500 });
  }
}
