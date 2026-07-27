import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { generateTextEmbedding, generateWithLightcurveModelResult } from '@/lib/llm';
import { synthesizeCallerPcm, transcribeAudio } from '@/lib/speech';

export const maxDuration = 300;

function authorized(request: Request) {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(bearer && process.env.SCORING_INGEST_TOKEN && bearer === process.env.SCORING_INGEST_TOKEN);
}

function waveFromPcm(audio: Buffer, sampleRate: number, channels: number) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + audio.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}

async function health(name: string, url: string | undefined) {
  if (!url) throw new Error(`${name} URL is not configured.`);
  const response = await fetch(`${url.replace(/\/$/, '')}/health`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${name} returned ${response.status}.`);
  return true;
}

async function check(name: string, task: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    const detail = await task();
    return { name, ok: true, latencyMs: Date.now() - startedAt, detail };
  } catch (error) {
    return { name, ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Check failed.' };
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const checks = await Promise.all([
    check('database', async () => { await db.execute(sql`select 1`); return 'connected'; }),
    check('speech', async () => {
      const speech = await synthesizeCallerPcm('Lightcurve production readiness test.', 'en-US');
      const transcript = await transcribeAudio({
        bytes: waveFromPcm(speech.audio, speech.sampleRate, speech.channels),
        mimeType: 'audio/wav',
        filename: 'readiness.wav',
        language: 'en',
      });
      return { audioBytes: speech.audio.length, transcript: transcript.text };
    }),
    check('reasoning', async () => {
      const result = await generateWithLightcurveModelResult('lightcurve-reasoner', 'Reply with exactly: ready');
      if (!result.text) throw new Error(result.error || 'Reasoning returned no text.');
      return result.text.slice(0, 120);
    }),
    check('embedding', async () => ({ dimensions: (await generateTextEmbedding('Lightcurve readiness')).length })),
    check('mos', () => health('MOS', process.env.MOS_SERVICE_URL)),
    check('evaluate', () => health('Evaluate', process.env.MODELORBIT_SERVICE_URL)),
    check('voice-clone', () => health('Voice clone', process.env.VOICE_CLONE_SERVICE_URL)),
  ]);
  const ok = checks.every((item) => item.ok);
  return NextResponse.json({ ok, checkedAt: new Date().toISOString(), checks }, { status: ok ? 200 : 503 });
}
