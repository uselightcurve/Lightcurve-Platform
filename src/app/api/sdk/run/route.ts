import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, datasetCases, datasets } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { assertUsageAvailable } from '@/lib/account';
import { createCompiledExperiment } from '@/lib/experimentRuns';
import { normalizeReplayConfig } from '@/lib/replayCompiler';

export async function POST(req: Request) {
  try {
    const account = await requireSdkAccount(req);
    const body = await req.json().catch(() => ({}));
    if (typeof body.datasetId !== 'string') return NextResponse.json({ error: 'datasetId is required.' }, { status: 400 });
    const [dataset] = await db.select().from(datasets).where(and(eq(datasets.id, body.datasetId), eq(datasets.ownerUserId, account.userId))).limit(1);
    if (!dataset) return NextResponse.json({ error: 'Dataset not found.' }, { status: 404 });
    const cases = await db.select().from(datasetCases).where(and(eq(datasetCases.datasetId, dataset.id), eq(datasetCases.status, 'approved')));
    if (!cases.length) return NextResponse.json({ error: 'Dataset has no approved human-derived cases.' }, { status: 422 });
    const runtimeQuery = typeof body.runtimeId === 'string'
      ? and(eq(agentRuntimes.id, body.runtimeId), eq(agentRuntimes.ownerUserId, account.userId))
      : eq(agentRuntimes.ownerUserId, account.userId);
    const [runtime] = await db.select().from(agentRuntimes).where(runtimeQuery).orderBy(desc(agentRuntimes.lastSeenAt)).limit(1);
    if (!runtime) return NextResponse.json({ error: 'No registered runtime.' }, { status: 409 });
    const config = normalizeReplayConfig({
      preset: body.preset,
      replayCount: body.replayCount,
      maxConcurrency: body.maxConcurrency,
      seed: body.seed,
      judgePolicy: body.judgePolicy,
      environmentMix: body.environmentMix,
    });
    await assertUsageAvailable(account.userId, { actions: Math.max(config.replayCount, cases.length) });
    const result = await createCompiledExperiment({
      ownerUserId: account.userId,
      dataset,
      runtime,
      cases,
      config,
      name: typeof body.name === 'string' ? body.name : undefined,
      gitSha: typeof body.gitSha === 'string' ? body.gitSha : runtime.gitSha,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Dataset run could not be created.' }, { status: 500 });
  }
}
