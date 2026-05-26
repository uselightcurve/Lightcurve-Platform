import type { experiments, runs, scenarios } from '@/db/schema';
import type { ProviderId } from '@/lib/integrations';
import { getVapiCall, normalizeVapiCall, startVapiSandboxCall, type NormalizedVapiResult } from '@/lib/vapi';

type ExperimentRow = typeof experiments.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;

export type SandboxStartResult = {
  provider: ProviderId;
  id: string;
  status: string;
  runStatus?: NormalizedVapiResult['runStatus'];
  raw: unknown;
};

type ProviderConfig = Record<string, string>;

const LIVE_PHONE_PROVIDERS = new Set<ProviderId>(['vapi', 'retell', 'elevenlabs']);

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

function getAgentConfig(experiment: ExperimentRow): ProviderConfig {
  return asRecord(experiment.agentConfig) as ProviderConfig;
}

function providerOf(experiment: ExperimentRow): ProviderId {
  return (experiment.agentType as ProviderId) ?? 'custom_webrtc';
}

export function isProviderBackedSandbox(experiment: ExperimentRow) {
  const provider = providerOf(experiment);
  return LIVE_PHONE_PROVIDERS.has(provider);
}

function scenarioVariables(runId: string, experiment: ExperimentRow, scenario: ScenarioRow) {
  const persona = asRecord(scenario.persona);
  const successCriteria = Array.isArray(scenario.successCriteria) ? scenario.successCriteria : [];

  return {
    lightcurve_run_id: runId,
    lightcurve_experiment_id: experiment.id,
    scenario_name: scenario.name,
    scenario_language: scenario.language,
    scenario_domain: scenario.domain ?? '',
    caller_name: stringValue(persona.name) ?? 'Sandbox caller',
    caller_emotion: stringValue(persona.emotional_state) ?? 'neutral',
    caller_goal: stringValue(persona.goal) ?? '',
    caller_opening_line: stringValue(persona.opening_line) ?? '',
    success_criteria: JSON.stringify(successCriteria),
  };
}

function missingConfig(provider: string, entries: Record<string, string | undefined>) {
  const missing = Object.entries(entries)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`Missing ${provider} configuration: ${missing.join(', ')}`);
}

function normalizeSpeaker(role: unknown): 'caller' | 'agent' | null {
  const value = String(role ?? '').toLowerCase().trim();
  if (['user', 'customer', 'caller', 'human', 'client'].includes(value)) return 'caller';
  if (['assistant', 'agent', 'bot', 'ai'].includes(value)) return 'agent';
  return null;
}

function fromTranscriptText(transcript?: string) {
  if (!transcript) return [];
  return transcript
    .split(/\r?\n/)
    .map((line, index) => {
      const [label, ...rest] = line.split(':');
      const speaker = normalizeSpeaker(label);
      const text = rest.join(':').trim();
      if (!speaker || !text) return null;
      return { turnIndex: index, speaker, text };
    })
    .filter(Boolean) as NormalizedVapiResult['traces'];
}

function fromTranscriptArray(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const message = asRecord(item);
      const speaker = normalizeSpeaker(message.role ?? message.speaker ?? message.type);
      const text =
        stringValue(message.content) ??
        stringValue(message.text) ??
        stringValue(message.message) ??
        stringValue(message.transcript);
      if (!speaker || !text) return null;

      const start = numberValue(message.start ?? message.start_time ?? message.time_in_call_secs);
      const end = numberValue(message.end ?? message.end_time);
      const latency = numberValue(message.latencyMs ?? message.latency_ms ?? message.response_latency_ms);

      return {
        turnIndex: index,
        speaker,
        text,
        audioUrl: stringValue(message.audioUrl ?? message.audio_url),
        sttConfidence: numberValue(message.confidence ?? message.stt_confidence),
        totalLatencyMs: latency ?? (start != null && end != null ? Math.max(0, Math.round((end - start) * 1000)) : undefined),
      };
    })
    .filter(Boolean) as NormalizedVapiResult['traces'];
}

