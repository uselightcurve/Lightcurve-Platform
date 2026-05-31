import { DEMO_TRANSCRIPT } from './demoData';
import { demoRuns } from './uiDemoData';
import type { ProviderId } from './integrations';
import { REAL_SCENARIO_LIBRARY, mergeWithRealScenarioLibrary } from './realScenarioLibrary';
import {
  scorePronunciationCapture,
  spokenFormForValue,
  type PronunciationSpec,
} from './pronunciation';

export type StoredScenario = {
  id: string;
  name: string;
  language: string;
  domain: string;
  persona: {
    name: string;
    age: number;
    accent: string;
    emotional_state: string;
    goal: string;
    noise_db: number;
    speed_wpm: number;
    interrupts: boolean;
    opening_line: string;
    code_switching?: boolean;
  };
  successCriteria: Array<{ type: string; description: string; weight: number }>;
  callerSeed: number;
  isPreset: boolean;
  parentName?: string;
  source?: {
    provider?: string;
    dataset?: string;
    externalCallId?: string;
    promptRecommendation?: string;
  };
  pronunciation?: PronunciationSpec;
};

export type StoredScore = {
  metricName:
    | 'mos'
    | 'task_completed'
    | 'latency_p95'
    | 'pass_rate'
    | 'stt_confidence'
    | 'capture_exact_match'
    | 'capture_confirmation'
    | 'capture_integrity'
    | 'capture_correction'
    | 'pace_stability'
    | 'capture_overall';
  value: number;
  rationale: string;
};

export type StoredTrace = {
  id: string;
  speaker: 'caller' | 'agent';
  text: string;
  latencyMs: number;
  sttConfidence?: number;
};

export type StoredRun = {
  id: string;
  experimentId: string;
  scenarioId: string;
  scenarioName: string;
  language: string;
  domain: string;
  emotion: string;
  agent: string;
  status: 'pass' | 'fail' | 'running' | 'pending';
  mos: number;
  task: number;
  duration: string;
  durationMs: number;
  latencyP95: number;
  sttConfidence: number;
  date: string;
  transcript: string;
  traces: StoredTrace[];
  scores: StoredScore[];
  recommendation: string;
};

export type StoredExperiment = {
  id: string;
  name: string;
  version: string;
  agentType: ProviderId;
  agentConfig: Record<string, string>;
  scenarios: number;
  mos: number;
  task: number;
  latencyP95: number;
  passRate: number;
  date: string;
  gitSha: string;
  status: 'pass' | 'fail' | 'running' | 'pending';
  reason: string;
  runIds: string[];
};

export type StoredAgent = {
  agentType: ProviderId;
  label: string;
  locator: string;
  apiKey?: string;
  updatedAt: string;
};

export type BillingPlanId = 'starter' | 'pro' | 'scale';

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  audience: string;
  priceLabel: string;
  monthlyCents: number;
  minutesLimit: number | null;
  actionsLimit: number | null;
  features: string[];
};

export type StoredInvoice = {
  id: string;
  date: string;
  planId: BillingPlanId;
  planName: string;
  amountCents: number;
  status: 'paid' | 'open';
};

export type BillingSummary = {
  plan: BillingPlan;
  minutesUsed: number;
  minutesRemaining: number | null;
  minutesPercent: number;
  actionsUsed: number;
  actionsRemaining: number | null;
  actionsPercent: number;
  invoiceAmountCents: number;
  paymentMethod: string | null;
  invoices: StoredInvoice[];
};

const STORE_KEY = 'lightcurve.workspace.v1';

export const BILLING_PLANS: BillingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    audience: 'Free version',
    priceLabel: '$0/mo',
    monthlyCents: 0,
    minutesLimit: 30,
    actionsLimit: 10000,
    features: ['30 tested minutes', '10,000 eval actions', 'Local CI/CD report'],
  },
  {
    id: 'pro',
    name: 'Pro',
    audience: 'Growing teams',
    priceLabel: '$99/mo',
    monthlyCents: 9900,
    minutesLimit: 2000,
    actionsLimit: 250000,
    features: ['2,000 sandbox minutes', '250,000 eval actions', 'Production call imports'],
  },
  {
    id: 'scale',
    name: 'Scale',
    audience: 'Enterprise clients',
    priceLabel: 'Custom',
    monthlyCents: 0,
    minutesLimit: null,
    actionsLimit: null,
    features: ['Unlimited sandbox minutes', 'Unlimited eval actions', 'SLA and priority support'],
  },
];

