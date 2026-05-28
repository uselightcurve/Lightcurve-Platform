import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios, traces, scores } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const runData = await db.select().from(runs).where(and(eq(runs.id, id), eq(runs.ownerUserId, account.userId)));
    if (!runData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    const scenarioData = runData[0].scenarioId
      ? await db.select().from(scenarios).where(eq(scenarios.id, runData[0].scenarioId))
      : [];
    const experimentData = runData[0].experimentId
      ? await db.select().from(experiments).where(and(eq(experiments.id, runData[0].experimentId), eq(experiments.ownerUserId, account.userId)))
      : [];
    const runTraces = await db.select().from(traces).where(eq(traces.runId, id));
    const runScores = await db.select().from(scores).where(eq(scores.runId, id));

    return NextResponse.json({
      run: runData[0],
      experiment: experimentData[0] ?? null,
      scenario: scenarioData[0] ?? null,
      traces: runTraces,
      scores: runScores,
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Run unavailable' }, { status: 503 });
  }
}
