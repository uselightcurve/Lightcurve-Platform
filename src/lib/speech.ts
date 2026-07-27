import { downloadPrivateAudioObject } from '@/lib/captureStorage';

type WaveInfo = {
  audio: Buffer;
  sampleRate: number;
  channels: number;
};

export type SpeechTranscriptionResult = {
  text: string;
  provider: 'speaches';
  model: string;
  language?: string;
  segments?: Array<{ start?: number; end?: number; text: string }>;
};

const sttModelAliases: Record<string, string> = {
  'distil-large-v3': 'Systran/faster-distil-whisper-large-v3',
  'large-v3-turbo': 'large-v3-turbo',
};

const ttsModelAliases: Record<string, string> = {
  kokoro: 'speaches-ai/Kokoro-82M-v1.0-ONNX',
  piper: 'piper',
};

function speechEndpoint() {
  return (process.env.SPEECH_SERVICE_URL || 'http://speech:8000').replace(/\/$/, '');
}

function speechHeaders(extra?: HeadersInit) {
  return {
    ...(process.env.SPEECH_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.SPEECH_SERVICE_TOKEN}` } : {}),
    ...extra,
  };
}

function speechModel(value: string, aliases: Record<string, string>) {
  return aliases[value] || value;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function pcmDataFromWave(content: Buffer): WaveInfo {
  if (content.subarray(0, 4).toString('ascii') !== 'RIFF') {
    return { audio: content, sampleRate: 16000, channels: 1 };
  }

  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  while (offset + 8 <= content.length) {
    const chunk = content.subarray(offset, offset + 4).toString('ascii');
    const size = content.readUInt32LE(offset + 4);
    if (chunk === 'fmt ' && offset + 24 <= content.length) {
      channels = content.readUInt16LE(offset + 10);
      sampleRate = content.readUInt32LE(offset + 12);
    }
    if (chunk === 'data') {
      return { audio: content.subarray(offset + 8, offset + 8 + size), sampleRate, channels };
    }
    offset += 8 + size + (size % 2);
  }
  return { audio: content, sampleRate, channels };
}

async function synthesizeWithModel(model: string, text: string, options?: { speakingRate?: number }) {
  const response = await fetch(`${speechEndpoint()}/v1/audio/speech`, {
    method: 'POST',
    headers: speechHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      model,
      voice: process.env.TTS_VOICE || 'af_heart',
      input: text,
      response_format: 'wav',
      speed: clamp(Number(options?.speakingRate ?? 1), 0.5, 2),
    }),
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `Speech service returned ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function synthesizeWithVoiceClone(params: {
  text: string;
  referenceAudioUri: string;
  speakingRate?: number;
  emotion?: string;
}) {
  const endpoint = process.env.VOICE_CLONE_SERVICE_URL?.replace(/\/$/, '');
  if (!endpoint) throw new Error('VOICE_CLONE_SERVICE_URL is not configured.');
  const reference = await downloadPrivateAudioObject(params.referenceAudioUri);
  const form = new FormData();
  form.append('text', params.text);
  form.append('reference', new Blob([new Uint8Array(reference)], { type: 'audio/wav' }), 'caller-reference.wav');
  form.append('consent', 'true');
  form.append('speed', String(clamp(Number(params.speakingRate ?? 1), 0.5, 2)));
  if (params.emotion) form.append('emotion', params.emotion);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`${endpoint}/synthesize`, {
      method: 'POST',
      headers: process.env.VOICE_CLONE_SERVICE_TOKEN
        ? { Authorization: `Bearer ${process.env.VOICE_CLONE_SERVICE_TOKEN}` }
        : undefined,
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(body || `Voice clone service returned ${response.status}.`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

export async function synthesizeCallerPcm(
  text: string,
  languageCode: string,
  options?: {
    family?: string;
    speakingRate?: number;
    pitch?: number;
    emotion?: string;
    voiceClone?: {
      enabled?: boolean;
      consentVerified?: boolean;
      referenceAudioUri?: string;
    };
  },
) {
  const requiresClonedVoice = languageCode === 'cs-CZ' || languageCode === 'cs';
  if (options?.voiceClone?.enabled && options.voiceClone.consentVerified && options.voiceClone.referenceAudioUri) {
    try {
      return pcmDataFromWave(await synthesizeWithVoiceClone({
        text,
        referenceAudioUri: options.voiceClone.referenceAudioUri,
        speakingRate: options.speakingRate,
        emotion: options.emotion,
      }));
    } catch (error) {
      if (requiresClonedVoice) {
        throw new Error('Czech simulated calls require the consented voice clone path, but voice cloning failed.');
      }
      console.warn('Consent-gated voice cloning failed; using the standard open-source voice.', error);
    }
  }
  if (requiresClonedVoice) {
    throw new Error('Czech simulated calls require a consented Czech reference recording for cloned caller speech.');
  }
  const primary = speechModel(process.env.TTS_MODEL || 'kokoro', ttsModelAliases);
  const fallback = speechModel(process.env.TTS_FALLBACK_MODEL || 'piper', ttsModelAliases);
  const models = Array.from(new Set([primary, fallback].filter(Boolean)));
  let lastError: unknown;
  for (const model of models) {
    try {
      return pcmDataFromWave(await synthesizeWithModel(model, text, options));
    } catch (error) {
      lastError = error;
      if (model === models[models.length - 1]) break;
      console.warn(`Speech synthesis with ${model} failed; trying fallback.`, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Text-to-speech returned no audio.');
}

function transcriptionText(body: unknown) {
  if (typeof body === 'string') return body.trim();
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (typeof value.text === 'string') return value.text.trim();
  if (Array.isArray(value.segments)) {
    return value.segments.flatMap((segment) => {
      const row = segment && typeof segment === 'object' ? segment as Record<string, unknown> : {};
      return typeof row.text === 'string' ? [row.text.trim()] : [];
    }).filter(Boolean).join(' ').trim();
  }
  return '';
}

function transcriptionSegments(body: unknown) {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (!Array.isArray(value.segments)) return undefined;
  return value.segments.flatMap((segment) => {
    const row = segment && typeof segment === 'object' ? segment as Record<string, unknown> : {};
    if (typeof row.text !== 'string') return [];
    return [{
      text: row.text.trim(),
      start: typeof row.start === 'number' ? row.start : undefined,
      end: typeof row.end === 'number' ? row.end : undefined,
    }];
  });
}

function transcriptionLanguage(body: unknown) {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return typeof value.language === 'string'
    ? value.language
    : typeof value.detected_language === 'string'
      ? value.detected_language
      : undefined;
}

export async function transcribeAudio(params: {
  bytes?: Buffer;
  uri?: string;
  mimeType?: string;
  filename?: string;
  language?: string;
  quality?: boolean;
  timeoutMs?: number;
}): Promise<SpeechTranscriptionResult> {
  const bytes = params.bytes ?? (params.uri ? await downloadPrivateAudioObject(params.uri) : null);
  if (!bytes) throw new Error('Audio bytes or a private audio URI are required for transcription.');

  const model = speechModel(
    params.quality
      ? process.env.STT_QUALITY_MODEL || 'large-v3-turbo'
      : process.env.STT_MODEL || 'distil-large-v3',
    sttModelAliases,
  );
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: params.mimeType || 'audio/wav' }), params.filename || 'audio.wav');
  form.append('model', model);
  form.append('response_format', 'json');
  if (params.language) form.append('language', params.language);

  const controller = new AbortController();
  const timeout = params.timeoutMs ? setTimeout(() => controller.abort(), params.timeoutMs) : null;
  try {
    const response = await fetch(`${speechEndpoint()}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: speechHeaders(),
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
    const raw = await response.text();
    const parsed = raw.trim().startsWith('{') ? JSON.parse(raw) as unknown : raw;
    if (!response.ok) throw new Error(transcriptionText(parsed) || `Speech service returned ${response.status}.`);
    const text = transcriptionText(parsed);
    if (!text) throw new Error('Speech service returned an empty transcript.');
    return {
      text,
      provider: 'speaches',
      model,
      language: params.language ?? transcriptionLanguage(parsed),
      segments: transcriptionSegments(parsed),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Speech transcription timed out after ${params.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function smokeTestTTS() {
  try {
    const result = await synthesizeCallerPcm('Hello, this is a smoke test.', 'en-US');
    return result.audio.length > 0;
  } catch (error) {
    console.error('TTS smoke test failed:', error);
    return false;
  }
}
