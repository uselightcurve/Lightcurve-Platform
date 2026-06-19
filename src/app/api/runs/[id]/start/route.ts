import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { isProviderBackedSandbox, startProviderSandboxCall } from '@/lib/sandboxProviders';
import { enqueueBotToBotRun, executeBotToBotRun, isBotToBotExperiment, resolveAgentRunnerUrl } from '@/lib/botToBotRunner';
import { executeStubAgentRun, isStubAgentExperiment } from '@/lib/stubAgentRunner';
import { assertUsageAvailable, requireAccount, unauthorizedJson } from '@/lib/account';
import { hydrateExperimentAgentConfig } from '@/lib/agentConnections';
import { validateNativeRunnerEndpoint } from '@/lib/nativeRunner';
import { createLiveKitSandboxSession, isLightcurveHostedLiveKit, requestAgentRunnerJoin } from '@/lib/livekitSandbox';
import { isVobizPhoneExperiment, startVobizPhoneCall } from '@/lib/vobiz';

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

  if (isStubAgentExperiment(experiment)) {
    const result = await executeStubAgentRun(id, experiment, run, scenario);
    return NextResponse.json({
      success: true,
      provider: 'stub_agent',
      status: result.run?.status ?? 'complete',
      externalStatus: result.run?.externalStatus ?? 'stub_completed',
    });
  }

  if (isVobizPhoneExperiment(experiment)) {
    try {
      const call = await startVobizPhoneCall(id, experiment, scenario);
      await db
        .update(runs)
        .set({
          status: call.runStatus,
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
        status: call.runStatus,
        externalCallId: call.id,
        externalStatus: call.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Phone realism call could not be started';
      await db
        .update(runs)
        .set({
          status: 'failed',
          provider: 'vobiz',
          externalStatus: 'phone_realism_start_failed',
          failureSummary: message,
          startedAt: new Date(),
          endedAt: new Date(),
        })
        .where(eq(runs.id, id));

      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

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

  if (isLightcurveHostedLiveKit(experiment)) {
    try {
      const session = createLiveKitSandboxSession(id, experiment, scenario);
      const agentJoinRequested = await requestAgentRunnerJoin(session, experiment);
      await db
        .update(runs)
        .set({
          status: 'running',
          provider: 'livekit',
          externalCallId: session.roomName,
          externalStatus: agentJoinRequested ? 'agent_join_requested' : session.externalStatus,
          startedAt: new Date(),
        })
        .where(eq(runs.id, id));
      await db.update(experiments).set({ status: 'running' }).where(eq(experiments.id, experiment.id));

      return NextResponse.json({
        success: true,
        provider: 'livekit',
        status: 'running',
        externalCallId: session.roomName,
        externalStatus: agentJoinRequested ? 'agent_join_requested' : session.externalStatus,
        liveKit: {
          roomName: session.roomName,
          liveKitUrl: session.liveKitUrl,
          agentToken: session.tokens.agent,
          callerToken: session.tokens.caller,
          instructions: session.instructions,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Lightcurve test room could not be created';
      await db
        .update(runs)
        .set({
          status: 'failed',
          provider: 'livekit',
          externalStatus: 'livekit_start_failed',
          failureSummary: message,
          startedAt: new Date(),
          endedAt: new Date(),
        })
        .where(eq(runs.id, id));
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (isBotToBotExperiment(experiment)) {
    const runnerUrl = resolveAgentRunnerUrl(experiment);
    const runnerProblem = validateNativeRunnerEndpoint(experiment.agentType, runnerUrl);
    if (runnerProblem) {
      return NextResponse.json(
        { error: runnerProblem },
        { status: 400 },
      );
    }
    if (!runnerUrl) {
      return NextResponse.json(
        { error: 'Add a compatible HTTPS agent runner endpoint before starting a bot-to-bot sandbox.' },
        { status: 400 },
      );
    }
    if (!runnerUrl.startsWith('https://') && !(process.env.NODE_ENV !== 'production' && runnerUrl.startsWith('http://'))) {
      return NextResponse.json(
        { error: 'Agent endpoint must be a compatible advanced runner URL. Random text cannot start a sandbox call.' },
        { status: 400 },
      );
    }

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

  return NextResponse.json(
    {
      error:
        'This experiment is not connected to a real provider call or bot-to-bot runner endpoint. Add an agent connection before starting the run.',
    },
    { status: 400 },
  );
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    if (error instanceof Response) return NextResponse.json({ error: await error.text() }, { status: error.status });
    console.error('Failed to start run', error);
    return NextResponse.json({ error: 'Run could not be started' }, { status: 500 });
  }
}
