import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios, scores } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { REAL_SCENARIO_LIBRARY } from '@/lib/realScenarioLibrary';
import { assertUsageAvailable, recordUsageEvent, requireAccount, unauthorizedJson } from '@/lib/account';
import { getOwnedAgentConnection, sanitizeAgentConfig } from '@/lib/agentConnections';
import { releaseWorkflowForExperiment } from '@/lib/releaseWorkflow';

const LIVE_PHONE_PROVIDERS = new Set(['vapi', 'retell', 'elevenlabs']);
const DEFAULT_MAX_REAL_PHONE_SCENARIOS = 10;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function maxRealPhoneScenarios() {
  const parsed = Number(process.env.MAX_REAL_PHONE_SCENARIOS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_REAL_PHONE_SCENARIOS;
}

export async function GET() {
  try {
    const account = await requireAccount();
    const data = await db
      .select()
      .from(experiments)
      .where(eq(experiments.ownerUserId, account.userId))
      .orderBy(desc(experiments.createdAt));

    const enriched = [];
    for (const experiment of data) {
      const expRuns = await db.select().from(runs).where(eq(runs.experimentId, experiment.id));
      const scoreRows: Array<typeof scores.$inferSelect> = [];
      for (const run of expRuns) {
        scoreRows.push(...await db.select().from(scores).where(eq(scores.runId, run.id)));
      }
      const mos = scoreRows.filter((score) => score.metricName === 'mos').map((score) => Number(score.value ?? 0));
      const task = scoreRows
        .filter((score) => score.metricName === 'task_completed' || score.metricName === 'capture_overall')
        .map((score) => Number(score.value ?? 0));
      const latency = scoreRows.filter((score) => score.metricName === 'latency_p95').map((score) => Number(score.value ?? 0));
      const terminal = expRuns.filter((run) => run.status === 'complete' || run.status === 'failed');
      const passed = expRuns.filter((run) => run.status === 'complete');
      const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      const workflow = releaseWorkflowForExperiment(experiment, expRuns, scoreRows);

      enriched.push({
        ...experiment,
        summary: {
          runs: expRuns.length,
          avgMos: avg(mos),
          avgTask: avg(task),
          latencyP95: latency.length ? Math.max(...latency) : null,
          passRate: terminal.length ? passed.length / terminal.length : null,
          failedReason: expRuns.find((run) => run.failureSummary)?.failureSummary ?? null,
        },
        workflow: {
          sourceLane: workflow.sourceLane,
          sourceLaneLabel: workflow.sourceLaneLabel,
          releaseStage: workflow.releaseStage,
          releaseLabel: workflow.releaseLabel,
          canPromoteFailures: workflow.canPromoteFailures,
          riskyCount: workflow.riskyScenarioIds.length,
          promotedFromId: workflow.promotedFromId,
        },
      });
    }

    return NextResponse.json({ experiments: enriched });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load experiments', error);
    return NextResponse.json({ error: 'Experiments unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json();
    const scenarioIds: string[] = Array.isArray(body.scenarioIds)
      ? body.scenarioIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const scenarioOverrides: unknown[] = Array.isArray(body.scenarioOverrides) ? body.scenarioOverrides : [];
    const agentConnectionId = typeof body.agentConnectionId === 'string' ? body.agentConnectionId : null;
    const agentConnection = agentConnectionId
      ? await getOwnedAgentConnection(agentConnectionId, account.userId)
      : null;
    if (agentConnectionId && !agentConnection) {
      return NextResponse.json({ error: 'Agent connection not found' }, { status: 404 });
    }

    const baseAgentConfig = sanitizeAgentConfig(body.agentConfig);
    const livePhoneMode =
      LIVE_PHONE_PROVIDERS.has(String(agentConnection?.provider ?? body.agentType)) &&
      !(body.agentType === 'elevenlabs' && baseAgentConfig.costMode === 'recording_replay');
    const agentConfig = {
      ...baseAgentConfig,
      ...(typeof body.promotedFromExperimentId === 'string' && body.promotedFromExperimentId
        ? {
            promotion: {
              sourceExperimentId: body.promotedFromExperimentId,
              sourceLane: 'low_cost_testing',
              verificationLane: livePhoneMode ? 'phone_realism' : 'provider_backed',
            },
          }
        : {}),
    };
    const phoneScenarioLimit = maxRealPhoneScenarios();

    if (livePhoneMode && scenarioIds.length > phoneScenarioLimit) {
      return NextResponse.json(
        {
          error: `Real phone sandboxes are capped at ${phoneScenarioLimit} scenarios per batch. Select a smaller pilot suite, then batch the rest.`,
        },
        { status: 400 },
      );
    }
    await assertUsageAvailable(account.userId, { actions: Math.max(1, scenarioIds.length) });

    type ScenarioInsert = typeof scenarios.$inferInsert;
    const scenarioIdMap = new Map<string, string>();
    const overrideRows = scenarioOverrides.reduce<Array<{ sourceId: string; row: ScenarioInsert }>>((rows, scenario: unknown) => {
        const value = asRecord(scenario);
        const persona = asRecord(value.persona);
        const sourceId = typeof value.id === 'string' ? value.id : '';
        if (!sourceId || typeof value.name !== 'string') return rows;
        rows.push({
          sourceId,
          row: {
            ownerUserId: account.userId,
            name: value.name,
            language: typeof value.language === 'string' ? value.language : 'en-US',
            persona: {
              name: typeof persona.name === 'string' ? persona.name : 'Caller',
              goal: typeof persona.goal === 'string' ? persona.goal : value.name,
              emotional_state: typeof persona.emotional_state === 'string' ? persona.emotional_state : 'neutral',
              noise_db: Number.isFinite(Number(persona.noise_db)) ? Number(persona.noise_db) : 0,
              interrupts: Boolean(persona.interrupts),
              opening_line: typeof persona.opening_line === 'string' ? persona.opening_line : value.name,
            },
            successCriteria: Array.isArray(value.successCriteria) ? value.successCriteria : [],
            callerSeed: Number.isFinite(Number(value.callerSeed)) ? Number(value.callerSeed) : 42,
            domain: typeof value.domain === 'string' ? value.domain : 'general',
            isPreset: false,
          },
        });
        return rows;
      }, []);

    if (overrideRows.length) {
      const inserted = await db.insert(scenarios).values(overrideRows.map((item) => item.row)).returning();
      inserted.forEach((row, index) => {
        const sourceId = overrideRows[index]?.sourceId;
        if (sourceId) scenarioIdMap.set(sourceId, row.id);
      });
    }

    const storedScenarioIds = scenarioIds.map((id) => scenarioIdMap.get(id) ?? id);
    const realScenarios = REAL_SCENARIO_LIBRARY.filter((scenario) => storedScenarioIds.includes(scenario.id));
    if (realScenarios.length) {
      await db.insert(scenarios).values(realScenarios.map((scenario) => ({
        ...scenario,
        ownerUserId: null,
      }))).onConflictDoNothing();
    }
    const exp = await db.insert(experiments).values({
      ownerUserId: account.userId,
      name: body.name,
      agentType: agentConnection?.provider ?? body.agentType,
      agentConnectionId,
      agentConfig,
      webrtcEndpoint: agentConnection?.endpoint ?? body.webrtcEndpoint ?? '',
      scenarioIds: storedScenarioIds,
      gitSha: body.gitSha,
    }).returning();

    const expId = exp[0].id;
    const createdRuns = [];
    for (const sid of storedScenarioIds) {
      const r = await db.insert(runs).values({
        ownerUserId: account.userId,
        experimentId: expId,
        scenarioId: sid,
        status: 'pending'
      }).returning();
      createdRuns.push(r[0]);
    }
    await recordUsageEvent({
      userId: account.userId,
      eventType: 'experiment_created',
      actions: Math.max(1, createdRuns.length),
      sourceExperimentId: expId,
    });

    return NextResponse.json({ experiment: exp[0], runs: createdRuns });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }
    console.error('Failed to create experiment', error);
    const message = error instanceof Error ? error.message : '';
    const databaseUnavailable =
      message.includes('ECONNREFUSED') ||
      message.includes('ENOTFOUND') ||
      message.includes('timeout') ||
      message.includes('password authentication failed') ||
      message.includes('no pg_hba.conf');
    return NextResponse.json(
      {
        error: databaseUnavailable
          ? 'Experiment database is unavailable. Check the Cloud Run DATABASE_URL secret binding and Cloud SQL connectivity.'
          : 'Experiment could not be created. Reduce the selected scenarios or retry with a smaller pilot batch.',
      },
      { status: 503 }
    );
  }
}
