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

const baseUrl = process.env.RELEASE_GATE_BASE_URL || process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

if (!baseUrl) {
  console.error('Set RELEASE_GATE_BASE_URL, SMOKE_BASE_URL, or NEXT_PUBLIC_APP_URL before running the release gate.');
  process.exit(1);
}

const url = new URL('/api/release-gate', baseUrl.replace(/\/$/, ''));
if (process.env.RELEASE_GATE_EXPERIMENT_ID) {
  url.searchParams.set('experimentId', process.env.RELEASE_GATE_EXPERIMENT_ID);
}
if (process.env.LIGHTCURVE_GATE_MIN_MOS) {
  url.searchParams.set('minMos', process.env.LIGHTCURVE_GATE_MIN_MOS);
}
if (process.env.LIGHTCURVE_GATE_MIN_TASK) {
  url.searchParams.set('minTask', process.env.LIGHTCURVE_GATE_MIN_TASK);
}

const response = await fetch(url, { headers: { accept: 'application/json' } });
const body = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(`Release gate request failed with ${response.status}`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(`Release gate for ${body.experimentName ?? body.experimentId}`);
console.log(
  `Avg MOS: ${body.metrics?.avgMos?.toFixed?.(2) ?? 'pending'} / min ${body.thresholds?.minMos}; task: ${
    body.metrics?.avgTaskCompletion != null ? `${Math.round(body.metrics.avgTaskCompletion * 100)}%` : 'pending'
  } / min ${Math.round((body.thresholds?.minTask ?? 0.8) * 100)}%`,
);

if (!body.pass) {
  console.error('Release gate did not pass.');
  for (const failure of body.failures ?? []) {
    console.error(`- ${failure.scenarioName ?? failure.runId}: ${(failure.reasons ?? []).join('; ')}`);
  }
  process.exit(1);
}

console.log('Release gate passed.');
