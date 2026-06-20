import { NextResponse } from 'next/server';
import { and, asc, eq, lt, or } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions, datasetCases, replayJobs, runs } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { iceServers } from '@/lib/webrtc';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(req: Request) {
  try {
    const account = await requireSdkAccount(req);
    const body = await req.json().catch(() => ({}));
    if (typeof body.runtimeId !== 'string') {
      return NextResponse.json({ error: 'Runtime ID is required.' }, { status: 400 });
    }
    const [runtime] = await db.select().from(agentRuntimes).where(and(
      eq(agentRuntimes.id, body.runtimeId),
      eq(agentRuntimes.ownerUserId, account.userId),
    )).limit(1);
    if (!runtime) return NextResponse.json({ error: 'Runtime not found.' }, { status: 404 });
    if (body.busy === true) return NextResponse.json({ command: null });
    const [capture] = await db.select().from(captureSessions).where(and(
      eq(captureSessions.runtimeId, runtime.id),
      eq(captureSessions.status, 'offer_ready'),
    )).orderBy(asc(captureSessions.createdAt)).limit(1);
    if (capture) {
      await db.update(captureSessions).set({ status: 'runtime_connecting' }).where(and(
        eq(captureSessions.id, capture.id),
        eq(captureSessions.status, 'offer_ready'),
      ));
      return NextResponse.json({
        command: {
          type: 'capture.start',
          captureSessionId: capture.id,
          offer: record(capture.metadata).offer,
          iceServers: iceServers(),
        },
      });
    }

    const now = new Date();
    const [replay] = await db.select({ job: replayJobs, run: runs, case: datasetCases })
      .from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .innerJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .where(and(
        eq(replayJobs.runtimeId, runtime.id),
        or(
          eq(replayJobs.status, 'queued'),
          and(eq(replayJobs.status, 'running'), lt(replayJobs.leaseExpiresAt, now)),
        ),
      ))
      .orderBy(asc(replayJobs.createdAt))
      .limit(1);
    if (!replay) return NextResponse.json({ command: null });
    await db.update(replayJobs).set({
      status: 'running',
      leaseOwner: typeof body.instanceId === 'string' ? body.instanceId : null,
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      updatedAt: now,
    }).where(eq(replayJobs.id, replay.job.id));
    await db.update(runs).set({ status: 'running', startedAt: now }).where(eq(runs.id, replay.run.id));
    return NextResponse.json({
      command: {
        type: 'replay.start',
        jobId: replay.job.id,
        runId: replay.run.id,
        replaySeed: replay.job.replaySeed,
        case: {
          id: replay.case.id,
          name: replay.case.name,
          language: replay.case.language,
          domain: replay.case.domain,
          behaviorGraph: replay.case.behaviorGraph,
          successCriteria: replay.case.successCriteria,
        },
      },
    });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Runtime polling failed.' }, { status: 500 });
  }
}
