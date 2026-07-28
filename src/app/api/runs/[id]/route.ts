import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, experiments, replayJobs, replayResults, runs, scores, traces } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { signedPrivateAudioUrl } from '@/lib/captureStorage';
import { isMockMode, mockRunDetail } from '@/lib/mockData';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isMockMode()) {
    const detail = mockRunDetail(id);
    if (!detail) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    return NextResponse.json(detail);
  }
  try {
    const account = await requireAccount();
    const [row] = await db.select({ run: runs, case: datasetCases, experiment: experiments })
      .from(runs)
      .leftJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .leftJoin(experiments, eq(experiments.id, runs.experimentId))
      .where(and(eq(runs.id, id), eq(runs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    const [traceRows, scoreRows, jobRows, audio] = await Promise.all([
      db.select().from(traces).where(eq(traces.runId, id)).orderBy(asc(traces.turnIndex)),
      db.select().from(scores).where(eq(scores.runId, id)),
      db.select().from(replayJobs).where(eq(replayJobs.runId, id)).limit(1),
      Promise.all([
        signedPrivateAudioUrl(row.run.audioCleanCallerUrl).catch(() => null),
        signedPrivateAudioUrl(row.run.audioImpairedCallerUrl).catch(() => null),
        signedPrivateAudioUrl(row.run.audioAgentUrl).catch(() => null),
      ]),
    ]);
    const resultRows = jobRows[0] ? await db.select().from(replayResults).where(eq(replayResults.jobId, jobRows[0].id)).limit(1) : [];
    return NextResponse.json({
      ...row,
      traces: traceRows,
      scores: scoreRows,
      replayResult: resultRows[0] ?? null,
      replayJob: jobRows[0] ? {
        status: jobRows[0].status,
        attemptCount: jobRows[0].attemptCount,
        maxAttempts: jobRows[0].maxAttempts,
        lastError: jobRows[0].lastError,
      } : null,
      audio: { cleanCaller: audio[0], impairedCaller: audio[1], agent: audio[2] },
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Run could not be loaded.' }, { status: 500 });
  }
}
