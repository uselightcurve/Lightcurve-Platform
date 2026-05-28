import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { createRoom } from '@/lib/daily';
import { isProviderBackedSandbox, startProviderSandboxCall } from '@/lib/sandboxProviders';
import { enqueueBotToBotRun, executeBotToBotRun, isBotToBotExperiment } from '@/lib/botToBotRunner';
import { assertUsageAvailable, requireAccount, unauthorizedJson } from '@/lib/account';
import { hydrateExperimentAgentConfig } from '@/lib/agentConnections';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
  const account = await requireAccount();
  await assertUsageAvailable(account.userId, { actions: 1 });
  const { id } = await params;
  const runData = await db.select().from(runs).where(and(eq(runs.id, id), eq(runs.ownerUserId, account.userId)));
  if (!runData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  
  const run = runData[0];
  
  const scenarioData = await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId!));
  const scenario = scenarioData[0];
  if (!scenario) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });

  const experimentData = await db.select().from(experiments).where(and(eq(experiments.id, run.experimentId!), eq(experiments.ownerUserId, account.userId)));
  const experiment = experimentData[0] ? await hydrateExperimentAgentConfig(experimentData[0]) : undefined;
  if (!experiment) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });

  if (isProviderBackedSandbox(experiment)) {
    try {
      const call = await startProviderSandboxCall(id, experiment, scenario);
      const runStatus = call.runStatus ?? 'running';
      await db
        .update(runs)
        .set({
          status: runStatus,
          provider: call.provider,
          externalCallId: call.id,
          externalStatus: call.status,
          startedAt: new Date(),
        })
        .where(eq(runs.id, id));
      await db.update(experiments).set({ status: 'running' }).where(eq(experiments.id, experiment.id));

      return NextResponse.json({
        success: true,
        provider: call.provider,
        status: runStatus,
        externalCallId: call.id,
        externalStatus: call.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider call could not be started';
      await db
        .update(runs)
        .set({
          status: 'failed',
          provider: experiment.agentType,
          externalStatus: 'start_failed',
          failureSummary: message,
          startedAt: new Date(),
          endedAt: new Date(),
        })
        .where(eq(runs.id, id));

      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (isBotToBotExperiment(experiment)) {
    await db
      .update(runs)
      .set({
        status: 'pending',
        provider: 'bot_to_bot',
        externalStatus: 'queued',
        startedAt: new Date(),
      })
      .where(eq(runs.id, id));
    await db.update(experiments).set({ status: 'running' }).where(eq(experiments.id, experiment.id));

    const queued = await enqueueBotToBotRun(id);
    if (!queued) {
      executeBotToBotRun(id, experiment, run, scenario).catch(console.error);
    }

    return NextResponse.json({
      success: true,
      provider: 'bot_to_bot',
      status: queued ? 'queued' : 'running',
      externalStatus: queued ? 'cloud_tasks_queued' : 'inline_worker_started',
    });
  }

  // Set to running
  await db.update(runs).set({ status: 'running', startedAt: new Date() }).where(eq(runs.id, id));
  await db.update(experiments).set({ status: 'running' }).where(eq(experiments.id, experiment.id));

  // 1. Create Daily Room
  let dailyRoomUrl = '';
  try {
    const room = await createRoom(id);
    dailyRoomUrl = room.url;
    await db.update(runs).set({ dailyRoomUrl }).where(eq(runs.id, id));
  } catch (e) {
    console.error('Failed to create Daily room', e);
  }

  // Run the loop in background (not awaiting intentionally, or dispatch to worker)
  // In a true serverless environment, this should be sent to a worker or Cloud Run instance
  // For MVP, we simulate it here.
  const { runSyntheticCallerLoop } = await import('@/lib/syntheticCaller');
  runSyntheticCallerLoop(id, dailyRoomUrl, scenario).catch(console.error);

  return NextResponse.json({ success: true, status: 'running' });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    if (error instanceof Response) return NextResponse.json({ error: await error.text() }, { status: error.status });
    console.error('Failed to start run', error);
    return NextResponse.json({ error: 'Run could not be started' }, { status: 500 });
  }
}
