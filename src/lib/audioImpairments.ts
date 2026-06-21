import type { ImpairmentProfile } from '@/lib/replayCompiler';

function randomGenerator(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(1664525, value) + 1013904223 >>> 0;
    return value / 4294967296;
  };
}

function clamp16(value: number) {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

export function wavePcm16(wave: Buffer) {
  const marker = wave.indexOf(Buffer.from('data'));
  if (marker < 0 || marker + 8 > wave.length) throw new Error('Noise asset is not a PCM WAV file.');
  const size = wave.readUInt32LE(marker + 4);
  return wave.subarray(marker + 8, Math.min(wave.length, marker + 8 + size));
}

export function applyServerImpairments(audio: Buffer, sampleRate: number, profile: ImpairmentProfile, seed: number, noisePcm?: Buffer) {
  if (profile.id === 'clean') return Buffer.from(audio);
  const samples = new Int16Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength));
  const output = new Int16Array(samples.length);
  const random = randomGenerator(seed);
  const gain = Math.pow(10, Number(profile.server.gainDb ?? 0) / 20);
  const signalRms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length));
  const noiseRms = profile.server.snrDb == null ? 0 : signalRms / Math.pow(10, profile.server.snrDb / 20);
  const noiseSamples = noisePcm?.length ? new Int16Array(noisePcm.buffer.slice(noisePcm.byteOffset, noisePcm.byteOffset + noisePcm.byteLength)) : null;
  const sourceNoiseRms = noiseSamples?.length ? Math.sqrt(noiseSamples.reduce((sum, sample) => sum + sample * sample, 0) / noiseSamples.length) : 0;
  const bandwidth = profile.server.bandwidthHz ?? sampleRate / 2;
  const smoothing = bandwidth < sampleRate / 2 ? Math.max(1, Math.round(sampleRate / Math.max(500, bandwidth))) : 1;
  const reverbDelay = Math.max(1, Math.round(sampleRate * 0.055));
  const reverb = Math.max(0, Math.min(0.8, profile.server.reverb ?? 0));
  const clipping = Math.max(0, Math.min(0.5, profile.server.clipping ?? 0));
  const clipAt = 32767 * (1 - clipping);
  let pink = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const start = Math.max(0, index - smoothing + 1);
    let filtered = 0;
    for (let cursor = start; cursor <= index; cursor += 1) filtered += samples[cursor];
    filtered /= index - start + 1;
    const white = (random() * 2 - 1) * noiseRms;
    pink = pink * 0.92 + white * 0.08;
    const recordedNoise = noiseSamples?.length && sourceNoiseRms ? noiseSamples[index % noiseSamples.length] * noiseRms / sourceNoiseRms : 0;
    const noise = profile.server.noiseCategory ? (noiseSamples?.length ? recordedNoise : white * 0.55 + pink * 0.45) : 0;
    const echo = index >= reverbDelay ? output[index - reverbDelay] * reverb : 0;
    const mixed = Math.max(-clipAt, Math.min(clipAt, filtered * gain + noise + echo));
    output[index] = clamp16(mixed);
  }
  return Buffer.from(output.buffer);
}

export function pcm16ToWave(audio: Buffer, sampleRate: number, channels = 1) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + audio.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}
