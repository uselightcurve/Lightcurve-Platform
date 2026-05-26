import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs, scenarios } from '@/db/schema';
import { executeBotToBotRun } from '@/lib/botToBotRunner';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runData = await db.select().from(runs).where(eq(runs.id, id));
  const run = runData[0];
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const experimentData = await db.select().from(experiments).where(eq(experiments.id, run.experimentId!));
  const experiment = experimentData[0];
  if (!experiment) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });

  const scenarioData = await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId!));
  const scenario = scenarioData[0];
  if (!scenario) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });

  try {
    const result = await executeBotToBotRun(id, experiment, run, scenario);

    const expRuns = await db.select().from(runs).where(eq(runs.experimentId, experiment.id));
    const allDone = expRuns.every((item) => item.id === id || item.status === 'complete' || item.status === 'failed');
    if (allDone) {
      await db.update(experiments).set({ status: 'completed', completedAt: new Date() }).where(eq(experiments.id, experiment.id));
    }

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bot-to-bot worker failed';
    await db
      .update(runs)
      .set({
        status: 'failed',
        provider: 'bot_to_bot',
        externalStatus: 'worker_failed',
        failureSummary: message,
        endedAt: new Date(),
      })
      .where(eq(runs.id, id));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