function mapRunStatus(status: string): NormalizedVapiResult['runStatus'] {
  const value = status.toLowerCase();
  if (['ended', 'done', 'completed', 'complete', 'successful', 'success'].includes(value)) return 'complete';
  if (['failed', 'failure', 'canceled', 'cancelled', 'not_connected', 'no-answer', 'busy', 'error'].includes(value)) return 'failed';
  if (['processing', 'analyzing', 'evaluating'].includes(value)) return 'evaluating';
  return 'running';
}

function taskFromAnalysis(raw: Record<string, any>) {
  const analysis = asRecord(raw.analysis ?? raw.call_analysis);
  const custom = asRecord(analysis.custom_analysis_data ?? analysis.data_collection_results ?? raw.custom_analysis_data);
  const direct = numberValue(
    custom.taskCompletion ??
      custom.task_completed ??
      custom.task_completion ??
      analysis.taskCompletion ??
      analysis.task_completed ??
      raw.taskCompletion ??
      raw.task_completed,
  );
  if (direct != null) return direct > 1 ? direct / 100 : direct;

  const success = analysis.call_successful ?? analysis.successEvaluation ?? raw.call_successful ?? custom.call_successful;
  if (typeof success === 'boolean') return success ? 0.9 : 0.45;
  if (typeof success === 'string') {
    const value = success.toLowerCase();
    if (['success', 'successful', 'true', 'yes', 'pass', 'passed'].includes(value)) return 0.9;
    if (['failure', 'failed', 'false', 'no', 'fail'].includes(value)) return 0.45;
  }

  return undefined;
}

function mosFromAnalysis(raw: Record<string, any>) {
  const analysis = asRecord(raw.analysis ?? raw.call_analysis);
  const custom = asRecord(analysis.custom_analysis_data ?? analysis.data_collection_results ?? raw.custom_analysis_data);
  return numberValue(custom.mos ?? custom.mean_opinion_score ?? analysis.mos ?? raw.mos);
}

function latencyP95(raw: Record<string, any>, traces: NormalizedVapiResult['traces']) {
  const latency = asRecord(raw.latency);
  const e2e = asRecord(latency.e2e ?? latency.total ?? latency.s2s);
  const direct = numberValue(e2e.p95 ?? raw.latency_p95_ms ?? raw.latencyP95Ms);
  if (direct != null) return direct;

  const latencies = traces
    .map((trace) => trace.totalLatencyMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  return latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : undefined;
}

function estimateMosProxy(raw: Record<string, any>, traces: NormalizedVapiResult['traces']) {
  if (!traces.length) return undefined;

  const confidenceValues = traces
    .map((trace) => trace.sttConfidence)
    .filter((value): value is number => typeof value === 'number');
  const avgConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0.86;
  const p95 = latencyP95(raw, traces);
  const latencyPenalty = p95 != null ? Math.min(0.55, Math.max(0, (p95 - 1200) / 5000)) : 0.1;
  const recordingBonus = stringValue(raw.recording_url ?? raw.recordingUrl ?? raw.audio_url) ? 0.1 : 0;
  return Number(Math.max(3.1, Math.min(4.25, 3.25 + avgConfidence * 0.8 - latencyPenalty + recordingBonus)).toFixed(1));
}

async function mosFromService(audioCallerUrl?: string, audioAgentUrl?: string) {
  if (!process.env.MOS_SERVICE_URL || !audioCallerUrl || !audioAgentUrl) return undefined;
  try {
    const response = await fetch(process.env.MOS_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref_url: audioCallerUrl, deg_url: audioAgentUrl }),
    });
    if (!response.ok) return undefined;
    const body = await response.json().catch(() => ({}));
    return numberValue(asRecord(body).mos);
  } catch (error) {
    console.error('MOS service failed', error);
    return undefined;
  }
}

