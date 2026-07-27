import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

async function source(file: string) {
  return readFile(path.join(process.cwd(), file), 'utf8');
}

test('replay generation uses self-hosted speech and Qwen defaults', async () => {
  const route = await source('src/app/api/sdk/replays/[id]/turn/route.ts');
  assert.match(route, /@\/lib\/speech/);
  assert.match(route, /lightcurve-reasoner/);
  assert.doesNotMatch(route, /@\/lib\/gcp/);
  assert.doesNotMatch(route, /gemini-2\./);
});

test('dataset upload transcribes locally before LLM graph extraction', async () => {
  const route = await source('src/app/api/datasets/upload/route.ts');
  assert.match(route, /transcribeAudio/);
  assert.match(route, /generateWithLightcurveModelResult/);
  assert.doesNotMatch(route, /generateMultimodalWithLightcurveModelResult/);
  assert.doesNotMatch(route, /Gemini output/);
});

test('completed replay scoring stores an Evaluate review automatically', async () => {
  const scoring = await source('src/lib/replayScoring.ts');
  const backend = await source('src/lib/modelOrbitBackend.ts');
  const api = await source('src/app/api/evaluate/route.ts');

  assert.match(scoring, /evaluateStoredConversation/);
  assert.match(backend, /conversationEvaluations/);
  assert.match(backend, /sourceHash/);
  assert.match(api, /evaluateStoredConversation/);
});
