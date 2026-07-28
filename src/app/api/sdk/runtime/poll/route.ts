import { NextResponse } from 'next/server';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions, datasetCases, replayJobs, replayResults, runs, runtimeInstances } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { iceServers } from '@/lib/webrtc';
import { refreshExperimentProgress } from '@/lib/experimentRuns';
import { createReplayCallerCredentials, dispatchReplayAgent, replayRoomName } from '@/lib/livekitReplay';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberFrom(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const REPLAY_LEASE_MS = 2 * 60_000;
const STALE_REPLAY_MS = 2 * 60_000;
const MAX_REPLAY_GRAPH_NODES = 12;

function replayManifest(value: unknown) {
  const manifest = record(value);
  const graphPath = Array.isArray(manifest.graphPath)
    ? manifest.graphPath.filter((item): item is string => typeof item === 'string').slice(0, MAX_REPLAY_GRAPH_NODES)
    : [];
  return { ...manifest, graphPath };
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
    const schedulingCapacity = availableCapacity;
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
      const message = replay.job.lastError ?? (runtime.framework === 'livekit'
        ? 'The LiveKit agent did not join or answer the dispatched replay room after three attempts.'
        : 'The SDK worker did not answer the replay after three attempts.');
      await db.update(replayJobs).set({ status: 'failed', lastError: message, updatedAt: now }).where(eq(replayJobs.id, replay.job.id));
      await db.update(runs).set({ status: 'failed', failureSummary: message, endedAt: now }).where(eq(runs.id, replay.run.id));
      if (replay.run.experimentId) await refreshExperimentProgress(replay.run.experimentId);
    }
    const staleSince = new Date(Date.now() - STALE_REPLAY_MS);
    const stale = await db.select({ job: replayJobs, run: runs })
      .from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .where(and(
        eq(replayJobs.runtimeId, runtime.id),
        eq(replayJobs.status, 'running'),
        lt(replayJobs.updatedAt, staleSince),
        sql`${replayJobs.attemptCount} < ${replayJobs.maxAttempts}`,
        sql`not exists (select 1 from ${replayResults} where ${replayResults.jobId} = ${replayJobs.id})`,
      ))
      .limit(10);
    for (const replay of stale) {
      const message = 'SDK replay lease produced no result before the watchdog timeout; retrying.';
      await db.update(replayJobs).set({ status: 'queued', leaseOwner: null, leaseExpiresAt: null, lastError: message, updatedAt: now }).where(eq(replayJobs.id, replay.job.id));
      await db.update(runs).set({ status: 'queued', failureSummary: null }).where(eq(runs.id, replay.run.id));
      if (replay.run.experimentId) await refreshExperimentProgress(replay.run.experimentId);
    }
    if (schedulingCapacity === 0 && runtime.framework === 'livekit') {
      const [waiting] = await db.select({ job: replayJobs, run: runs }).from(replayJobs)
        .innerJoin(runs, eq(runs.id, replayJobs.runId))
        .where(and(
          eq(replayJobs.runtimeId, runtime.id),
          eq(replayJobs.status, 'queued'),
          isNull(replayJobs.leaseOwner),
          or(isNull(replayJobs.lastError), lt(replayJobs.updatedAt, new Date(Date.now() - 15_000))),
        ))
        .orderBy(asc(replayJobs.createdAt))
        .limit(1);
      if (waiting) {
        try {
          const roomName = await dispatchReplayAgent({
            jobId: waiting.job.id,
            runId: waiting.run.id,
            agentName: runtime.name,
          });
          await db.update(replayJobs).set({
            leaseOwner: `dispatch:${roomName}`,
            lastError: null,
            updatedAt: now,
          }).where(and(eq(replayJobs.id, waiting.job.id), eq(replayJobs.status, 'queued')));
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 1000) : 'LiveKit agent dispatch failed.';
          await db.update(replayJobs).set({ lastError: message, updatedAt: now }).where(eq(replayJobs.id, waiting.job.id));
        }
      }
    }
    const remaining = Math.max(0, schedulingCapacity - commands.length);
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
        leaseExpiresAt: new Date(Date.now() + REPLAY_LEASE_MS),
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
      const dispatchRoom = runtime.framework === 'livekit' ? replayRoomName(replay.job.id) : null;
      commands.push({
        type: 'replay.start',
        jobId: replay.job.id,
        runId: replay.run.id,
        replaySeed: replay.job.replaySeed,
        manifest: replayManifest(replay.run.replayManifest),
        livekitCaller: dispatchRoom
          ? await createReplayCallerCredentials(replay.job.id, dispatchRoom)
          : undefined,
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
