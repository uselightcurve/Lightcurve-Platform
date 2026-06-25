import fs from 'node:fs/promises';

const [inputPath, outputPath, secondsArg = '60'] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('Usage: node scripts/normalize-noise-wav.mjs input.wav output.wav [seconds]');
const source = await fs.readFile(inputPath);
if (source.toString('ascii', 0, 4) !== 'RIFF' || source.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Input is not a RIFF/WAVE file.');
let offset = 12;
let format = null;
let data = null;
while (offset + 8 <= source.length) {
  const id = source.toString('ascii', offset, offset + 4);
  const size = source.readUInt32LE(offset + 4);
  const start = offset + 8;
  if (id === 'fmt ') format = source.subarray(start, start + size);
  if (id === 'data') data = source.subarray(start, start + size);
  offset = start + size + (size % 2);
}
if (!format || !data) throw new Error('WAV format or data chunk is missing.');
const audioFormat = format.readUInt16LE(0);
const channels = format.readUInt16LE(2);
const sourceRate = format.readUInt32LE(4);
const bits = format.readUInt16LE(14);
if (audioFormat !== 1 || bits !== 16 || channels < 1) throw new Error(`Only 16-bit PCM WAV is supported; received format=${audioFormat}, bits=${bits}, channels=${channels}.`);
const frames = Math.floor(data.length / (channels * 2));
const mono = new Float64Array(frames);
for (let frame = 0; frame < frames; frame += 1) {
  let sum = 0;
  for (let channel = 0; channel < channels; channel += 1) sum += data.readInt16LE((frame * channels + channel) * 2);
  mono[frame] = sum / channels;
}
const targetRate = 16000;
const targetFrames = Math.min(Math.floor(Number(secondsArg) * targetRate), Math.floor(frames * targetRate / sourceRate));
const pcm = Buffer.alloc(targetFrames * 2);
for (let frame = 0; frame < targetFrames; frame += 1) {
  const position = frame * sourceRate / targetRate;
  const left = Math.min(frames - 1, Math.floor(position));
  const right = Math.min(frames - 1, left + 1);
  const fraction = position - left;
  const value = Math.max(-32768, Math.min(32767, Math.round(mono[left] * (1 - fraction) + mono[right] * fraction)));
  pcm.writeInt16LE(value, frame * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(targetRate, 24); header.writeUInt32LE(targetRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
await fs.writeFile(outputPath, Buffer.concat([header, pcm]));
console.log(JSON.stringify({ inputPath, outputPath, sourceRate, channels, frames, targetRate, targetFrames }));