async function addMosScore(normalized: NormalizedVapiResult, raw: Record<string, any>) {
  if (normalized.scores.some((score) => score.metricName === 'mos')) return normalized;

  const serviceMos = await mosFromService(normalized.audioCallerUrl, normalized.audioAgentUrl);
  if (serviceMos != null) {
    normalized.scores.push({
      metricName: 'mos',
      value: serviceMos,
      method: 'pesq-service',
      rationale: 'Computed by configured MOS service from sandbox call audio.',
    });
    return normalized;
  }

  const proxyMos = normalized.runStatus === 'complete' ? estimateMosProxy(raw, normalized.traces) : undefined;
  if (proxyMos != null) {
    normalized.scores.push({
      metricName: 'mos',
      value: proxyMos,
      method: 'lightcurve-mos-proxy',
      rationale: 'Estimated from transcript confidence, recording availability, and latency until a MOS audio service is configured.',
    });
  }

  return normalized;
}

async function startRetellCall(runId: string, experiment: ExperimentRow, scenario: ScenarioRow): Promise<SandboxStartResult> {
  const agentConfig = getAgentConfig(experiment);
  const apiKey = stringValue(agentConfig.apiKey) ?? stringValue(process.env.RETELL_API_KEY);
  const agentId = stringValue(agentConfig.agentId) ?? stringValue(process.env.RETELL_AGENT_ID);
  const fromNumber = stringValue(agentConfig.fromNumber) ?? stringValue(process.env.RETELL_FROM_NUMBER);
  const customerNumber = stringValue(agentConfig.customerNumber) ?? stringValue(process.env.RETELL_TEST_CUSTOMER_NUMBER);
  const apiBase = stringValue(process.env.RETELL_API_BASE) ?? 'https://api.retellai.com';
  missingConfig('Retell', { RETELL_API_KEY: apiKey, RETELL_AGENT_ID: agentId, RETELL_FROM_NUMBER: fromNumber, test_customer_phone_number: customerNumber });

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/v2/create-phone-call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from_number: fromNumber,
      to_number: customerNumber,
      override_agent_id: agentId,
      metadata: {
        lightcurve_run_id: runId,
        lightcurve_experiment_id: experiment.id,
        scenario_id: scenario.id,
      },
      retell_llm_dynamic_variables: scenarioVariables(runId, experiment, scenario),
    }),
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(asRecord(raw).message) ?? stringValue(asRecord(raw).error) ?? response.statusText;
    throw new Error(`Retell call start failed: ${message}`);
  }

  const id = stringValue(asRecord(raw).call_id ?? asRecord(raw).callId ?? asRecord(raw).id);
  if (!id) throw new Error('Retell call start did not return a call id.');

  return { provider: 'retell', id, status: stringValue(asRecord(raw).call_status) ?? 'registered', raw };
}

async function getRetellCall(experiment: ExperimentRow, callId: string) {
  const agentConfig = getAgentConfig(experiment);
  const apiKey = stringValue(agentConfig.apiKey) ?? stringValue(process.env.RETELL_API_KEY);
  const apiBase = stringValue(process.env.RETELL_API_BASE) ?? 'https://api.retellai.com';
  missingConfig('Retell', { RETELL_API_KEY: apiKey });

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/v2/get-call/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(asRecord(raw).message) ?? stringValue(asRecord(raw).error) ?? response.statusText;
    throw new Error(`Retell call fetch failed: ${message}`);
  }
  return raw;
}

