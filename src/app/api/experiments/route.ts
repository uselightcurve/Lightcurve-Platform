import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { DEMO_EXPERIMENTS, DEMO_SCENARIOS } from '@/lib/demoData';
import { REAL_SCENARIO_LIBRARY } from '@/lib/realScenarioLibrary';

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
    const data = await db.select().from(experiments).orderBy(desc(experiments.createdAt));
    return NextResponse.json({ experiments: data });
  } catch (error) {
    console.error('Failed to load experiments', error);
    return NextResponse.json({ experiments: DEMO_EXPERIMENTS, preview: true });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const scenarioIds = Array.isArray(body.scenarioIds) ? body.scenarioIds : [];
    const agentConfig = asRecord(body.agentConfig);
    const livePhoneMode =
      LIVE_PHONE_PROVIDERS.has(String(body.agentType)) &&
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

    const realScenarios = REAL_SCENARIO_LIBRARY.filter((scenario) => scenarioIds.includes(scenario.id));
    const demoScenarios = DEMO_SCENARIOS.filter((scenario) => scenarioIds.includes(scenario.id));
    const selectedScenarios = [...realScenarios, ...demoScenarios];
    if (selectedScenarios.length) {
      await db.insert(scenarios).values(selectedScenarios).onConflictDoNothing();
    }
    const exp = await db.insert(experiments).values({
      name: body.name,
      agentType: body.agentType,
      agentConfig: body.agentConfig,
      webrtcEndpoint: body.webrtcEndpoint,
      scenarioIds,
      gitSha: body.gitSha,
    }).returning();

    const expId = exp[0].id;
    const createdRuns = [];
    for (const sid of scenarioIds) {
      const r = await db.insert(runs).values({
        experimentId: expId,
        scenarioId: sid,
        status: 'pending'
      }).returning();
      createdRuns.push(r[0]);
    }

    return NextResponse.json({ experiment: exp[0], runs: createdRuns });
  } catch (error) {
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
