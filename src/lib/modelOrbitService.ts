import { downloadPrivateAudioObject } from '@/lib/captureStorage';
import type { ModelOrbitVoiceSignals } from '@/lib/modelOrbit';

type VoicePairResult = {
  human: ModelOrbitVoiceSignals;
  agent: ModelOrbitVoiceSignals;
  serviceVersion?: string;
};

function privateAudioUri(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('azblob://') || value.startsWith('local://'));
}

function parseSignals(value: unknown): ModelOrbitVoiceSignals {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const number = (key: string, fallback = 0) => Number.isFinite(Number(row[key])) ? Number(row[key]) : fallback;
  const optional = (key: string) => Number.isFinite(Number(row[key])) ? Number(row[key]) : null;
  return {
    durationMs: number('durationMs'),
    rmsMean: number('rmsMean'),
    rmsVariation: number('rmsVariation'),
    pauseRatio: number('pauseRatio'),
    voicedRatio: number('voicedRatio'),
    pitchMeanHz: optional('pitchMeanHz'),
    pitchVariationHz: optional('pitchVariationHz'),
    pitchRangeHz: optional('pitchRangeHz'),
    confidence: number('confidence'),
  };
}

export async function analyzeConversationVoices(params: { humanUri: unknown; agentUri: unknown }): Promise<VoicePairResult | null> {
  const endpoint = process.env.MODELORBIT_SERVICE_URL?.replace(/\/$/, '');
  if (!endpoint || !privateAudioUri(params.humanUri) || !privateAudioUri(params.agentUri)) return null;
  const [human, agent] = await Promise.all([
    downloadPrivateAudioObject(params.humanUri),
    downloadPrivateAudioObject(params.agentUri),
  ]);
  const form = new FormData();
  form.append('human', new Blob([new Uint8Array(human)], { type: 'audio/wav' }), 'human.wav');
  form.append('agent', new Blob([new Uint8Array(agent)], { type: 'audio/wav' }), 'agent.wav');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${endpoint}/analyze`, {
      method: 'POST',
      headers: process.env.MODELORBIT_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.MODELORBIT_SERVICE_TOKEN}` } : undefined,
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Evaluate voice service returned ${response.status}.`);
    return {
      human: parseSignals(body.human),
      agent: parseSignals(body.agent),
      serviceVersion: typeof body.serviceVersion === 'string' ? body.serviceVersion : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

