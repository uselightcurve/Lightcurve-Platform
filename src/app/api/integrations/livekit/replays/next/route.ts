import { NextResponse } from 'next/server';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, datasetCases, replayJobs, runs } from '@/db/schema';
import { refreshExperimentProgress } from '@/lib/experimentRuns';
import { createLiveKitAccessToken, liveKitPublicStatus } from '@/lib/livekit';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

const CUSTOMER_EMAIL = 'shivam@kolsetu.com';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function livekitMetadata(value: unknown) {
  return record(record(value).livekit);
}

function roomNameForJob(baseRoom: string, runId: string, attemptCount: number) {
  return `${baseRoom || 'lightcurve-kolsetu'}-${runId.slice(0, 8)}-${attemptCount + 1}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

export async function POST(req: Request) {
  try {
    const account = await requireSdkAccount(req);
    if (account.email.trim().toLowerCase() !== CUSTOMER_EMAIL) {
      return NextResponse.json({ error: 'LiveKit replay dispatch is only enabled for this customer account.' }, { status: 403 });
    }

    const livekitStatus = liveKitPublicStatus();
    if (!livekitStatus.configured) {
      return NextResponse.json({ error: 'Lightcurve LiveKit credentials are not configured.' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    if (typeof body.runtimeId !== 'string') {
      return NextResponse.json({ error: 'Runtime ID is required.' }, { status: 400 });
    }

    const [runtime] = await db.select().from(agentRuntimes).where(and(
      eq(agentRuntimes.id, body.runtimeId),
      eq(agentRuntimes.ownerUserId, account.userId),
      eq(agentRuntimes.framework, 'livekit'),
    )).limit(1);
    if (!runtime) return NextResponse.json({ error: 'LiveKit runtime not found.' }, { status: 404 });

    const now = new Date();
    const exhausted = await db.select({ job: replayJobs, run: runs }).from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .where(and(
        eq(replayJobs.runtimeId, runtime.id),
        eq(replayJobs.status, 'running'),
        lt(replayJobs.leaseExpiresAt, now),
        sql`${replayJobs.attemptCount} >= ${replayJobs.maxAttempts}`,
      ));
    for (const replay of exhausted) {
      const message = replay.job.lastError ?? 'LiveKit replay lease expired after maximum attempts.';
      await db.update(replayJobs).set({ status: 'failed', lastError: message, updatedAt: now }).where(eq(replayJobs.id, replay.job.id));
      await db.update(runs).set({ status: 'failed', failureSummary: message, endedAt: now }).where(eq(runs.id, replay.run.id));
      if (replay.run.experimentId) await refreshExperimentProgress(replay.run.experimentId);
    }

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
        sql`${replayJobs.attemptCount} < ${replayJobs.maxAttempts}`,
      ))
      .orderBy(asc(replayJobs.createdAt))
      .limit(1);

    if (!replay) return NextResponse.json({ command: null });

    const [leased] = await db.update(replayJobs).set({
      status: 'running',
      leaseOwner: text(body.workerId) || 'livekit-dispatcher',
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
    if (!leased) return NextResponse.json({ command: null });

    await db.update(runs).set({ status: 'running', startedAt: replay.run.startedAt ?? now }).where(eq(runs.id, replay.run.id));

    const metadata = livekitMetadata(runtime.metadata);
    const baseRoom = text(metadata.roomName) || 'lightcurve-kolsetu-shivam';
    const agentIdentity = text(metadata.agentIdentity) || 'kolsetu-agent';
    const agentName = text(metadata.agentName) || 'Kolsetu agent';
    const participantMetadata = text(metadata.participantMetadata) || JSON.stringify({
      tenant: 'kolsetu',
      contact: CUSTOMER_EMAIL,
      jobId: replay.job.id,
      runId: replay.run.id,
    });
    const roomName = roomNameForJob(baseRoom, replay.run.id, replay.job.attemptCount);
    const callerIdentity = `lightcurve-sim-${replay.run.id.slice(0, 8)}`;

    return NextResponse.json({
      command: {
        type: 'livekit.replay.start',
        jobId: replay.job.id,
        runId: replay.run.id,
        replaySeed: replay.job.replaySeed,
        completeUrl: `/api/sdk/replays/${replay.job.id}/complete`,
        failedUrl: `/api/sdk/replays/${replay.job.id}/failed`,
        audioUrl: `/api/sdk/replays/${replay.job.id}/audio`,
        manifest: replay.run.replayManifest,
        case: {
          id: replay.case.id,
          name: replay.case.name,
          language: replay.case.language,
          domain: replay.case.domain,
          behaviorGraph: replay.case.behaviorGraph,
          successCriteria: replay.case.successCriteria,
        },
        livekit: {
          url: livekitStatus.url,
          roomName,
          caller: {
            identity: callerIdentity,
            token: createLiveKitAccessToken({
              identity: callerIdentity,
              name: 'Lightcurve simulated caller',
              roomName,
              metadata: JSON.stringify({ role: 'simulated-caller', jobId: replay.job.id, runId: replay.run.id }),
              ttlSeconds: 60 * 60,
            }),
          },
          agent: {
            identity: agentIdentity,
            name: agentName,
            metadata: participantMetadata,
            workerToken: createLiveKitAccessToken({
              identity: `${agentIdentity}-worker`,
              name: `${agentName} worker`,
              metadata: participantMetadata,
              ttlSeconds: 60 * 60,
              agentWorker: true,
            }),
            token: createLiveKitAccessToken({
              identity: agentIdentity,
              name: agentName,
              roomName,
              metadata: participantMetadata,
              ttlSeconds: 60 * 60,
            }),
          },
        },
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('LiveKit replay dispatch failed', error);
    return NextResponse.json({ error: 'LiveKit replay dispatch failed.' }, { status: 500 });
  }
}
