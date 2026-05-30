import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs, scenarios, scores } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { releaseWorkflowForExperiment } from '@/lib/releaseWorkflow';

const MIN_MOS = 3.8;
const MIN_TASK = 0.8;

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

    const workflow = releaseWorkflowForExperiment(experiment, expRuns, allScores, {
      minMos: MIN_MOS,
      minTask: MIN_TASK,
    });
    const scenarioIds = workflow.riskyScenarioIds;
    const scenarioRows = scenarioIds.length
      ? await db.select().from(scenarios).where(inArray(scenarios.id, scenarioIds))
      : [];

    const search = new URLSearchParams({
      provider: 'vapi',
      scenarios: scenarioIds.join(','),
      promotedFrom: experiment.id,
      lane: 'phone_realism',
    });

    return NextResponse.json({
      sourceExperimentId: experiment.id,
      sourceLane: workflow.sourceLane,
      recommendedLane: 'phone_realism',
      recommendedProvider: 'vapi',
      candidateCount: scenarioIds.length,
      scenarioIds,
      createUrl: scenarioIds.length ? `/experiments/new?${search.toString()}` : null,
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
