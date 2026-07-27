import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { replayJobs, replayResults, runs, traces } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { processReplayScoring, queueReplayScoring } from '@/lib/replayScoring';

export const maxDuration = 300;

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function transcriptRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const row = record(item);
    const speaker = row.speaker === 'agent' ? 'agent' : row.speaker === 'human' || row.speaker === 'caller' ? 'caller' : null;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    const startedAtMs = Number(row.startedAtMs);
    return speaker && text ? [{ turnIndex: index, speaker, text, startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null }] : [];
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = record(await req.json().catch(() => ({})));
    const [row] = await db.select({ job: replayJobs, run: runs })
      .from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .where(and(eq(replayJobs.id, id), eq(replayJobs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Replay job not found.' }, { status: 404 });
    const transcript = transcriptRows(body.transcript);
    if (!transcript.some((turn) => turn.speaker === 'caller') || !transcript.some((turn) => turn.speaker === 'agent')) {
      return NextResponse.json({ error: 'A complete caller and agent transcript is required.' }, { status: 400 });
    }
    const artifacts = record(body.artifacts);
    if (Array.isArray(body.events)) artifacts.events = body.events.slice(0, 20_000);
    const graphPath = Array.isArray(body.graphPath) ? body.graphPath.filter((item: unknown): item is string => typeof item === 'string') : [];
    await db.transaction(async (tx) => {
      await tx.delete(traces).where(eq(traces.runId, row.run.id));
      await tx.delete(replayResults).where(eq(replayResults.jobId, row.job.id));
      let lastCallerAt: number | null = null;
      await tx.insert(traces).values(transcript.map((turn) => {
        if (turn.speaker === 'caller' && turn.startedAtMs != null) lastCallerAt = turn.startedAtMs;
        const latency = turn.speaker === 'agent' && turn.startedAtMs != null && lastCallerAt != null ? Math.max(0, turn.startedAtMs - lastCallerAt) : null;
        return { runId: row.run.id, turnIndex: turn.turnIndex, speaker: turn.speaker, text: turn.text, totalLatencyMs: latency };
      }));
      await tx.insert(replayResults).values({
        jobId: row.job.id,
        status: 'scoring',
        transcript,
        artifacts,
        graphPath,
      });
      await tx.update(replayJobs).set({ status: 'complete', updatedAt: new Date(), leaseExpiresAt: null, lastError: null }).where(eq(replayJobs.id, row.job.id));
      await tx.update(runs).set({
        status: 'scoring',
        scoringStatus: 'queued',
        turnCount: transcript.length,
        durationMs: Number.isFinite(Number(body.durationMs)) ? Math.max(0, Math.round(Number(body.durationMs))) : null,
      }).where(eq(runs.id, row.run.id));
    });
    await queueReplayScoring(row.run.id);
    after(async () => {
      try {
        await processReplayScoring(row.run.id);
      } catch (error) {
        console.error('Background replay scoring failed', {
          runId: row.run.id,
          error: error instanceof Error ? error.message : 'Scoring is temporarily unavailable.',
        });
      }
    });
    return NextResponse.json({
      ok: true,
      scoringStatus: 'queued',
      message: 'Replay captured. Evaluation is continuing in the background.',
    }, { status: 202 });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Replay result could not be stored.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
