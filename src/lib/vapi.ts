import type { experiments, scenarios } from '@/db/schema';

type ExperimentRow = typeof experiments.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;

export type VapiStartResult = {
  id: string;
  status?: string;
  raw: unknown;
};

export type NormalizedVapiResult = {
  runStatus: 'running' | 'evaluating' | 'complete' | 'failed';
  externalStatus: string;
  traces: Array<{
    turnIndex: number;
    speaker: 'caller' | 'agent';
    text: string;
    audioUrl?: string;
    sttConfidence?: number;
    totalLatencyMs?: number;
  }>;
  scores: Array<{
    metricName: string;
    value: number;
    method: string;
    rationale: string;
  }>;
  audioCallerUrl?: string;
  audioAgentUrl?: string;
  durationMs?: number;
  endedAt?: Date;
  failureSummary?: string;
};

type VapiConfig = {
  apiKey: string;
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
  apiBase: string;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function getAgentConfig(experiment: ExperimentRow): Record<string, string> {
  return asRecord(experiment.agentConfig) as Record<string, string>;
}

export function getVapiConfig(experiment: ExperimentRow): VapiConfig {
  const agentConfig = getAgentConfig(experiment);
  const apiKey = stringValue(agentConfig.apiKey) ?? stringValue(process.env.VAPI_API_KEY);
  const assistantId = stringValue(agentConfig.assistantId) ?? stringValue(process.env.VAPI_ASSISTANT_ID);
  const phoneNumberId = stringValue(agentConfig.phoneNumberId) ?? stringValue(process.env.VAPI_PHONE_NUMBER_ID);
  const customerNumber = stringValue(agentConfig.customerNumber) ?? stringValue(process.env.VAPI_TEST_CUSTOMER_NUMBER);
  const apiBase = stringValue(process.env.VAPI_API_BASE) ?? 'https://api.vapi.ai';

  const missing = [
    !apiKey && 'VAPI_API_KEY',
    !assistantId && 'VAPI_ASSISTANT_ID',
    !phoneNumberId && 'VAPI_PHONE_NUMBER_ID',
    !customerNumber && 'test customer phone number',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Missing Vapi configuration: ${missing.join(', ')}`);
  }

  if (!apiKey || !assistantId || !phoneNumberId || !customerNumber) {
    throw new Error('Missing Vapi configuration.');
  }

  return { apiKey, assistantId, phoneNumberId, customerNumber, apiBase };
}

export async function startVapiSandboxCall(runId: string, experiment: ExperimentRow, scenario: ScenarioRow) {
  const config = getVapiConfig(experiment);
  const persona = asRecord(scenario.persona);
  const successCriteria = Array.isArray(scenario.successCriteria) ? scenario.successCriteria : [];

  const payload = {
    assistantId: config.assistantId,
    phoneNumberId: config.phoneNumberId,
    customer: {
      number: config.customerNumber,
    },
    assistantOverrides: {
      variableValues: {
        lightcurve_run_id: runId,
        lightcurve_experiment_id: experiment.id,
        scenario_name: scenario.name,
        scenario_language: scenario.language,
        scenario_domain: scenario.domain ?? '',
        caller_name: stringValue(persona.name) ?? 'Synthetic caller',
        caller_emotion: stringValue(persona.emotional_state) ?? 'neutral',
        caller_goal: stringValue(persona.goal) ?? '',
        caller_opening_line: stringValue(persona.opening_line) ?? '',
        success_criteria: JSON.stringify(successCriteria),
      },
    },
  };

  const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(asRecord(raw).message) ?? stringValue(asRecord(raw).error) ?? response.statusText;
    throw new Error(`Vapi call start failed: ${message}`);
  }

  const id = stringValue(asRecord(raw).id) ?? stringValue(asRecord(raw).callId);
  if (!id) {
    throw new Error('Vapi call start did not return a call id.');
  }

  return {
    id,
    status: stringValue(asRecord(raw).status),
    raw,
  } satisfies VapiStartResult;
}

export async function getVapiCall(experiment: ExperimentRow, callId: string) {
  const config = getVapiConfig(experiment);
  const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/call/${callId}`, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
    },
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(asRecord(raw).message) ?? stringValue(asRecord(raw).error) ?? response.statusText;
    throw new Error(`Vapi call fetch failed: ${message}`);
  }

  return raw;
}

function normalizeSpeaker(role: unknown): 'caller' | 'agent' | null {
  const value = String(role ?? '').toLowerCase();
  if (['user', 'customer', 'caller', 'human'].includes(value)) return 'caller';
  if (['assistant', 'agent', 'bot', 'system'].includes(value)) return value === 'system' ? null : 'agent';
  return null;
}

function extractMessages(call: Record<string, any>) {
  const artifact = asRecord(call.artifact);
  const candidates = [
    artifact.messages,
    call.messages,
    call.transcriptMessages,
    asRecord(call.analysis).messages,
  ];
  const messages = candidates.find(Array.isArray) as any[] | undefined;

  if (messages?.length) {
    return messages
      .map((message, index) => {
        const speaker = normalizeSpeaker(message.role ?? message.speaker ?? message.type);
        const text =
          stringValue(message.message) ??
          stringValue(message.text) ??
          stringValue(message.content) ??
          stringValue(message.transcript);
        if (!speaker || !text) return null;

        return {
          turnIndex: index,
          speaker,
          text,
          audioUrl: stringValue(message.audioUrl),
          sttConfidence: numberValue(message.confidence ?? message.sttConfidence),
          totalLatencyMs: numberValue(message.latencyMs ?? message.totalLatencyMs ?? message.responseLatencyMs),
        };
      })
      .filter(Boolean) as NormalizedVapiResult['traces'];
  }

  const transcript = stringValue(call.transcript ?? artifact.transcript ?? asRecord(call.analysis).transcript);
  if (!transcript) return [];

  return transcript
    .split(/\r?\n/)
    .map((line, index) => {
      const [speakerLabel, ...textParts] = line.split(':');
      const speaker = normalizeSpeaker(speakerLabel);
      const text = textParts.join(':').trim();
      if (!speaker || !text) return null;
      return { turnIndex: index, speaker, text };
    })
    .filter(Boolean) as NormalizedVapiResult['traces'];
}

