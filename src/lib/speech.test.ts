import assert from 'node:assert/strict';
import test from 'node:test';
import { synthesizeCallerPcm, transcribeAudio } from './speech';

const originalFetch = globalThis.fetch;

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  process.env = snapshot;
  globalThis.fetch = originalFetch;
}

function tinyWave() {
  const data = Buffer.from([0, 0, 1, 0, 255, 255, 0, 0]);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(16000 * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('speech synthesis calls Speaches and returns PCM data', async () => {
  const env = { ...process.env };
  process.env.SPEECH_SERVICE_URL = 'http://speech.test:8000';
  process.env.TTS_MODEL = 'kokoro';
  process.env.TTS_VOICE = 'af_heart';
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://speech.test:8000/v1/audio/speech');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'speaches-ai/Kokoro-82M-v1.0-ONNX');
    assert.equal(body.voice, 'af_heart');
    assert.equal(body.response_format, 'wav');
    return new Response(new Uint8Array(tinyWave()), { status: 200 });
  };
  try {
    const result = await synthesizeCallerPcm('hello', 'en-US', { speakingRate: 1.25 });
    assert.equal(result.sampleRate, 16000);
    assert.equal(result.channels, 1);
    assert.equal(result.audio.length, 8);
  } finally {
    restoreEnv(env);
  }
});

test('speech transcription posts audio to Speaches', async () => {
  const env = { ...process.env };
  process.env.SPEECH_SERVICE_URL = 'http://speech.test:8000';
  process.env.STT_MODEL = 'distil-large-v3';
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'http://speech.test:8000/v1/audio/transcriptions');
    assert.equal(init?.method, 'POST');
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get('task'), 'transcribe');
    assert.equal(init.body.get('response_format'), 'verbose_json');
    return new Response(JSON.stringify({ text: 'नमस्ते', language: 'hi' }), { status: 200 });
  };
  try {
    const result = await transcribeAudio({
      bytes: Buffer.from('fake-audio'),
      mimeType: 'audio/wav',
      filename: 'call.wav',
      language: 'en',
    });
    assert.equal(result.provider, 'speaches');
    assert.equal(result.model, 'Systran/faster-distil-whisper-large-v3');
    assert.equal(result.text, 'नमस्ते');
    assert.equal(result.language, 'hi');
  } finally {
    restoreEnv(env);
  }
});