async function startElevenLabsCall(runId: string, experiment: ExperimentRow, scenario: ScenarioRow): Promise<SandboxStartResult> {
  const agentConfig = getAgentConfig(experiment);
  const costMode = stringValue(agentConfig.costMode) ?? stringValue(process.env.ELEVENLABS_COST_MODE);
  if (costMode === 'recording_replay') {
    return {
      provider: 'elevenlabs',
      id: `elevenlabs-replay-${runId}`,
      status: 'awaiting_recording_import',
      runStatus: 'running',
      raw: { mode: 'recording_replay' },
    };
  }

  const apiKey = stringValue(agentConfig.apiKey) ?? stringValue(process.env.ELEVENLABS_API_KEY);
  const agentId = stringValue(agentConfig.agentId) ?? stringValue(process.env.ELEVENLABS_AGENT_ID);
  const agentPhoneNumberId =
    stringValue(agentConfig.agentPhoneNumberId) ?? stringValue(process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID);
  const customerNumber = stringValue(agentConfig.customerNumber) ?? stringValue(process.env.ELEVENLABS_TEST_CUSTOMER_NUMBER);
  const apiBase = stringValue(process.env.ELEVENLABS_API_BASE) ?? 'https://api.elevenlabs.io';
  missingConfig('ElevenLabs', {
    ELEVENLABS_API_KEY: apiKey,
    ELEVENLABS_AGENT_ID: agentId,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: agentPhoneNumberId,
    test_customer_phone_number: customerNumber,
  });

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/v1/convai/twilio/outbound-call`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: agentPhoneNumberId,
      to_number: customerNumber,
      call_recording_enabled: true,
      conversation_initiation_client_data: {
        dynamic_variables: scenarioVariables(runId, experiment, scenario),
      },
    }),
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(asRecord(raw).message) ?? stringValue(asRecord(raw).detail) ?? response.statusText;
    throw new Error(`ElevenLabs call start failed: ${message}`);
  }

  const id = stringValue(asRecord(raw).conversation_id ?? asRecord(raw).conversationId ?? asRecord(raw).callSid);
  if (!id) throw new Error('ElevenLabs call start did not return a conversation id.');

  return { provider: 'elevenlabs', id, status: stringValue(asRecord(raw).message) ?? 'initiated', raw };
}

async function getElevenLabsConversation(experiment: ExperimentRow, conversationId: string) {
  const agentConfig = getAgentConfig(experiment);
  const apiKey = stringValue(agentConfig.apiKey) ?? stringValue(process.env.ELEVENLABS_API_KEY);
  const apiBase = stringValue(process.env.ELEVENLABS_API_BASE) ?? 'https://api.elevenlabs.io';
  missingConfig('ElevenLabs', { ELEVENLABS_API_KEY: apiKey });

  const response = await fetch(`${apiBase.replace(/\/$/, '')}/v1/convai/conversations/${conversationId}`, {
    headers: { 'xi-api-key': apiKey!, Accept: 'application/json' },
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(asRecord(raw).message) ?? stringValue(asRecord(raw).detail) ?? response.statusText;
    throw new Error(`ElevenLabs conversation fetch failed: ${message}`);
  }
  return raw;
}

async function startCustomRunner(runId: string, experiment: ExperimentRow, scenario: ScenarioRow): Promise<SandboxStartResult> {
  const agentConfig = getAgentConfig(experiment);
  const runnerUrl = stringValue(agentConfig.runnerUrl) ?? stringValue(process.env.CUSTOM_AGENT_RUNNER_URL);
  missingConfig('Custom runner', { CUSTOM_AGENT_RUNNER_URL: runnerUrl });

  const response = await fetch(runnerUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(stringValue(agentConfig.authToken) ? { Authorization: `Bearer ${agentConfig.authToken}` } : {}),
    },
    body: JSON.stringify({
      runId,
      experimentId: experiment.id,
      provider: experiment.agentType,
      scenario,
      agentConfig,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/runs/${runId}/import-recording`,
    }),
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = stringValue(asRecord(raw).message) ?? stringValue(asRecord(raw).error) ?? response.statusText;
    throw new Error(`Custom sandbox runner failed: ${message}`);
  }

  const id = stringValue(asRecord(raw).id ?? asRecord(raw).runId ?? asRecord(raw).externalCallId) ?? runId;
  return { provider: providerOf(experiment), id, status: stringValue(asRecord(raw).status) ?? 'runner_started', raw };
}