function mapRunStatus(status: string): NormalizedVapiResult['runStatus'] {
  const value = status.toLowerCase();
  if (['ended', 'completed', 'complete', 'successful', 'success'].includes(value)) return 'complete';
  if (['failed', 'canceled', 'cancelled', 'no-answer', 'busy', 'error'].includes(value)) return 'failed';
  if (['queued', 'ringing', 'in-progress', 'in_progress', 'started', 'scheduled'].includes(value)) return 'running';
  return 'running';
}

function extractTaskCompletion(call: Record<string, any>) {
  const analysis = asRecord(call.analysis);
  const structuredData = asRecord(analysis.structuredData ?? call.structuredData);
  const directScore = numberValue(
    structuredData.taskCompletion ??
      structuredData.task_completed ??
      structuredData.task_completion ??
      analysis.taskCompletion ??
      call.taskCompletion,
  );
  if (directScore != null) return directScore > 1 ? directScore / 100 : directScore;

  const success = analysis.successEvaluation ?? structuredData.success ?? call.successEvaluation;
  if (typeof success === 'boolean') return success ? 0.9 : 0.45;
  if (typeof success === 'string') {
    const value = success.toLowerCase();
    if (['true', 'pass', 'passed', 'success', 'successful', 'yes'].includes(value)) return 0.9;
    if (['false', 'fail', 'failed', 'no'].includes(value)) return 0.45;
  }

  return undefined;
}

function extractMos(call: Record<string, any>) {
  const analysis = asRecord(call.analysis);
  const structuredData = asRecord(analysis.structuredData ?? call.structuredData);
  return numberValue(structuredData.mos ?? analysis.mos ?? call.mos);
}

export function normalizeVapiCall(rawCall: unknown, scenario?: ScenarioRow): NormalizedVapiResult {
  const call = asRecord(rawCall);
  const status = stringValue(call.status) ?? stringValue(call.endedReason) ?? 'unknown';
  const traces = extractMessages(call);
  const latencies = traces
    .map((trace) => trace.totalLatencyMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : undefined;
  const taskCompletion = extractTaskCompletion(call);
  const mos = extractMos(call);
  const analysis = asRecord(call.analysis);
  const failureSummary =
    stringValue(call.endedReason) ??
    stringValue(analysis.summary) ??
    (scenario ? `Review ${scenario.name} for sandbox release readiness.` : undefined);

  const scores: NormalizedVapiResult['scores'] = [];
  if (mos != null) {
    scores.push({
      metricName: 'mos',
      value: mos,
      method: 'vapi-analysis',
      rationale: 'Imported from Vapi call analysis.',
    });
  }
  if (taskCompletion != null) {
    scores.push({
      metricName: 'task_completed',
      value: taskCompletion,
      method: 'vapi-analysis',
      rationale: stringValue(analysis.successEvaluation) ?? 'Derived from Vapi success evaluation.',
    });
  }
  if (p95 != null) {
    scores.push({
      metricName: 'latency_p95',
      value: p95,
      method: 'vapi-messages',
      rationale: 'Computed from imported Vapi message latencies.',
    });
  }

  const durationSeconds = numberValue(call.durationSeconds ?? call.duration ?? asRecord(call.artifact).durationSeconds);
  const startedAt = stringValue(call.startedAt ?? call.createdAt);
  const endedAt = stringValue(call.endedAt ?? call.updatedAt);
  const durationMs =
    durationSeconds != null
      ? Math.round(durationSeconds * 1000)
      : startedAt && endedAt
        ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
        : undefined;

  const mappedStatus = mapRunStatus(status);
  const runStatus =
    mappedStatus === 'complete' && traces.length === 0
      ? 'failed'
      : mappedStatus;
  const emptyTranscriptSummary =
    'No transcript was captured. The Vapi call ended without caller/agent turns, usually because the tester stayed silent or the assistant did not hear usable speech.';

  if (runStatus === 'failed' && traces.length === 0 && taskCompletion == null) {
    scores.push({
      metricName: 'task_completed',
      value: 0,
      method: 'lightcurve-vapi-import',
      rationale: emptyTranscriptSummary,
    });
  }

  return {
    runStatus,
    externalStatus: status,
    traces,
    scores,
    audioCallerUrl: stringValue(call.stereoRecordingUrl ?? call.recordingUrl ?? asRecord(call.artifact).recordingUrl),
    audioAgentUrl: stringValue(call.recordingUrl ?? call.stereoRecordingUrl ?? asRecord(call.artifact).recordingUrl),
    durationMs,
    endedAt: endedAt ? new Date(endedAt) : undefined,
    failureSummary: traces.length === 0 ? emptyTranscriptSummary : failureSummary,
  };
}
