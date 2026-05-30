import type { experiments, scenarios } from '@/db/schema';
import { scorePronunciationCapture, type PronunciationSpec } from './pronunciation';

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

type NormalizeVapiOptions = {
  speakerMode?: 'default' | 'lightcurve-caller';
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

function normalizePhone(value: string | undefined) {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 8 ? digits : undefined;
}

function looksLikePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 8 && /^[+\d\s().-]+$/.test(value.trim());
}

function looksLikeUuid(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function compactJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readableErrorValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(readableErrorValue).filter(Boolean);
    return parts.length ? parts.join('; ') : undefined;
  }

  const record = asRecord(value);
  const direct =
    readableErrorValue(record.message) ??
    readableErrorValue(record.error) ??
    readableErrorValue(record.detail) ??
    readableErrorValue(record.details) ??
    readableErrorValue(record.errors) ??
    readableErrorValue(record.issues);
  if (direct) return direct;

  const entries = Object.entries(record)
    .map(([key, item]) => {
      const message = readableErrorValue(item);
      return message ? `${key}: ${message}` : undefined;
    })
    .filter(Boolean);
  if (entries.length) return entries.join('; ');

  const message = compactJson(value);
  return message && message !== '{}' ? message : undefined;
}

function readableVapiError(raw: unknown, fallback: string) {
  const record = asRecord(raw);
  const candidates = [
    record.message,
    record.error,
    record.errors,
    record.details,
    record.detail,
  ].filter((value) => value !== undefined && value !== null);

  for (const candidate of candidates) {
    const message = readableErrorValue(candidate);
    if (message) return message;
  }

  const rawMessage = readableErrorValue(raw);
  if (rawMessage) return `${fallback}: ${rawMessage}`;
  return fallback;
}

function getAgentConfig(experiment: ExperimentRow): Record<string, string> {
  return asRecord(experiment.agentConfig) as Record<string, string>;
}

function useInternalProviderCredentials(experiment: ExperimentRow) {
  const agentConfig = getAgentConfig(experiment);
  return agentConfig.useInternalProvider === 'true' && process.env.LIGHTCURVE_ALLOW_INTERNAL_PROVIDER_RUNS === '1';
}

function internalValue(experiment: ExperimentRow, name: string) {
  if (!useInternalProviderCredentials(experiment)) return undefined;
  return stringValue(process.env[`LIGHTCURVE_INTERNAL_${name}`]);
}

function missingCustomerConfig(provider: string, entries: Record<string, string | undefined>) {
  const missing = Object.entries(entries)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (!missing.length) return;
  throw new Error(
    `${provider} customer configuration is missing: ${missing.join(', ')}. Connect your ${provider} account or enter the values for this run. Lightcurve does not use a platform-owned provider account for customer sandboxes.`,
  );
}

function vapiScenarioVariables(runId: string, experiment: ExperimentRow, scenario: ScenarioRow) {
  const persona = asRecord(scenario.persona);
  const successCriteria = Array.isArray(scenario.successCriteria) ? scenario.successCriteria : [];

  return {
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
  };
}

export function getVapiConfig(experiment: ExperimentRow): VapiConfig {
  const agentConfig = getAgentConfig(experiment);
  const apiKey = stringValue(agentConfig.apiKey) ?? internalValue(experiment, 'VAPI_API_KEY');
  const assistantId = stringValue(agentConfig.assistantId) ?? internalValue(experiment, 'VAPI_ASSISTANT_ID');
  const phoneNumberId = stringValue(agentConfig.phoneNumberId) ?? internalValue(experiment, 'VAPI_PHONE_NUMBER_ID');
  const customerNumber = stringValue(agentConfig.customerNumber) ?? internalValue(experiment, 'VAPI_TEST_CUSTOMER_NUMBER');
  const apiBase = stringValue(process.env.VAPI_API_BASE) ?? 'https://api.vapi.ai';

  missingCustomerConfig('Vapi', {
    'API key': apiKey,
    'assistant ID': assistantId,
    'caller phone-number ID': phoneNumberId,
    'consented tester phone number': customerNumber,
  });
  if (!apiKey || !assistantId || !phoneNumberId || !customerNumber) throw new Error('Missing Vapi customer configuration.');

  return { apiKey, assistantId, phoneNumberId, customerNumber, apiBase };
}

