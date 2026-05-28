import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';
import { REAL_SCENARIO_LIBRARY } from '@/lib/realScenarioLibrary';
import { assertUsageAvailable, recordUsageEvent, requireAccount, unauthorizedJson } from '@/lib/account';
import { getOwnedAgentConnection, sanitizeAgentConfig } from '@/lib/agentConnections';

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
    return NextResponse.json({ experiments: data });
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
    const scenarioIds = Array.isArray(body.scenarioIds) ? body.scenarioIds : [];
    const agentConnectionId = typeof body.agentConnectionId === 'string' ? body.agentConnectionId : null;
    const agentConnection = agentConnectionId
      ? await getOwnedAgentConnection(agentConnectionId, account.userId)
      : null;
    if (agentConnectionId && !agentConnection) {
      return NextResponse.json({ error: 'Agent connection not found' }, { status: 404 });
    }

    const agentConfig = sanitizeAgentConfig(body.agentConfig);
    const livePhoneMode =
      LIVE_PHONE_PROVIDERS.has(String(agentConnection?.provider ?? body.agentType)) &&
      !(body.agentType === 'elevenlabs' && agentConfig.costMode === 'recording_replay');
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

    const realScenarios = REAL_SCENARIO_LIBRARY.filter((scenario) => scenarioIds.includes(scenario.id));
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
      scenarioIds,
      gitSha: body.gitSha,
    }).returning();

    const expId = exp[0].id;
    const createdRuns = [];
    for (const sid of scenarioIds) {
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