function normalizeRetellCall(rawCall: unknown): NormalizedVapiResult {
  const call = asRecord(rawCall);
  const status = stringValue(call.call_status ?? call.status) ?? 'unknown';
  const traces = fromTranscriptArray(call.transcript_object ?? call.transcript_with_tool_calls).length
    ? fromTranscriptArray(call.transcript_object ?? call.transcript_with_tool_calls)
    : fromTranscriptText(stringValue(call.transcript));
  const taskCompletion = taskFromAnalysis(call);
  const mos = mosFromAnalysis(call);
  const p95 = latencyP95(call, traces);
  const runStatus = mapRunStatus(status);
  const analysis = asRecord(call.call_analysis);
  const failureSummary =
    stringValue(call.disconnection_reason) ??
    stringValue(analysis.call_summary) ??
    (runStatus === 'failed' ? 'Retell call failed before Lightcurve could score it.' : undefined);

  const scores: NormalizedVapiResult['scores'] = [];
  if (mos != null) scores.push({ metricName: 'mos', value: mos, method: 'retell-analysis', rationale: 'Imported from Retell custom analysis data.' });
  if (taskCompletion != null) {
    scores.push({
      metricName: 'task_completed',
      value: taskCompletion,
      method: 'retell-analysis',
      rationale: 'Derived from Retell call analysis.',
    });
  }
  if (p95 != null) scores.push({ metricName: 'latency_p95', value: p95, method: 'retell-latency', rationale: 'Computed from Retell latency metrics.' });

  return {
    runStatus: runStatus === 'complete' && traces.length === 0 ? 'failed' : runStatus,
    externalStatus: status,
    traces,
    scores,
    audioCallerUrl: stringValue(call.recording_multi_channel_url ?? call.recording_url ?? call.scrubbed_recording_url),
    audioAgentUrl: stringValue(call.recording_url ?? call.recording_multi_channel_url ?? call.scrubbed_recording_url),
    durationMs: numberValue(call.duration_ms ?? call.durationMs),
    endedAt: numberValue(call.end_timestamp) ? new Date(numberValue(call.end_timestamp)!) : undefined,
    failureSummary: traces.length === 0 && runStatus === 'complete' ? 'No transcript was captured from Retell for this call.' : failureSummary,
  };
}

function normalizeElevenLabsConversation(rawCall: unknown): NormalizedVapiResult {
  const call = asRecord(rawCall);
  const status = stringValue(call.status) ?? 'unknown';
  const traces = fromTranscriptArray(call.transcript);
  const metadata = asRecord(call.metadata);
  const taskCompletion = taskFromAnalysis(call);
  const mos = mosFromAnalysis(call);
  const p95 = latencyP95(call, traces);
  const runStatus = mapRunStatus(status);
  const analysis = asRecord(call.analysis);

  const scores: NormalizedVapiResult['scores'] = [];
  if (mos != null) scores.push({ metricName: 'mos', value: mos, method: 'elevenlabs-analysis', rationale: 'Imported from ElevenLabs conversation analysis.' });
  if (taskCompletion != null) {
    scores.push({
      metricName: 'task_completed',
      value: taskCompletion,
      method: 'elevenlabs-analysis',
      rationale: 'Derived from ElevenLabs conversation success analysis.',
    });
  }
  if (p95 != null) scores.push({ metricName: 'latency_p95', value: p95, method: 'elevenlabs-transcript', rationale: 'Computed from ElevenLabs transcript timing.' });

  const startedAtSeconds = numberValue(metadata.start_time_unix_secs);
  const durationSeconds = numberValue(metadata.call_duration_secs ?? call.call_duration_secs);

  return {
    runStatus: runStatus === 'complete' && traces.length === 0 ? 'failed' : runStatus,
    externalStatus: status,
    traces,
    scores,
    audioCallerUrl: call.has_audio ? `${process.env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io'}/v1/convai/conversations/${call.conversation_id}/audio` : undefined,
    audioAgentUrl: call.has_audio ? `${process.env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io'}/v1/convai/conversations/${call.conversation_id}/audio` : undefined,
    durationMs: durationSeconds != null ? Math.round(durationSeconds * 1000) : undefined,
    endedAt: startedAtSeconds != null && durationSeconds != null ? new Date((startedAtSeconds + durationSeconds) * 1000) : undefined,
    failureSummary:
      stringValue(call.termination_reason) ??
      stringValue(analysis.transcript_summary) ??
      (traces.length === 0 && runStatus === 'complete' ? 'No transcript was captured from ElevenLabs for this conversation.' : undefined),
  };
}

