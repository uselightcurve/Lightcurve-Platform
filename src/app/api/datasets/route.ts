import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCaseVersions, datasetCases, datasets } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
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
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const caseNames = Array.isArray(body.cases)
      ? body.cases
          .map((value) => typeof value === 'string' ? value.trim() : '')
          .filter(Boolean)
      : [];
    if (!name) return NextResponse.json({ error: 'Dataset name is required.' }, { status: 400 });

    const result = await db.transaction(async (tx) => {
      const [created] = await tx.insert(datasets).values({
        ownerUserId: account.userId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() : null,
        visibility: 'private',
        sourceType: 'human_capture',
      }).returning();

      const createdCases = [];
      for (const caseName of caseNames) {
        const behaviorGraph = {
          schema: 'lightcurve.human_behavior_graph.v3',
          source: 'manual_dataset_group',
          nodes: [{
            id: 'case_goal',
            kind: 'human_behavior',
            speaker: 'human',
            state: caseName,
            observedText: caseName,
          }],
          edges: [],
          semanticStates: [{
            id: 'case_goal',
            speaker: 'human',
            state: caseName,
          }],
          allowedPaths: [['case_goal']],
          terminalOutcome: 'review_required',
        };
        const successCriteria = [{
          type: 'behavioral_path',
          description: `Evaluate the agent against: ${caseName}`,
          weight: 1,
        }];
        const [createdCase] = await tx.insert(datasetCases).values({
          datasetId: created.id,
          name: caseName,
          status: 'approved',
          visibility: 'private',
          behaviorGraph,
          successCriteria,
          provenance: {
            source: 'manual_dataset_group',
            humanDerived: false,
            createdAt: new Date().toISOString(),
          },
          variationPolicy: {
            preserveIntent: true,
            preserveFacts: true,
            allowBranchVariation: true,
            allowSlotSubstitution: true,
            allowEmotionVariation: true,
            allowPacingVariation: true,
            allowInterruptionVariation: true,
            allowVoiceVariation: true,
            environmentProfiles: ['clean'],
          },
        }).returning();

        await tx.insert(datasetCaseVersions).values({
          caseId: createdCase.id,
          datasetVersion: created.currentVersion,
          graphVersion: 1,
          behaviorGraph,
          successCriteria,
        });
        createdCases.push(createdCase);
      }

      return { dataset: created, cases: createdCases };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create dataset', error);
    return NextResponse.json({ error: 'Dataset could not be created.' }, { status: 500 });
  }
}
