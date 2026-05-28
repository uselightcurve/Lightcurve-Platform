import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios, scores } from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const expData = await db.select().from(experiments).where(and(eq(experiments.id, id), eq(experiments.ownerUserId, account.userId)));
    if (!expData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    const expRuns = await db.select().from(runs).where(and(eq(runs.experimentId, id), eq(runs.ownerUserId, account.userId)));
    const scenarioIds = expRuns.map((run) => run.scenarioId).filter(Boolean) as string[];
    const expScenarios = scenarioIds.length
      ? await db.select().from(scenarios).where(inArray(scenarios.id, scenarioIds))
      : [];
    
    const allScores = [];
    for (const r of expRuns) {
      const rScores = await db.select().from(scores).where(eq(scores.runId, r.id));
      allScores.push(...rScores);
    }

    return NextResponse.json({ experiment: expData[0], runs: expRuns, scores: allScores, scenarios: expScenarios });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Experiment unavailable' }, { status: 503 });
  }
}
