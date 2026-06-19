import type { experiments, scenarios } from '@/db/schema';

type ExperimentRow = typeof experiments.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;

export type VobizPhoneCallResult = {
  provider: 'vobiz';
  id: string;
  status: string;
  runStatus: 'running';
  raw: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name);
  return value;
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.uselightcurve.com').replace(/\/$/, '');
}

function targetAgentNumber(experiment: Pick<ExperimentRow, 'agentConfig'>) {
  const config = asRecord(experiment.agentConfig);
  const target =
    stringValue(config.targetAgentNumber) ??
    stringValue(config.agentPhoneNumber) ??
    stringValue(config.endpoint) ??
    stringValue(config.to);

  if (!target) {
    throw new Error('Enter the phone number or SIP URI your agent answers before starting phone realism.');
  }

  return target;
}

export function isVobizPhoneExperiment(experiment: Pick<ExperimentRow, 'agentConfig'>) {
  const config = asRecord(experiment.agentConfig);
  return stringValue(config.bridge) === 'vobiz_phone' || stringValue(config.mode) === 'vobiz_phone_verification';
}

function extractVobizError(raw: unknown, fallback: string) {
  const body = asRecord(raw);
  return (
    stringValue(body.message) ??
    stringValue(body.error) ??
    stringValue(body.detail) ??
    stringValue(body.error_message) ??
    fallback
  );
}

export async function startVobizPhoneCall(
  runId: string,
  experiment: ExperimentRow,
  scenario: ScenarioRow,
): Promise<VobizPhoneCallResult> {
  let authId: string;
  let authToken: string;
  let fromNumber: string;
  try {
    authId = requiredEnv('VOBIZ_AUTH_ID');
    authToken = requiredEnv('VOBIZ_AUTH_TOKEN');
    fromNumber = requiredEnv('VOBIZ_FROM_NUMBER');
  } catch (error) {
    const missing = error instanceof Error ? error.message : 'VOBIZ_*';
    throw new Error(
      `Phone realism bridge is not configured: ${missing}. Add the platform telephony bridge secrets before running phone realism.`,
    );
  }

  const to = targetAgentNumber(experiment);
  const config = asRecord(experiment.agentConfig);
  const answerUrl = `${appUrl()}/api/telephony/vobiz/answer?runId=${encodeURIComponent(runId)}`;

  const response = await fetch(`https://api.vobiz.ai/api/v1/Account/${encodeURIComponent(authId)}/Call/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken,
    },
    body: JSON.stringify({
      from: fromNumber,
      to,
      answer_url: answerUrl,
      answer_method: 'POST',
      metadata: {
        lightcurve_run_id: runId,
        lightcurve_experiment_id: experiment.id,
        scenario_id: scenario.id,
        scenario_name: scenario.name,
        declared_provider: stringValue(config.declaredProvider) ?? experiment.agentType,
      },
    }),
  });

  const text = await response.text();
  let raw: unknown = text;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = { text };
  }

  if (!response.ok) {
    throw new Error(`Phone realism call start failed: ${extractVobizError(raw, response.statusText)}`);
  }

  const body = asRecord(raw);
  const id =
    stringValue(body.call_uuid) ??
    stringValue(body.callUuid) ??
    stringValue(body.request_uuid) ??
    stringValue(body.call_id) ??
    stringValue(body.id) ??
    runId;

  return {
    provider: 'vobiz',
    id,
    status: stringValue(body.status) ?? 'queued',
    runStatus: 'running',
    raw,
  };
}
