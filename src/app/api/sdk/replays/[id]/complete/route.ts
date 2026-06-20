import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, experiments, replayJobs, replayResults, runs, scores, traces } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { generateWithLightcurveModel } from '@/lib/vertex';
import { anonymizeBehaviorGraph } from '@/lib/humanDatasets';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function transcriptRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const row = record(item);
    const speaker = row.speaker === 'agent' ? 'agent' : row.speaker === 'human' ? 'caller' : null;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    return speaker && text ? [{ turnIndex: index, speaker, text }] : [];
  });
}

function parseJudge(value: string | null) {
  if (!value) return null;
  try {
    const parsed = record(JSON.parse(value.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()));
    const outcome = Number(parsed.outcomeMatch);
    const path = Number(parsed.behavioralPath);
    if (!Number.isFinite(outcome) || !Number.isFinite(path)) return null;
    return {
      outcomeMatch: Math.max(0, Math.min(1, outcome)),
      behavioralPath: Math.max(0, Math.min(1, path)),
      passed: parsed.passed === true,
      failureSummary: typeof parsed.failureSummary === 'string' ? parsed.failureSummary : null,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'Graph-constrained evaluation completed.',
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const [row] = await db.select({ job: replayJobs, run: runs, case: datasetCases })
      .from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .innerJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .where(and(eq(replayJobs.id, id), eq(replayJobs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Replay job not found.' }, { status: 404 });
    const transcript = transcriptRows(body.transcript);
    if (!transcript.some((turn) => turn.speaker === 'caller') || !transcript.some((turn) => turn.speaker === 'agent')) {
      return NextResponse.json({ error: 'A complete caller and agent transcript is required.' }, { status: 400 });
    }
    const judgment = parseJudge(await generateWithLightcurveModel('gemini-2.5-flash', `
Judge this voice-agent replay against the human-derived behavior graph and success criteria.
Return JSON only: outcomeMatch (0..1), behavioralPath (0..1), passed (boolean),
failureSummary (string or null), rationale (string). Do not reward matching exact wording;
judge intent, facts, decision path, tool behavior, and terminal outcome.
Behavior graph: ${JSON.stringify(anonymizeBehaviorGraph(row.case.behaviorGraph))}
Success criteria: ${JSON.stringify(row.case.successCriteria)}
Replay transcript: ${transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')}
`));
    if (!judgment) {
      await db.update(replayJobs).set({ status: 'failed', updatedAt: new Date() }).where(eq(replayJobs.id, row.job.id));
      await db.update(runs).set({ status: 'failed', failureSummary: 'The graph judge was unavailable.', endedAt: new Date() }).where(eq(runs.id, row.run.id));
      return NextResponse.json({ error: 'The graph judge was unavailable.' }, { status: 503 });
    }
    const endedAt = new Date();
    await db.transaction(async (tx) => {
      await tx.delete(traces).where(eq(traces.runId, row.run.id));
      await tx.delete(scores).where(eq(scores.runId, row.run.id));
      await tx.insert(traces).values(transcript.map((turn) => ({ runId: row.run.id, ...turn })));
      await tx.insert(scores).values([
        { runId: row.run.id, metricName: 'outcome_match', value: judgment.outcomeMatch, method: 'human-graph-judge', rationale: judgment.rationale },
        { runId: row.run.id, metricName: 'behavioral_path', value: judgment.behavioralPath, method: 'human-graph-judge', rationale: judgment.rationale },
      ]);
      await tx.insert(replayResults).values({
        jobId: row.job.id,
        status: judgment.passed ? 'pass' : 'fail',
        transcript,
        metrics: { outcomeMatch: judgment.outcomeMatch, behavioralPath: judgment.behavioralPath },
        graphPath: Array.isArray(body.graphPath) ? body.graphPath : [],
        failureSummary: judgment.failureSummary,
      });
      await tx.update(replayJobs).set({ status: 'complete', updatedAt: endedAt, leaseExpiresAt: null }).where(eq(replayJobs.id, row.job.id));
      await tx.update(runs).set({
        status: judgment.passed ? 'complete' : 'failed',
        failureSummary: judgment.failureSummary,
        turnCount: transcript.length,
        endedAt,
      }).where(eq(runs.id, row.run.id));
    });
    if (row.run.experimentId) {
      const allRuns = await db.select().from(runs).where(eq(runs.experimentId, row.run.experimentId));
      if (allRuns.every((run) => ['complete', 'failed'].includes(run.status))) {
        await db.update(experiments).set({
          status: allRuns.some((run) => run.status === 'failed') ? 'failed' : 'complete',
          completedAt: endedAt,
        }).where(eq(experiments.id, row.run.experimentId));
      } else {
        await db.update(experiments).set({ status: 'running' }).where(eq(experiments.id, row.run.experimentId));
      }
    }
    return NextResponse.json({ ok: true, judgment });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Replay result could not be stored.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
