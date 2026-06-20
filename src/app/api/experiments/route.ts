import { NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, datasetCases, datasets, experiments, replayJobs, runs } from '@/db/schema';
import { assertUsageAvailable, requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET() {
  try {
    const account = await requireAccount();
    const rows = await db.select({
      experiment: experiments,
      datasetName: datasets.name,
      runtimeName: agentRuntimes.name,
      runCount: sql<number>`count(${runs.id})::int`,
    }).from(experiments)
      .innerJoin(datasets, eq(datasets.id, experiments.datasetId))
      .leftJoin(agentRuntimes, eq(agentRuntimes.id, experiments.runtimeId))
      .leftJoin(runs, eq(runs.experimentId, experiments.id))
      .where(eq(experiments.ownerUserId, account.userId))
      .groupBy(experiments.id, datasets.name, agentRuntimes.name)
      .orderBy(desc(experiments.createdAt));
    return NextResponse.json({ experiments: rows.map((row) => ({
      ...row.experiment,
      datasetName: row.datasetName,
      runtimeName: row.runtimeName,
      runCount: row.runCount,
    })) });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Experiments are unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    if (typeof body.datasetId !== 'string') return NextResponse.json({ error: 'Dataset is required.' }, { status: 400 });
    const [dataset] = await db.select().from(datasets).where(and(
      eq(datasets.id, body.datasetId),
      eq(datasets.ownerUserId, account.userId),
    )).limit(1);
    if (!dataset) return NextResponse.json({ error: 'Dataset not found.' }, { status: 404 });
    const cases = await db.select().from(datasetCases).where(and(
      eq(datasetCases.datasetId, dataset.id),
      eq(datasetCases.status, 'approved'),
    ));
    if (!cases.length) return NextResponse.json({ error: 'Record and approve at least one human call first.' }, { status: 422 });
    const [runtime] = typeof body.runtimeId === 'string'
      ? await db.select().from(agentRuntimes).where(and(
          eq(agentRuntimes.id, body.runtimeId),
          eq(agentRuntimes.ownerUserId, account.userId),
        )).limit(1)
      : await db.select().from(agentRuntimes).where(eq(agentRuntimes.ownerUserId, account.userId))
          .orderBy(desc(agentRuntimes.lastSeenAt)).limit(1);
    if (!runtime) return NextResponse.json({ error: 'No Lightcurve-enabled runtime is registered.' }, { status: 409 });
    await assertUsageAvailable(account.userId, { actions: cases.length });

    const result = await db.transaction(async (tx) => {
      const [experiment] = await tx.insert(experiments).values({
        ownerUserId: account.userId,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `${dataset.name} evaluation`,
        datasetId: dataset.id,
        datasetVersion: dataset.currentVersion,
        runtimeId: runtime.id,
        status: 'queued',
        gitSha: typeof body.gitSha === 'string' ? body.gitSha : runtime.gitSha,
      }).returning();
      const createdRuns = await tx.insert(runs).values(cases.map((item) => ({
        ownerUserId: account.userId,
        experimentId: experiment.id,
        caseId: item.id,
        status: 'queued',
      }))).returning();
      await tx.insert(replayJobs).values(createdRuns.map((run, index) => ({
        ownerUserId: account.userId,
        runId: run.id,
        runtimeId: runtime.id,
        status: 'queued',
        replaySeed: 42 + index,
      })));
      return { experiment, runs: createdRuns };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Experiment creation failed', error);
    return NextResponse.json({ error: 'Dataset evaluation could not be created.' }, { status: 500 });
  }
}
