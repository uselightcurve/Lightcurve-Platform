import assert from 'node:assert/strict';
import test from 'node:test';
import { generateJsonWithLightcurveModel, generateWithLightcurveModelResult } from './llm';

const originalFetch = globalThis.fetch;

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  process.env = snapshot;
  globalThis.fetch = originalFetch;
}

test('self-hosted Qwen provider returns parsed JSON without an external API key', async () => {
  const env = { ...process.env };
  process.env.LIGHTCURVE_LLM_PROVIDER = 'qwen';
  delete process.env.LIGHTCURVE_LLM_API_KEY;
  process.env.LIGHTCURVE_LLM_BASE_URL = 'http://qwen:8000';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'lightcurve-reasoner');
    assert.equal(body.response_format.type, 'json_object');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
  };
  try {
    const { result, json } = await generateJsonWithLightcurveModel('lightcurve-reasoner', 'Return JSON.');
    assert.equal(result.provider, 'qwen');
    assert.deepEqual(json, { ok: true });
  } finally {
    restoreEnv(env);
  }
});

test('self-hosted Qwen provider reports failures without throwing from result helper', async () => {
  const env = { ...process.env };
  process.env.LIGHTCURVE_LLM_PROVIDER = 'qwen';
  process.env.LIGHTCURVE_LLM_BASE_URL = 'http://qwen:8000';
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'quota exhausted' } }), { status: 429 });
  try {
    const result = await generateWithLightcurveModelResult('lightcurve-reasoner', 'Judge this.');
    assert.equal(result.text, null);
    assert.equal(result.provider, 'none');
    assert.match(result.error || '', /quota exhausted/);
  } finally {
    restoreEnv(env);
  }
});
