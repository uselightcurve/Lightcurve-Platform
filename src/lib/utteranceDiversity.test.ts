import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity } from '@/lib/utteranceDiversity';

test('cosine similarity detects duplicate and distinct embedding directions', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
});