function getVapiBotToBotConfig(experiment: ExperimentRow) {
  const agentConfig = getAgentConfig(experiment);
  const apiKey = stringValue(agentConfig.apiKey) ?? internalValue(experiment, 'VAPI_API_KEY');
  const phoneNumberId = stringValue(agentConfig.phoneNumberId) ?? internalValue(experiment, 'VAPI_PHONE_NUMBER_ID');
  const targetAgentNumber = stringValue(agentConfig.targetAgentNumber) ?? internalValue(experiment, 'VAPI_TARGET_AGENT_NUMBER');
  const callerAssistantId = stringValue(agentConfig.callerAssistantId);
  const callerPhoneNumber = stringValue(agentConfig.callerPhoneNumber) ?? internalValue(experiment, 'VAPI_CALLER_PHONE_NUMBER');
  const apiBase = stringValue(process.env.VAPI_API_BASE) ?? 'https://api.vapi.ai';

  missingCustomerConfig('Vapi bot-to-bot', {
    'API key': apiKey,
    'outbound caller phone-number UUID': phoneNumberId,
    'target agent phone number or SIP URI': targetAgentNumber,
  });
  if (!apiKey || !phoneNumberId || !targetAgentNumber) throw new Error('Missing Vapi bot-to-bot customer configuration.');

  if (!looksLikeUuid(phoneNumberId)) {
    throw new Error('Vapi outbound caller phone-number UUID must look like a UUID from Vapi Phone Numbers. Do not paste the formatted +1 number here.');
  }

  if (looksLikePhoneNumber(phoneNumberId)) {
    throw new Error('Vapi outbound caller phone-number UUID must be the UUID from Vapi Phone Numbers, not the formatted +1 caller number.');
  }

  if (!targetAgentNumber.toLowerCase().startsWith('sip:') && !looksLikePhoneNumber(targetAgentNumber)) {
    throw new Error('Target agent must be the inbound phone number your voice agent answers in E.164 format, like +14155550123, or a SIP URI.');
  }

  if (normalizePhone(targetAgentNumber) && normalizePhone(targetAgentNumber) === normalizePhone(callerPhoneNumber)) {
    throw new Error('Your agent phone number cannot be the outbound caller number. Enter the inbound number your agent answers, and use a different Vapi Phone Number UUID for the caller.');
  }

  if (callerAssistantId && !looksLikeUuid(callerAssistantId)) {
    throw new Error('Synthetic caller assistant ID must be a Vapi assistant UUID. Leave it blank unless you created a dedicated caller assistant in Vapi.');
  }

  if (callerAssistantId && callerAssistantId === stringValue(agentConfig.assistantId)) {
    throw new Error('Synthetic caller assistant ID must be a dedicated caller assistant, not your customer-facing agent assistant. Leave it blank so Lightcurve can generate the caller from the selected scenario.');
  }

  return { apiKey, phoneNumberId, targetAgentNumber, callerAssistantId, callerPhoneNumber, apiBase };
}

function buildCallerAssistant(runId: string, experiment: ExperimentRow, scenario: ScenarioRow) {
  const persona = asRecord(scenario.persona);
  const successCriteria = Array.isArray(scenario.successCriteria) ? scenario.successCriteria : [];
  const openingLine =
    stringValue(persona.opening_line) ??
    stringValue(persona.goal) ??
    `I need help with ${scenario.name.replace(/_/g, ' ')}.`;
  const callerName = stringValue(persona.name) ?? 'Lightcurve caller';
  const emotion = stringValue(persona.emotional_state) ?? 'neutral';
  const goal = stringValue(persona.goal) ?? 'complete the scenario goal';
  const voiceProvider = stringValue(process.env.VAPI_CALLER_VOICE_PROVIDER);
  const voiceId = stringValue(process.env.VAPI_CALLER_VOICE_ID);
  const maxDurationSeconds = numberValue(process.env.VAPI_BOT_TO_BOT_MAX_DURATION_SECONDS) ?? 180;

  return {
    name: `Lightcurve caller - ${scenario.name}`,
    firstMessage: openingLine,
    firstMessageMode: 'assistant-speaks-first',
    backgroundSound: 'off',
    recordingEnabled: true,
    endCallMessage: 'Thanks. I have what I need.',
    silenceTimeoutSeconds: 12,
    maxDurationSeconds,
    ...(voiceProvider && voiceId ? { voice: { provider: voiceProvider, voiceId } } : {}),
    model: {
      provider: stringValue(process.env.VAPI_CALLER_MODEL_PROVIDER) ?? 'openai',
      model: stringValue(process.env.VAPI_CALLER_MODEL) ?? 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: [
            `You are ${callerName}, a synthetic caller in a Lightcurve pre-production voice AI test.`,
            `Language: ${scenario.language}.`,
            `Emotion: ${emotion}.`,
            `Goal: ${goal}.`,
            `Success criteria: ${JSON.stringify(successCriteria)}.`,
            'Speak like a real caller, not like an evaluator.',
            'Keep each response under 25 words.',
            'Do not reveal that you are synthetic unless directly asked.',
            `Metadata: run ${runId}, experiment ${experiment.id}.`,
          ].join('\n'),
        },
      ],
    },
  };
}