type WorkspaceState = {
  scenarios: StoredScenario[];
  runs: StoredRun[];
  experiments: StoredExperiment[];
  agent: StoredAgent | null;
  thresholds: {
    mos: number;
    task: number;
  };
  billing: {
    planId: BillingPlanId;
    paymentMethod: string | null;
    invoices: StoredInvoice[];
  };
};

const defaultState: WorkspaceState = {
  scenarios: REAL_SCENARIO_LIBRARY as StoredScenario[],
  runs: [],
  experiments: [],
  agent: null,
  thresholds: {
    mos: 3.8,
    task: 0.8,
  },
  billing: {
    planId: 'starter',
    paymentMethod: null,
    invoices: [
      { id: 'INV-2026-05', date: 'May 24, 2026', planId: 'starter', planName: 'Starter', amountCents: 0, status: 'paid' },
      { id: 'INV-2026-04', date: 'Apr 24, 2026', planId: 'starter', planName: 'Starter', amountCents: 0, status: 'paid' },
    ],
  },
};

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function cloneState(state: WorkspaceState): WorkspaceState {
  return JSON.parse(JSON.stringify(state));
}

function readState(): WorkspaceState {
  if (!canUseStorage()) return cloneState(defaultState);

  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return cloneState(defaultState);
    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    const parsedPlanId = parsed.billing?.planId;
    const planId = BILLING_PLANS.some((plan) => plan.id === parsedPlanId) ? parsedPlanId as BillingPlanId : defaultState.billing.planId;

    return {
      scenarios: mergeWithRealScenarioLibrary(parsed.scenarios as StoredScenario[] | undefined) as StoredScenario[],
      runs: parsed.runs ?? [],
      experiments: parsed.experiments ?? [],
      agent: parsed.agent ?? null,
      thresholds: parsed.thresholds ?? defaultState.thresholds,
      billing: {
        planId,
        paymentMethod: parsed.billing?.paymentMethod ?? defaultState.billing.paymentMethod,
        invoices: parsed.billing?.invoices?.length ? parsed.billing.invoices : defaultState.billing.invoices,
      },
    };
  } catch {
    return cloneState(defaultState);
  }
}