export async function startProviderSandboxCall(
  runId: string,
  experiment: ExperimentRow,
  scenario: ScenarioRow,
): Promise<SandboxStartResult> {
  const provider = providerOf(experiment);
  if (provider === 'vapi') {
    const call = await startVapiSandboxCall(runId, experiment, scenario);
    return { provider, id: call.id, status: call.status ?? 'created', raw: call.raw } satisfies SandboxStartResult;
  }
  if (provider === 'retell') return startRetellCall(runId, experiment, scenario);
  if (provider === 'elevenlabs') return startElevenLabsCall(runId, experiment, scenario);
  return startCustomRunner(runId, experiment, scenario);
}

export async function pollProviderSandboxCall(experiment: ExperimentRow, run: RunRow, scenario?: ScenarioRow) {
  const provider = (run.provider as ProviderId | null) ?? providerOf(experiment);
  if (!run.externalCallId) throw new Error('Run does not have an external call id yet.');

  if (provider === 'vapi') {
    const call = await getVapiCall(experiment, run.externalCallId);
    return addMosScore(normalizeVapiCall(call, scenario), asRecord(call));
  }
  if (provider === 'retell') {
    const call = await getRetellCall(experiment, run.externalCallId);
    return addMosScore(normalizeRetellCall(call), asRecord(call));
  }
  if (provider === 'elevenlabs') {
    if (run.externalStatus === 'awaiting_recording_import') {
      return {
        runStatus: 'running',
        externalStatus: 'awaiting_recording_import',
        traces: [],
        scores: [],
        failureSummary: 'Waiting for an imported ElevenLabs recording or transcript.',
      } satisfies NormalizedVapiResult;
    }
    const call = await getElevenLabsConversation(experiment, run.externalCallId);
    return addMosScore(normalizeElevenLabsConversation(call), asRecord(call));
  }

  return {
    runStatus: 'running',
    externalStatus: run.externalStatus ?? 'runner_waiting_for_import',
    traces: [],
    scores: [],
    failureSummary: 'Waiting for the custom runner to POST transcript/audio to Lightcurve.',
  } satisfies NormalizedVapiResult;
}

export function normalizeImportedRecording(input: unknown): NormalizedVapiResult {
  const body = asRecord(input);
  const traces =
    fromTranscriptArray(body.turns ?? body.transcriptTurns ?? body.messages).length
      ? fromTranscriptArray(body.turns ?? body.transcriptTurns ?? body.messages)
      : fromTranscriptText(stringValue(body.transcript));
  const audioUrl = stringValue(body.audioUrl ?? body.recordingUrl ?? body.recording_url);
  const callerAudioUrl = stringValue(body.callerAudioUrl ?? body.audioCallerUrl) ?? audioUrl;
  const agentAudioUrl = stringValue(body.agentAudioUrl ?? body.audioAgentUrl) ?? audioUrl;
  const taskCompletion = numberValue(body.taskCompletion ?? body.task_completed);
  const mos = numberValue(body.mos);
  const latency = numberValue(body.latencyP95Ms ?? body.latency_p95_ms);
  const scores: NormalizedVapiResult['scores'] = [];

  if (mos != null) scores.push({ metricName: 'mos', value: mos, method: 'imported-recording', rationale: 'Provided with imported call recording.' });
  if (taskCompletion != null) {
    scores.push({
      metricName: 'task_completed',
      value: taskCompletion > 1 ? taskCompletion / 100 : taskCompletion,
      method: 'imported-recording',
      rationale: 'Provided with imported call transcript.',
    });
  }
  if (latency != null) scores.push({ metricName: 'latency_p95', value: latency, method: 'imported-recording', rationale: 'Provided with imported call metadata.' });

  return {
    runStatus: traces.length || audioUrl ? 'complete' : 'failed',
    externalStatus: traces.length || audioUrl ? 'imported' : 'import_failed',
    traces,
    scores,
    audioCallerUrl: callerAudioUrl,
    audioAgentUrl: agentAudioUrl,
    durationMs: numberValue(body.durationMs ?? body.duration_ms),
    endedAt: new Date(),
    failureSummary: traces.length || audioUrl ? stringValue(body.failureSummary) : 'Import needs a transcript, turns, or recording URL.',
  };
}

export async function finalizeImportedRecording(input: unknown) {
  const normalized = normalizeImportedRecording(input);
  return addMosScore(normalized, asRecord(input));
}
