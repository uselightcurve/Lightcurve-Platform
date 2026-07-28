import { NextResponse } from 'next/server';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions, datasetCases, replayJobs, runs, runtimeInstances } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { iceServers } from '@/lib/webrtc';
import { refreshExperimentProgress } from '@/lib/experimentRuns';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberFrom(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
    const availableCapacity = body.busy === true ? 0 : Math.max(0, Math.min(50, Math.round(numberFrom(body.availableCapacity, 1))));
    const activeSessions = Math.max(0, Math.floor(numberFrom(body.activeSessions, 0)));
    const reportedCapacity = Math.max(0, Math.floor(numberFrom(body.capacity, activeSessions + availableCapacity)));
    const now = new Date();
    await db.update(agentRuntimes).set({
      status: 'online',
      lastSeenAt: now,
      updatedAt: now,
    }).where(and(
      eq(agentRuntimes.id, runtime.id),
      eq(agentRuntimes.ownerUserId, account.userId),
    ));
    if (typeof body.instanceId === 'string') {
      await db.update(runtimeInstances).set({
        status: 'online',
        activeSessions,
        capacity: Math.max(1, reportedCapacity),
        metadata: {
          availableCapacity,
          busy: availableCapacity === 0,
          reportedCapacity,
          lastPollAt: now.toISOString(),
        },
        lastSeenAt: now,
      }).where(and(
        eq(runtimeInstances.id, body.instanceId),
        eq(runtimeInstances.runtimeId, runtime.id),
      ));
    }
    if (!availableCapacity) return NextResponse.json({ command: null, commands: [] });
    const commands: Array<Record<string, unknown>> = [];
    const [capture] = await db.select().from(captureSessions).where(and(
      eq(captureSessions.runtimeId, runtime.id),
      eq(captureSessions.status, 'offer_ready'),
    )).orderBy(asc(captureSessions.createdAt)).limit(1);
    if (capture) {
      await db.update(captureSessions).set({ status: 'runtime_connecting' }).where(and(
        eq(captureSessions.id, capture.id),
        eq(captureSessions.status, 'offer_ready'),
      ));
      commands.push({
          type: 'capture.start',
          captureSessionId: capture.id,
          offer: record(capture.metadata).offer,
          iceServers: iceServers(),
      });
    }

    const exhausted = await db.select({ job: replayJobs, run: runs }).from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .where(and(
        eq(replayJobs.runtimeId, runtime.id),
        eq(replayJobs.status, 'running'),
        lt(replayJobs.leaseExpiresAt, now),
        sql`${replayJobs.attemptCount} >= ${replayJobs.maxAttempts}`,
      ));
    for (const replay of exhausted) {
      await db.update(replayJobs).set({ status: 'failed', lastError: replay.job.lastError ?? 'SDK lease expired after maximum attempts.', updatedAt: now }).where(eq(replayJobs.id, replay.job.id));
      await db.update(runs).set({ status: 'failed', failureSummary: replay.job.lastError ?? 'SDK lease expired after maximum attempts.', endedAt: now }).where(eq(runs.id, replay.run.id));
      if (replay.run.experimentId) await refreshExperimentProgress(replay.run.experimentId);
    }
    const remaining = availableCapacity - commands.length;
    const candidates = remaining > 0 ? await db.select({ job: replayJobs, run: runs, case: datasetCases })
      .from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .innerJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .where(and(
        eq(replayJobs.runtimeId, runtime.id),
        or(
          eq(replayJobs.status, 'queued'),
          and(eq(replayJobs.status, 'running'), lt(replayJobs.leaseExpiresAt, now)),
        ),
        sql`${replayJobs.attemptCount} < ${replayJobs.maxAttempts}`,
      ))
      .orderBy(asc(replayJobs.createdAt))
      .limit(remaining) : [];
    for (const replay of candidates) {
      const [leased] = await db.update(replayJobs).set({
        status: 'running',
        leaseOwner: typeof body.instanceId === 'string' ? body.instanceId : null,
        leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
        attemptCount: sql`${replayJobs.attemptCount} + 1`,
        lastError: null,
        updatedAt: now,
      }).where(and(
        eq(replayJobs.id, replay.job.id),
        or(
          eq(replayJobs.status, 'queued'),
          and(eq(replayJobs.status, 'running'), lt(replayJobs.leaseExpiresAt, now)),
        ),
      )).returning({ id: replayJobs.id });
      if (!leased) continue;
      await db.update(runs).set({ status: 'running', startedAt: replay.run.startedAt ?? now }).where(eq(runs.id, replay.run.id));
      commands.push({
        type: 'replay.start',
        jobId: replay.job.id,
        runId: replay.run.id,
        replaySeed: replay.job.replaySeed,
        manifest: replay.run.replayManifest,
        case: {
          id: replay.case.id,
          name: replay.case.name,
          language: replay.case.language,
          domain: replay.case.domain,
          behaviorGraph: replay.case.behaviorGraph,
          successCriteria: replay.case.successCriteria,
        },
      });
    }
    return NextResponse.json({ command: commands[0] ?? null, commands });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Runtime polling failed.' }, { status: 500 });
  }
}