export async function startVapiSandboxCall(runId: string, experiment: ExperimentRow, scenario: ScenarioRow) {
  const config = getVapiConfig(experiment);

  const payload = {
    assistantId: config.assistantId,
    phoneNumberId: config.phoneNumberId,
    customer: {
      number: config.customerNumber,
    },
    assistantOverrides: {
      backgroundSound: 'off',
      variableValues: vapiScenarioVariables(runId, experiment, scenario),
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
    const message = readableVapiError(raw, response.statusText);
    console.error('Vapi sandbox call start failed', { status: response.status, message });
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

export async function startVapiBotToBotPhoneCall(runId: string, experiment: ExperimentRow, scenario: ScenarioRow) {
  const config = getVapiBotToBotConfig(experiment);
  const payload: Record<string, unknown> = {
    phoneNumberId: config.phoneNumberId,
    customer: {
      number: config.targetAgentNumber,
    },
    metadata: {
      lightcurve_run_id: runId,
      lightcurve_experiment_id: experiment.id,
      lightcurve_mode: 'bot_to_bot_phone',
      scenario_id: scenario.id,
      scenario_name: scenario.name,
    },
  };

  if (config.callerAssistantId) {
    payload.assistantId = config.callerAssistantId;
    payload.assistantOverrides = {
      backgroundSound: 'off',
      variableValues: vapiScenarioVariables(runId, experiment, scenario),
    };
  } else {
    payload.assistant = buildCallerAssistant(runId, experiment, scenario);
  }

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
    const message = readableVapiError(raw, response.statusText);
    console.error('Vapi bot-to-bot call start failed', { status: response.status, message });
    throw new Error(
      `Vapi bot-to-bot call start failed: ${message}. Check that the outbound caller phone-number UUID belongs to this Vapi API key, outbound calling is enabled, and the target agent number is the number your agent answers.`,
    );
  }

  const id = stringValue(asRecord(raw).id) ?? stringValue(asRecord(raw).callId);
  if (!id) {
    throw new Error('Vapi bot-to-bot call start did not return a call id.');
  }

  return {
    id,
    status: stringValue(asRecord(raw).status),
    raw,
  } satisfies VapiStartResult;
}

export async function getVapiCall(experiment: ExperimentRow, callId: string) {
  const agentConfig = getAgentConfig(experiment);
  const apiKey = stringValue(agentConfig.apiKey) ?? internalValue(experiment, 'VAPI_API_KEY');
  const apiBase = stringValue(process.env.VAPI_API_BASE) ?? 'https://api.vapi.ai';
  if (!apiKey) {
    throw new Error('Missing Vapi customer API key for polling this call.');
  }

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/call/${callId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = readableVapiError(raw, response.statusText);
    console.error('Vapi call fetch failed', { status: response.status, message });
    throw new Error(`Vapi call fetch failed: ${message}`);
  }

  return raw;
}

function normalizeSpeaker(role: unknown): 'caller' | 'agent' | null {
  const value = String(role ?? '').toLowerCase();
  if (['user', 'customer', 'caller', 'human'].includes(value)) return 'caller';
  if (['assistant', 'agent', 'bot', 'ai'].includes(value)) return 'agent';
  return null;
}

function mapSpeakerForMode(speaker: 'caller' | 'agent', options?: NormalizeVapiOptions) {
  if (options?.speakerMode !== 'lightcurve-caller') return speaker;
  return speaker === 'agent' ? 'caller' : 'agent';
}

function extractMessages(call: Record<string, any>, options?: NormalizeVapiOptions) {
  const artifact = asRecord(call.artifact);
  const analysis = asRecord(call.analysis);
  const candidates = [
    artifact.messages,
    artifact.messagesOpenAIFormatted,
    artifact.transcriptMessages,
    artifact.conversation,
    call.messages,
    call.messagesOpenAIFormatted,
    call.transcriptMessages,
    analysis.messages,
    analysis.transcriptMessages,
    analysis.conversation,
  ];
  const messages = candidates.find(Array.isArray) as any[] | undefined;

  if (messages?.length) {
    return messages
      .map((message, index) => {
        const speaker = normalizeSpeaker(message.role ?? message.speaker ?? message.type);
        const content = Array.isArray(message.content)
          ? message.content
              .map((part: any) => stringValue(part?.text) ?? stringValue(part?.content))
              .filter(Boolean)
              .join(' ')
          : undefined;
        const text =
          stringValue(message.message) ??
          stringValue(message.text) ??
          stringValue(message.content) ??
          content ??
          stringValue(message.transcript);
        if (!speaker || !text) return null;

        return {
          turnIndex: index,
          speaker: mapSpeakerForMode(speaker, options),
          text,
          audioUrl: stringValue(message.audioUrl),
          sttConfidence: numberValue(message.confidence ?? message.sttConfidence),
          totalLatencyMs: numberValue(message.latencyMs ?? message.totalLatencyMs ?? message.responseLatencyMs),
        };
      })
      .filter(Boolean) as NormalizedVapiResult['traces'];
  }

  const transcript = stringValue(call.transcript ?? artifact.transcript ?? analysis.transcript);
  if (!transcript) return [];

  return transcript
    .split(/\r?\n/)
    .map((line, index) => {
      const [speakerLabel, ...textParts] = line.split(':');
      const speaker = normalizeSpeaker(speakerLabel);
      const text = textParts.join(':').trim();
      if (!speaker || !text) return null;
      return { turnIndex: index, speaker: mapSpeakerForMode(speaker, options), text };
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

function providerEndReason(call: Record<string, any>) {
  const analysis = asRecord(call.analysis);
  return (
    stringValue(call.endedReason) ??
    stringValue(call.endReason) ??
    stringValue(call.ended_reason) ??
    stringValue(call.error) ??
    stringValue(analysis.error) ??
    stringValue(analysis.endedReason)
  );
}

export function normalizeVapiCall(rawCall: unknown, scenario?: ScenarioRow, options?: NormalizeVapiOptions): NormalizedVapiResult {
  const call = asRecord(rawCall);
  const endReason = providerEndReason(call);
  const status = stringValue(call.status) ?? endReason ?? 'unknown';
  const traces = extractMessages(call, options);
  const latencies = traces
    .map((trace) => trace.totalLatencyMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : undefined;
  const taskCompletion = extractTaskCompletion(call);
  const mos = extractMos(call);
  const analysis = asRecord(call.analysis);
  const failureSummary =
    endReason ??
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

  const pronunciation = asRecord(scenario).pronunciation as PronunciationSpec | undefined;
  if (pronunciation?.targetValue) {
    const pronunciationScores = scorePronunciationCapture(pronunciation, traces).map((score) => ({
      ...score,
      method: 'lightcurve-capture-judge',
    }));
    scores.push(...pronunciationScores);
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
  const emptyTranscriptBase =
    options?.speakerMode === 'lightcurve-caller'
      ? 'No transcript was captured. The bot-to-bot phone call ended without usable caller/agent turns. Check that the target agent number answered and spoke.'
      : 'No transcript was captured. The Vapi call ended without caller/agent turns, usually because the tester stayed silent or the assistant did not hear usable speech.';
  const emptyTranscriptSummary = endReason ? `${emptyTranscriptBase} Vapi ended reason: ${endReason}.` : emptyTranscriptBase;

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
    externalStatus: endReason && status !== endReason ? `${status}: ${endReason}` : status,
    traces,
    scores,
    audioCallerUrl: stringValue(call.stereoRecordingUrl ?? call.recordingUrl ?? asRecord(call.artifact).recordingUrl),
    audioAgentUrl: stringValue(call.recordingUrl ?? call.stereoRecordingUrl ?? asRecord(call.artifact).recordingUrl),
    durationMs,
    endedAt: endedAt ? new Date(endedAt) : undefined,
    failureSummary: traces.length === 0 ? emptyTranscriptSummary : failureSummary,
  };
}
