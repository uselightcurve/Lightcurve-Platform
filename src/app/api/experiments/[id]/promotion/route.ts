import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs, scenarios, scores } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { costLaneForProvider } from '@/lib/costLanes';

const MIN_MOS = 3.8;
const MIN_TASK = 0.8;

function scoreValue(rows: Array<typeof scores.$inferSelect>, runId: string, metricName: string) {
  return rows.find((score) => score.runId === runId && score.metricName === metricName)?.value ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [experiment] = await db
      .select()
      .from(experiments)
      .where(and(eq(experiments.id, id), eq(experiments.ownerUserId, account.userId)))
      .limit(1);

    if (!experiment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const expRuns = await db
      .select()
      .from(runs)
      .where(and(eq(runs.experimentId, id), eq(runs.ownerUserId, account.userId)));

    const allScores: Array<typeof scores.$inferSelect> = [];
    for (const run of expRuns) {
      const runScores = await db.select().from(scores).where(eq(scores.runId, run.id));
      allScores.push(...runScores);
    }

    const riskyRuns = expRuns.filter((run) => {
      const mos = scoreValue(allScores, run.id, 'mos');
      const task = scoreValue(allScores, run.id, 'task_completed');
      return run.status === 'failed' || (typeof mos === 'number' && mos < MIN_MOS) || (typeof task === 'number' && task < MIN_TASK);
    });

    const scenarioIds = Array.from(
      new Set(riskyRuns.map((run) => run.scenarioId).filter((value): value is string => Boolean(value))),
    );
    const scenarioRows = scenarioIds.length
      ? await db.select().from(scenarios).where(inArray(scenarios.id, scenarioIds))
      : [];

    const sourceLane = costLaneForProvider(experiment.agentType, experiment.agentConfig, experiment.webrtcEndpoint);

    return NextResponse.json({
      sourceExperimentId: experiment.id,
      sourceLane,
      recommendedLane: 'phone_realism',
      recommendedProvider: 'vapi',
      candidateCount: scenarioIds.length,
      scenarioIds,
      scenarios: scenarioRows.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        domain: scenario.domain,
        language: scenario.language,
      })),
      gate: {
        minMos: MIN_MOS,
        minTask: MIN_TASK,
      },
      message:
        scenarioIds.length > 0
          ? `${scenarioIds.length} failed or risky scenarios are ready for provider-backed verification.`
          : 'No failed scenarios need provider-backed verification yet.',
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Promotion candidates unavailable' }, { status: 503 });
  }
}

