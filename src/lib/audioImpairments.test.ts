import assert from 'node:assert/strict';
import test from 'node:test';
import { applyServerImpairments } from './audioImpairments';
import { getImpairmentProfile } from './replayCompiler';

const cleanAudio = Buffer.alloc(3200);
for (let index = 0; index < cleanAudio.length; index += 2) cleanAudio.writeInt16LE(Math.round(Math.sin(index / 30) * 12000), index);

test('clean profile preserves PCM exactly', () => {
  assert.deepEqual(applyServerImpairments(cleanAudio, 16000, getImpairmentProfile('clean'), 42), cleanAudio);
});

test('impairments are deterministic and change the signal', () => {
  const profile = getImpairmentProfile('compound_stress');
  const first = applyServerImpairments(cleanAudio, 16000, profile, 99);
  const second = applyServerImpairments(cleanAudio, 16000, profile, 99);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, cleanAudio);
});