function writeState(state: WorkspaceState) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('lightcurve-workspace-updated'));
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function displayDate(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function activePlan(planId: BillingPlanId) {
  return BILLING_PLANS.find((plan) => plan.id === planId) ?? BILLING_PLANS[0];
}

function billingUsage(state: WorkspaceState) {
  const minutesUsed = Number((state.runs.reduce((sum, run) => sum + run.durationMs, 0) / 60000).toFixed(1));
  const actionsUsed = state.runs.length;
  return { minutesUsed, actionsUsed };
}

function percentUsed(used: number, limit: number | null) {
  if (limit === null) return 0;
  return limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

export function formatBillingAmount(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function scenarioQuality(scenario: StoredScenario, index = 0) {
  const pressure = scenario.persona.interrupts ? 0.1 : 0;
  const emotionPenalty = ['angry', 'urgent', 'frustrated', 'confused', 'nervous'].includes(scenario.persona.emotional_state)
    ? 0.08
    : 0;
  const languagePenalty = scenario.language === 'hi-IN' ? 0.12 : scenario.language === 'es-ES' ? 0.06 : 0;
  const noisePenalty = (scenario.persona.noise_db ?? 0) / 100;
  const seedNoise = ((scenario.callerSeed ?? 42) % 9) / 100;
  const baseTask = 0.91 - pressure - emotionPenalty - languagePenalty - noisePenalty - seedNoise + index * 0.01;
  const task = clamp(Number(baseTask.toFixed(2)), 0.48, 0.94);
  const mos = clamp(Number((3.15 + task * 1.08 - noisePenalty * 2.2).toFixed(1)), 3.1, 4.4);
  const latencyP95 = Math.round(920 + (1 - task) * 1700 + (scenario.persona.noise_db ?? 0) * 45);
  const durationMs = Math.round(112000 + (scenario.persona.speed_wpm ?? 140) * 280 + (scenario.persona.interrupts ? 28000 : 0));
  const sttConfidence = clamp(Number((0.96 - noisePenalty * 1.7 - languagePenalty * 0.35).toFixed(2)), 0.72, 0.97);

  return {
    mos,
    task,
    latencyP95,
    durationMs,
    sttConfidence,
    status: task >= 0.8 && mos >= 3.8 ? 'pass' as const : 'fail' as const,
  };
}

function durationText(durationMs: number) {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function recommendationFor(scenario: StoredScenario, task: number) {
  if (scenario.pronunciation) {
    return task >= 0.8
      ? 'The agent captured and read back the value correctly with stable pacing.'
      : 'Force a slow readback, ask for confirmation, and keep the agent from moving on until the value is exact.';
  }

  if (task >= 0.8) {
    return 'Keep this prompt path. The agent resolved the caller goal with acceptable tone and timing.';
  }

  if (scenario.persona.code_switching) {
    return 'Mirror the caller code-switching, confirm price first, then explain the plan in one short step.';
  }

  if (scenario.persona.emotional_state === 'angry' || scenario.persona.emotional_state === 'frustrated') {
    return 'Acknowledge the caller impact before policy details, then offer a concrete escalation path.';
  }

  if (scenario.domain === 'healthcare') {
    return 'Escalate urgent symptoms safely before trying to complete scheduling.';
  }

  return 'Ask one clarifying question, state the next action, and avoid vague hold language.';
}

function makeTraces(scenario: StoredScenario, quality: ReturnType<typeof scenarioQuality>): StoredTrace[] {
  if (scenario.pronunciation) {
    const spec = scenario.pronunciation;
    const spoken = spec.spokenForms[0] ?? spokenFormForValue(spec.entityType, spec.targetValue, spec.mode);
    const slowReadback =
      spec.entityType === 'email'
        ? spec.targetValue.replace(/@/g, ' at ').replace(/\./g, ' dot ').replace(/\+/g, ' plus ').replace(/-/g, ' dash ').replace(/_/g, ' underscore ')
        : spokenFormForValue(spec.entityType, spec.targetValue, 'grouped');
    const firstAgentLatency = spec.pace === 'fast' ? 820 : spec.pace === 'slow' ? 1380 : 1040;
    const readbackLatency = spec.pace === 'fast' ? 980 : spec.pace === 'slow' ? 1740 : 1320;
    const turns: StoredTrace[] = [
      {
        id: makeId('trace'),
        speaker: 'caller',
        text: scenario.persona.opening_line,
        latencyMs: 0,
        sttConfidence: quality.sttConfidence,
      },
      {
        id: makeId('trace'),
        speaker: 'agent',
        text: `I heard ${spec.targetValue}. I will read it back slowly before I save it.`,
        latencyMs: firstAgentLatency,
      },
    ];

    if (spec.mode === 'correction') {
      turns.push({
        id: makeId('trace'),
        speaker: 'caller',
        text: spec.correctionLine ?? `Actually, correction. It is ${spoken}.`,
        latencyMs: 0,
        sttConfidence: quality.sttConfidence - 0.01,
      });
    }

    turns.push(
      {
        id: makeId('trace'),
        speaker: 'agent',
        text: `Confirming ${spec.entityType === 'email' ? 'email' : 'phone number'}: ${spec.targetValue}. Spoken back as ${slowReadback}. Is that correct?`,
        latencyMs: readbackLatency,
      },
      {
        id: makeId('trace'),
        speaker: 'caller',
        text: 'Yes, that is correct.',
        latencyMs: 0,
        sttConfidence: quality.sttConfidence,
      },
      {
        id: makeId('trace'),
        speaker: 'agent',
        text: 'Confirmed. I will save the exact value and continue the call.',
        latencyMs: 860,
      },
    );

    return turns;
  }

  const opening = scenario.persona.opening_line || DEMO_TRANSCRIPT[0].text;
  const resolution =
    quality.status === 'pass'
      ? `I can help. I will handle ${scenario.persona.goal.toLowerCase()} and confirm the next step before we finish.`
      : 'I need to check that. Please hold while I look into the account details.';
  const followUp =
    quality.status === 'pass'
      ? 'That is the answer I needed. Please summarize what happens next.'
      : 'That is not enough. I need a clear answer right now.';
  const close =
    quality.status === 'pass'
      ? 'You are set. I have logged the action and will send a confirmation.'
      : 'I am still checking. I cannot confirm that yet.';

  return [
    {
      id: makeId('trace'),
      speaker: 'caller',
      text: opening,
      latencyMs: 0,
      sttConfidence: quality.sttConfidence,
    },
    {
      id: makeId('trace'),
      speaker: 'agent',
      text: resolution,
      latencyMs: Math.max(620, quality.latencyP95 - 360),
    },
    {
      id: makeId('trace'),
      speaker: 'caller',
      text: followUp,
      latencyMs: 0,
      sttConfidence: quality.sttConfidence - 0.02,
    },
    {
      id: makeId('trace'),
      speaker: 'agent',
      text: close,
      latencyMs: quality.latencyP95,
    },
  ];
}

function makeRun(params: {
  experimentId: string;
  scenario: StoredScenario;
  agent: string;
  index?: number;
}): StoredRun {
  const quality = scenarioQuality(params.scenario, params.index ?? 0);
  const traces = makeTraces(params.scenario, quality);
  const pronunciationScores = params.scenario.pronunciation
    ? scorePronunciationCapture(params.scenario.pronunciation, traces)
    : [];
  const captureOverall = pronunciationScores.find((score) => score.metricName === 'capture_overall')?.value;
  const taskScore = captureOverall ?? quality.task;
  const status = taskScore >= 0.8 && quality.mos >= 3.8 ? 'pass' as const : 'fail' as const;
  const recommendation = recommendationFor(params.scenario, taskScore);

  return {
    id: makeId('run'),
    experimentId: params.experimentId,
    scenarioId: params.scenario.id,
    scenarioName: params.scenario.name,
    language: params.scenario.language,
    domain: params.scenario.domain,
    emotion: params.scenario.persona.emotional_state,
    agent: params.agent,
    status,
    mos: quality.mos,
    task: taskScore,
    duration: durationText(quality.durationMs),
    durationMs: quality.durationMs,
    latencyP95: quality.latencyP95,
    sttConfidence: quality.sttConfidence,
    date: displayDate(),
    transcript: traces.map((trace) => trace.text).join(' '),
    traces,
    recommendation,
    scores: [
      {
        metricName: 'mos',
        value: quality.mos,
        rationale: 'Estimated MOS from simulated dual-channel call audio conditions.',
      },
      {
        metricName: 'task_completed',
        value: taskScore,
        rationale: status === 'pass' ? 'Caller goal reached.' : recommendation,
      },
      {
        metricName: 'latency_p95',
        value: quality.latencyP95,
        rationale: 'p95 latency across agent turns.',
      },
      {
        metricName: 'stt_confidence',
        value: quality.sttConfidence,
        rationale: 'Average STT confidence across caller turns.',
      },
      ...pronunciationScores,
    ],
  };
}

export function getScenarios() {
  return readState().scenarios;
}

export function saveScenario(scenario: StoredScenario) {
  const state = readState();
  const exists = state.scenarios.some((item) => item.id === scenario.id);
  state.scenarios = exists
    ? state.scenarios.map((item) => (item.id === scenario.id ? scenario : item))
    : [scenario, ...state.scenarios];
  writeState(state);
  return scenario;
}

export function getAgent() {
  return readState().agent;
}

export function saveAgent(agent: StoredAgent) {
  const state = readState();
  state.agent = agent;
  writeState(state);
}

export function getThresholds() {
  return readState().thresholds;
}

export function saveThresholds(thresholds: WorkspaceState['thresholds']) {
  const state = readState();
  state.thresholds = thresholds;
  writeState(state);
}

export function getBillingSummary(): BillingSummary {
  const state = readState();
  const plan = activePlan(state.billing.planId);
  const usage = billingUsage(state);
  const minutesRemaining = plan.minutesLimit === null ? null : Number(Math.max(0, plan.minutesLimit - usage.minutesUsed).toFixed(1));
  const actionsRemaining = plan.actionsLimit === null ? null : Math.max(0, plan.actionsLimit - usage.actionsUsed);

  return {
    plan,
    minutesUsed: usage.minutesUsed,
    minutesRemaining,
    minutesPercent: percentUsed(usage.minutesUsed, plan.minutesLimit),
    actionsUsed: usage.actionsUsed,
    actionsRemaining,
    actionsPercent: percentUsed(usage.actionsUsed, plan.actionsLimit),
    invoiceAmountCents: plan.monthlyCents,
    paymentMethod: state.billing.paymentMethod,
    invoices: state.billing.invoices,
  };
}

export function selectBillingPlan(planId: BillingPlanId) {
  const state = readState();
  state.billing.planId = activePlan(planId).id;
  writeState(state);
}

export function savePaymentMethod(label = 'Visa ending 4242') {
  const state = readState();
  state.billing.paymentMethod = label;
  writeState(state);
}

export function createBillingInvoice() {
  const state = readState();
  const plan = activePlan(state.billing.planId);
  const invoice: StoredInvoice = {
    id: `INV-${new Date().toISOString().slice(0, 7)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    date: displayDate(),
    planId: plan.id,
    planName: plan.name,
    amountCents: plan.monthlyCents,
    status: 'open',
  };
  state.billing.invoices = [invoice, ...state.billing.invoices];
  writeState(state);
  return invoice;
}

export function createExperiment(params: {
  name: string;
  agentType: ProviderId;
  agentConfig: Record<string, string>;
  scenarioIds: string[];
  gitSha?: string;
}) {
  const state = readState();
  const selectedScenarios = state.scenarios.filter((scenario) => params.scenarioIds.includes(scenario.id));
  const experimentId = makeId('exp');
  const agentLabel = params.agentConfig.agentId || params.agentConfig.assistantId || params.agentConfig.endpoint || params.agentConfig.roomOrAgent || params.agentType;
  const runs = selectedScenarios.map((scenario, index) =>
    makeRun({
      experimentId,
      scenario,
      agent: agentLabel,
      index,
    }),
  );
  const passCount = runs.filter((run) => run.status === 'pass').length;
  const avgMos = runs.length ? runs.reduce((sum, run) => sum + run.mos, 0) / runs.length : 0;
  const avgTask = runs.length ? runs.reduce((sum, run) => sum + run.task, 0) / runs.length : 0;
  const latencyP95 = runs.length ? Math.max(...runs.map((run) => run.latencyP95)) : 0;
  const status = avgMos >= state.thresholds.mos && avgTask >= state.thresholds.task ? 'pass' : 'fail';
  const weakest = runs.slice().sort((a, b) => a.task - b.task)[0];

  const experiment: StoredExperiment = {
    id: experimentId,
    name: params.name,
    version: agentLabel,
    agentType: params.agentType,
    agentConfig: params.agentConfig,
    scenarios: runs.length,
    mos: Number(avgMos.toFixed(1)),
    task: Number(avgTask.toFixed(2)),
    latencyP95,
    passRate: runs.length ? Number((passCount / runs.length).toFixed(2)) : 0,
    date: displayDate(),
    gitSha: params.gitSha || 'local-demo',
    status,
    reason: status === 'pass' ? '' : `${weakest?.scenarioName ?? 'Scenario'} missed the release gate`,
    runIds: runs.map((run) => run.id),
  };

  state.runs = [...runs, ...state.runs];
  state.experiments = [experiment, ...state.experiments];
  state.agent = {
    agentType: params.agentType,
    label: agentLabel,
    locator: agentLabel,
    updatedAt: new Date().toISOString(),
  };
  writeState(state);
  return { experiment, runs };
}

export function createPlaygroundExperiment(params: {
  scenarioId: string;
  agent: string;
}) {
  const state = readState();
  const scenario = state.scenarios.find((item) => item.id === params.scenarioId) ?? state.scenarios[0];
  return createExperiment({
    name: `${scenario.name} playground call`,
    agentType: 'custom_webrtc',
    agentConfig: { endpoint: params.agent },
    scenarioIds: [scenario.id],
    gitSha: 'playground',
  });
}

export function listExperiments() {
  return readState().experiments;
}

export function listRuns() {
  return readState().runs;
}

export function getExperiment(id: string) {
  const state = readState();
  const experiment = state.experiments.find((item) => item.id === id);
  if (!experiment) return null;
  const runs = state.runs.filter((run) => experiment.runIds.includes(run.id));
  return { experiment, runs };
}

export function getRun(id: string) {
  return readState().runs.find((run) => run.id === id) ?? null;
}

export function resetWorkspace() {
  writeState(cloneState(defaultState));
}

export function demoRunsAsStored(): StoredRun[] {
  return demoRuns.map((run) => ({
    id: run.id,
    experimentId: 'demo-exp',
    scenarioId: run.id,
    scenarioName: run.scenario,
    language: run.language,
    domain: run.domain,
    emotion: run.emotion,
    agent: run.agent,
    status: run.status as StoredRun['status'],
    mos: run.mos,
    task: run.task,
    duration: run.duration,
    durationMs: 130000,
    latencyP95: run.latencyP95,
    sttConfidence: 0.9,
    date: run.date,
    transcript: run.transcript,
    traces: [
      {
        id: `${run.id}-trace`,
        speaker: 'caller',
        text: run.transcript,
        latencyMs: 0,
        sttConfidence: 0.9,
      },
    ],
    recommendation: run.status === 'fail' ? 'Convert this failure into a regression scenario.' : 'No action needed.',
    scores: [
      { metricName: 'mos', value: run.mos, rationale: 'Demo score.' },
      { metricName: 'task_completed', value: run.task, rationale: 'Demo score.' },
      { metricName: 'latency_p95', value: run.latencyP95, rationale: 'Demo latency.' },
      { metricName: 'stt_confidence', value: 0.9, rationale: 'Demo confidence.' },
    ],
  }));
}
