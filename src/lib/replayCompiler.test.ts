import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateReplayCounts, compileReplayManifests, normalizeReplayConfig } from './replayCompiler';

const cases = [
  {
    id: 'case-low', name: 'Low risk', language: 'en-US', domain: 'support', riskWeight: 1,
    behaviorGraph: { observedPath: [{ id: 'a', speaker: 'human' }], pressurePoints: [] },
  },
  {
    id: 'case-high', name: 'High risk', language: 'en-US', domain: 'billing', riskWeight: 5,
    behaviorGraph: { observedPath: [{ id: 'b', speaker: 'human' }], pressurePoints: ['payment', 'escalation'] },
  },
];

test('Release preset compiles 100 deterministic unique manifests', () => {
  const first = compileReplayManifests(cases, { preset: 'release', seed: 77 });
  const second = compileReplayManifests(cases, { preset: 'release', seed: 77 });
  assert.equal(first.manifests.length, 100);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.manifests.map((item) => item.uniquenessSignature)).size, 100);
  assert.equal(first.manifests.filter((item) => item.environment === 'clean').length, 20);
  assert.ok(first.manifests.every((item) => item.graphPath.every((node) => ['a', 'b'].includes(node))));
});

test('risk-weighted allocation gives more coverage to higher-risk cases', () => {
  const allocation = allocateReplayCounts(cases, 100, 42);
  assert.ok((allocation.get('case-high') ?? 0) > (allocation.get('case-low') ?? 0));
  assert.equal([...allocation.values()].reduce((sum, value) => sum + value, 0), 100);
});

test('requested replay count never excludes an approved case', () => {
  const result = compileReplayManifests(cases, { replayCount: 1 });
  assert.equal(result.manifests.length, 2);
  assert.deepEqual(new Set(result.manifests.map((item) => item.caseId)), new Set(['case-low', 'case-high']));
});

test('config clamps unsafe concurrency and replay values', () => {
  const config = normalizeReplayConfig({ replayCount: 99_999, maxConcurrency: 999 });
  assert.equal(config.replayCount, 5000);
  assert.equal(config.maxConcurrency, 200);
});

test('Case policy prevents disallowed environments without changing graph paths', () => {
  const result = compileReplayManifests([{ ...cases[0], variationPolicy: { environmentProfiles: ['clean', 'latency_jitter'] } }], { replayCount: 30, seed: 9 });
  assert.ok(result.manifests.every((manifest) => ['clean', 'latency_jitter'].includes(manifest.environment)));
  assert.ok(result.manifests.every((manifest) => manifest.graphPath.every((node) => node === 'a')));
});
