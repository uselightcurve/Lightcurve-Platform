import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureEvents, captureSessions, datasetCases } from '@/db/schema';
import { storeCaptureAudio } from '@/lib/captureStorage';
import { deriveCaseFromCapture } from '@/lib/humanDatasets';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

export const maxDuration = 300;

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function transcriptRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const speaker = row.speaker === 'agent' ? 'agent' : row.speaker === 'human' || row.speaker === 'caller' ? 'human' : null;
    const body = text(row.text);
    if (!speaker || !body) return [];
    const startedAtMs = Number(row.startedAtMs);
    const endedAtMs = Number(row.endedAtMs);
    return [{
      speaker,
      text: body,
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : undefined,
      endedAtMs: Number.isFinite(endedAtMs) ? endedAtMs : undefined,
    }];
  });
}

function eventRows(captureSessionId: string, value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const row = record(item);
    const eventType = text(row.eventType);
    if (!eventType) return [];
    const timestampMs = Number(row.timestampMs);
    return [{
      captureSessionId,
      sequence: Number.isFinite(Number(row.sequence)) ? Number(row.sequence) : index,
      eventType,
      speaker: text(row.speaker) || null,
      timestampMs: Number.isFinite(timestampMs) ? Math.max(0, Math.round(timestampMs)) : 0,
      payload: record(row.payload),
    }];
  });
}

function audioPayload(value: unknown) {
  const row = record(value);
  const audioBase64 = text(row.audioBase64);
  if (!audioBase64) return null;
  if (audioBase64.length > 70_000_000) throw new Error('Audio payload is too large.');
  return {
    audioBase64,
    contentType: text(row.contentType) || 'audio/wav',
  };
}

async function storeOptionalAudio(params: {
  ownerUserId: string;
  captureSessionId: string;
  leg: 'human' | 'agent';
  value: unknown;
}) {
  const audio = audioPayload(params.value);
  if (!audio) return null;
  return storeCaptureAudio({
    ownerUserId: params.ownerUserId,
    captureSessionId: params.captureSessionId,
    leg: params.leg,
    contentType: audio.contentType,
    bytes: Buffer.from(audio.audioBase64, 'base64'),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = record(await req.json().catch(() => ({})));
    const [row] = await db.select({ capture: captureSessions, runtime: agentRuntimes })
      .from(captureSessions)
      .innerJoin(agentRuntimes, eq(agentRuntimes.id, captureSessions.runtimeId))
      .where(and(
        eq(captureSessions.id, id),
        eq(captureSessions.ownerUserId, account.userId),
        eq(agentRuntimes.ownerUserId, account.userId),
        eq(agentRuntimes.framework, 'livekit'),
      ))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'LiveKit capture not found.' }, { status: 404 });

    const transcript = transcriptRows(body.transcript);
    if (!transcript.some((turn) => turn.speaker === 'human') || !transcript.some((turn) => turn.speaker === 'agent')) {
      return NextResponse.json({ error: 'A complete caller and agent transcript is required.' }, { status: 400 });
    }

    const [humanAudioUrl, agentAudioUrl] = await Promise.all([
      storeOptionalAudio({ ownerUserId: account.userId, captureSessionId: row.capture.id, leg: 'human', value: body.humanAudio }),
      storeOptionalAudio({ ownerUserId: account.userId, captureSessionId: row.capture.id, leg: 'agent', value: body.agentAudio }),
    ]);
    const events = eventRows(row.capture.id, body.events);

    await db.transaction(async (tx) => {
      if (events.length) await tx.insert(captureEvents).values(events).onConflictDoNothing();
      await tx.update(captureSessions).set({
        status: 'complete',
        transcript,
        humanAudioUrl: humanAudioUrl ?? row.capture.humanAudioUrl,
        agentAudioUrl: agentAudioUrl ?? row.capture.agentAudioUrl,
        endedAt: new Date(),
        metadata: {
          ...record(row.capture.metadata),
          completedBy: 'livekit-capture-complete',
          completedAt: new Date().toISOString(),
          durationMs: Number.isFinite(Number(body.durationMs)) ? Math.max(0, Math.round(Number(body.durationMs))) : undefined,
        },
      }).where(eq(captureSessions.id, row.capture.id));
    });

    const [existingCase] = await db.select().from(datasetCases)
      .where(eq(datasetCases.sourceCaptureId, row.capture.id))
      .limit(1);
    if (existingCase) {
      return NextResponse.json({
        ok: true,
        captureId: row.capture.id,
        case: existingCase,
        message: 'LiveKit recording was already saved to the Audio Library.',
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const result = await deriveCaseFromCapture({
      ownerUserId: account.userId,
      captureSessionId: row.capture.id,
      name: text(body.name) || `LiveKit call ${new Date().toISOString().slice(0, 10)}`,
      language: text(body.language) || 'cs-CZ',
      domain: text(body.domain) || 'kolsetu',
      voiceCloneConsent: body.voiceCloneConsent === true,
    });

    return NextResponse.json({
      ok: true,
      captureId: row.capture.id,
      dataset: result.dataset,
      case: result.case,
      message: 'LiveKit recording saved to the Audio Library.',
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'LiveKit recording could not be completed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
