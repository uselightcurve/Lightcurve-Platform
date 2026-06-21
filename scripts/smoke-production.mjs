import { existsSync, readFileSync } from 'node:fs';

function loadDotEnv() {
  if (!existsSync('.env')) return;

  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [key, ...valueParts] = trimmed.split('=');
    if (!key || process.env[key]) continue;

    process.env[key] = valueParts.join('=').replace(/^["']|["']$/g, '');
  }
}

loadDotEnv();

const baseUrl = process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

if (!baseUrl) {
  console.error('Set SMOKE_BASE_URL or NEXT_PUBLIC_APP_URL before running production smoke tests.');
  process.exit(1);
}

const normalizedBaseUrl = baseUrl.replace(/\/$/, '');

async function assertOk(path, check) {
  const url = `${normalizedBaseUrl}${path}`;
  const response = await fetch(url, { headers: { accept: 'application/json,text/html' } });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();

  if (check) {
    check(body);
  }

  console.log(`ok ${path}`);
}

async function assertProtected(path) {
  const url = `${normalizedBaseUrl}${path}`;
  const response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual' });
  if (![302, 303, 307, 308, 401, 403, 404].includes(response.status)) {
    throw new Error(`${path} should require auth, got ${response.status}`);
  }
  console.log(`ok ${path} protected`);
}

async function assertFile(path, minimumBytes) {
  const response = await fetch(`${normalizedBaseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < minimumBytes) throw new Error(`${path} is unexpectedly small.`);
  console.log(`ok ${path}`);
}

try {
  await assertOk('/', (html) => {
    if (typeof html !== 'string' || !html.includes('Lightcurve')) {
      throw new Error('Home page did not render Lightcurve shell.');
    }
  });

  await assertOk('/api/integrations/status', (json) => {
    if (!json || !Array.isArray(json.integrations) || json.media?.telephony !== false || json.media?.hostedRunner !== false || json.integrations[0]?.sdkVersion !== '0.5.0') {
      throw new Error('Integration status response is missing the non-telephony SDK transport.');
    }
  });

  await assertFile('/sdk/use_lightcurve-0.5.0-py3-none-any.whl', 8000);

  await assertProtected('/api/datasets');
  await assertProtected('/api/experiments');

  console.log(`Production smoke test passed for ${normalizedBaseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
