import { generateWithLightcurveModelResult, type LightcurveModelResult } from '@/lib/llm';
import {
  EVALUATION_METRICS,
  JUDGE_METRICS,
  metricPromptContract,
  weightedMetricAverage,
  type EvaluationLayer,
  type EvaluationMetricName,
} from '@/lib/evaluationMetrics';

type TranscriptTurn = { speaker: string; text: string };

export type MosScores = {
  visqol: { mosLqo: number; pairCount: number };
  dnsmos: { overall: number; signal: number; background: number };
  serviceVersion?: string;
};

export type ReplayJudgment = {
  metrics: Record<EvaluationMetricName, number>;
  layerScores: Record<EvaluationLayer, number>;
  outcomeMatch: number;
  behavioralPath: number;
  toolCorrectness: number;
  safety: number;
  latencyBehavior: number;
  interruptionHandling: number;
  conversationalQuality: number;
  confidence: number;
  hardConstraintFailure: boolean;
  passed: boolean;
  overall: number;
  failureSummary: string | null;
  failureTaxonomy: string[];
  failingGraphNode: string | null;
  pressurePoint: string | null;
  rationale: string;
  actionableFixes: string[];
  decisionTrace: {
    summary: string;
    criteria: string[];
    evidence: Array<{ source: string; excerpt: string; impact: string }>;
    scoreSteps: Array<{ metric: string; score: number; reason: string }>;
    alternatives: Array<{ fix: string; reasonNotSelected: string }>;
    selectedFixReason: string | null;
  };
};

export type ReplayScoringResult = {
  mos: MosScores;
  flash: ReplayJudgment;
  pro: ReplayJudgment | null;
  final: ReplayJudgment;
  flashModel: Pick<LightcurveModelResult, 'provider' | 'model' | 'location'>;
  proModel: Pick<LightcurveModelResult, 'provider' | 'model' | 'location'> | null;
};

export function requiresProAdjudication(judgment: Pick<ReplayJudgment, 'confidence' | 'overall' | 'hardConstraintFailure'>, policy: 'flash-pro-review' | 'pro' | 'flash' = 'flash-pro-review') {
  return policy === 'pro' || (policy !== 'flash' && (judgment.confidence < 0.8 || Math.abs(judgment.overall - 0.75) <= 0.1 || judgment.hardConstraintFailure));
}

function object(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function clamp(value: unknown, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a number between ${min} and ${max}.`);
  return Math.max(min, Math.min(max, number));
}

function normalizedMos(value: number) {
  return clamp((value - 1) / 4);
}

function jsonFromModel(text: string | null) {
  if (!text) throw new Error('The judge returned no result.');
  return object(JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()));
}

function layerScores(metrics: Record<EvaluationMetricName, number>) {
  return Object.fromEntries((['task', 'conversation', 'voice_temporal', 'safety_trust'] as const).map((layer) => {
    const entries = EVALUATION_METRICS.filter((metric) => metric.layer === layer);
    const totalWeight = entries.reduce((sum, metric) => sum + metric.weight, 0);
    const value = entries.reduce((sum, metric) => sum + metrics[metric.name] * metric.weight, 0) / totalWeight;
    return [layer, value];
  })) as Record<EvaluationLayer, number>;
}

function parseJudgment(text: string | null, mos: MosScores): ReplayJudgment {
  const value = jsonFromModel(text);
  const rawMetrics = object(value.metrics);
  const metrics = {} as Record<EvaluationMetricName, number>;
  for (const metric of JUDGE_METRICS) {
    if (!Number.isFinite(Number(rawMetrics[metric.name]))) {
      throw new Error(`The judge omitted required metric ${metric.name}.`);
    }
    metrics[metric.name] = clamp(rawMetrics[metric.name]);
  }
  metrics.speech_intelligibility = normalizedMos(mos.visqol.mosLqo);
  metrics.audio_quality = normalizedMos(mos.dnsmos.overall);
  metrics.noise_robustness = (normalizedMos(mos.dnsmos.signal) + normalizedMos(mos.dnsmos.background)) / 2;

  const confidence = clamp(value.confidence);
  const hardConstraintFailure = value.hardConstraintFailure === true
    || metrics.safety < 0.5
    || metrics.pii_handling < 0.5
    || metrics.policy_compliance < 0.5;
  const overall = weightedMetricAverage(metrics);
  const conversationMetrics = EVALUATION_METRICS.filter((metric) => metric.layer === 'conversation');
  const conversationalQuality = 1 + 4 * conversationMetrics.reduce((sum, metric) => sum + metrics[metric.name], 0) / conversationMetrics.length;
  const trace = object(value.decisionTrace);
  const stringArray = (input: unknown, limit: number) => Array.isArray(input)
    ? input.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, limit)
    : [];
  const evidence = Array.isArray(trace.evidence) ? trace.evidence.flatMap((item) => {
    const row = object(item);
    return typeof row.excerpt === 'string' && typeof row.impact === 'string'
      ? [{ source: typeof row.source === 'string' ? row.source : 'Call transcript', excerpt: row.excerpt, impact: row.impact }]
      : [];
  }).slice(0, 12) : [];
  const scoreSteps = Array.isArray(trace.scoreSteps) ? trace.scoreSteps.flatMap((item) => {
    const row = object(item);
    return typeof row.metric === 'string' && typeof row.reason === 'string' && Number.isFinite(Number(row.score))
      ? [{ metric: row.metric, score: clamp(row.score), reason: row.reason }]
      : [];
  }).slice(0, 12) : [];
  const alternatives = Array.isArray(trace.alternatives) ? trace.alternatives.flatMap((item) => {
    const row = object(item);
    return typeof row.fix === 'string' && typeof row.reasonNotSelected === 'string'
      ? [{ fix: row.fix, reasonNotSelected: row.reasonNotSelected }]
      : [];
  }).slice(0, 5) : [];
  return {
    metrics,
    layerScores: layerScores(metrics),
    outcomeMatch: metrics.outcome_match,
    behavioralPath: metrics.behavioral_path,
    toolCorrectness: metrics.tool_correctness,
    safety: metrics.safety,
    latencyBehavior: metrics.latency_behavior,
    interruptionHandling: metrics.interruption_handling,
    conversationalQuality,
    confidence,
    hardConstraintFailure,
    passed: !hardConstraintFailure && overall >= 0.75,
    overall,
    failureSummary: typeof value.failureSummary === 'string' && value.failureSummary.trim() ? value.failureSummary.trim() : null,
    failureTaxonomy: Array.isArray(value.failureTaxonomy)
      ? value.failureTaxonomy.filter((item): item is string => typeof item === 'string').slice(0, 12)
      : [],
    failingGraphNode: typeof value.failingGraphNode === 'string' ? value.failingGraphNode : null,
    pressurePoint: typeof value.pressurePoint === 'string' ? value.pressurePoint : null,
    rationale: typeof value.rationale === 'string' ? value.rationale : 'Temporal scenario evaluation completed.',
    actionableFixes: stringArray(value.actionableFixes, 5),
    decisionTrace: {
      summary: typeof trace.summary === 'string' ? trace.summary : 'The result follows from the measured criteria and cited call evidence.',
      criteria: stringArray(trace.criteria, 12),
      evidence,
      scoreSteps,
      alternatives,
      selectedFixReason: typeof trace.selectedFixReason === 'string' ? trace.selectedFixReason : null,
    },
  };
}

function validPrivateAudioUri(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('azblob://') || value.startsWith('local://'));
}

async function requestMosScores(params: {
  callerPairs: Array<{ cleanCallerUri: string; impairedCallerUri: string }>;
  agentUri: string;
}): Promise<MosScores> {
  const endpoint = process.env.MOS_SERVICE_URL?.replace(/\/$/, '');
  if (!endpoint) throw new Error('MOS_SERVICE_URL is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${endpoint}/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.MOS_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.MOS_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({ callerPairs: params.callerPairs, agentUri: params.agentUri }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = object(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `MOS service returned ${response.status}.`);
    const visqol = object(body.visqol);
    const dnsmos = object(body.dnsmos);
    return {
      visqol: { mosLqo: clamp(visqol.mosLqo, 1, 5), pairCount: Math.max(1, Math.round(clamp(visqol.pairCount, 1, 1000))) },
      dnsmos: {
        overall: clamp(dnsmos.overall, 1, 5),
        signal: clamp(dnsmos.signal, 1, 5),
        background: clamp(dnsmos.background, 1, 5),
      },
      serviceVersion: typeof body.serviceVersion === 'string' ? body.serviceVersion : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function judgePrompt(params: {
  graph: unknown;
  successCriteria: unknown;
  manifest: unknown;
  transcript: TranscriptTurn[];
  mos: MosScores;
  adjudicate?: ReplayJudgment;
}) {
  return `You are Lightcurve's strict transcript-first evaluator for a voice agent tested against a cloned human scenario. Evaluate the agent, not the synthetic caller. The caller may vary wording, voice, timing, emotion, and noise only inside the supplied temporal graph.

Return JSON only with: metrics (an object containing every metric listed below as a 0..1 number), confidence (0..1), hardConstraintFailure (boolean), failureSummary (string or null), failureTaxonomy (array of short stable labels), failingGraphNode (node id or null), pressurePoint (short label or null), rationale (short string), actionableFixes (up to 3 concrete rule or prompt changes), and decisionTrace.

decisionTrace must contain: summary, criteria (the criteria that materially affected the result), evidence (objects with source, exact short excerpt, and impact), scoreSteps (objects with metric, score, and concise reason), alternatives (objects with fix and reasonNotSelected), and selectedFixReason. This is an auditable decision record, not private hidden reasoning. Every claim must point to supplied evidence; do not invent evidence.

Required judge metrics:
${metricPromptContract()}

Do not include speech_intelligibility, audio_quality, or noise_robustness in metrics; Lightcurve derives those from signal measurements. Score confusion_detection highly only when the agent notices confusion that is actually present or correctly recognizes that none is present. Pass/fail is calculated after signal metrics are merged. Do not infer facts or goals outside the graph.

Temporal Voice Graph: ${JSON.stringify(params.graph)}
Success criteria: ${JSON.stringify(params.successCriteria)}
Immutable Scenario Clone Manifest: ${JSON.stringify(params.manifest)}
Measured audio quality: ${JSON.stringify(params.mos)}
Transcript:\n${params.transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')}
${params.adjudicate ? `A first-pass judge produced this borderline or low-confidence result. Independently adjudicate it: ${JSON.stringify(params.adjudicate)}` : ''}`;
}

export async function scoreVoiceReplay(params: {
  graph: unknown;
  successCriteria: unknown;
  manifest: unknown;
  transcript: TranscriptTurn[];
  cleanCallerUri: unknown;
  impairedCallerUri: unknown;
  agentUri: unknown;
  artifacts?: unknown;
  judgePolicy?: 'flash-pro-review' | 'pro' | 'flash';
}): Promise<ReplayScoringResult> {
  const artifactRecord = object(params.artifacts);
  const artifactPairs = Array.isArray(artifactRecord.callerTurns) ? artifactRecord.callerTurns.flatMap((item) => {
    const turn = object(item);
    return validPrivateAudioUri(turn.cleanAudioUrl) && validPrivateAudioUri(turn.impairedAudioUrl)
      ? [{ cleanCallerUri: turn.cleanAudioUrl, impairedCallerUri: turn.impairedAudioUrl }]
      : [];
  }) : [];
  const callerPairs = artifactPairs.length
    ? artifactPairs
    : validPrivateAudioUri(params.cleanCallerUri) && validPrivateAudioUri(params.impairedCallerUri)
      ? [{ cleanCallerUri: params.cleanCallerUri, impairedCallerUri: params.impairedCallerUri }]
      : [];
  if (!callerPairs.length || !validPrivateAudioUri(params.agentUri)) {
    throw new Error('Clean caller, impaired caller, and agent audio must all be stored before scoring.');
  }
  const mos = await requestMosScores({ callerPairs, agentUri: params.agentUri });
  const flashModel = process.env.LIGHTCURVE_FLASH_JUDGE_MODEL || 'lightcurve-reasoner';
  const judgeOptions = { responseFormat: 'json_object' as const, maxTokens: 850, thinking: false };
  const flashResult = await generateWithLightcurveModelResult(flashModel, judgePrompt({ ...params, mos }), judgeOptions);
  const flash = parseJudgment(flashResult.text, mos);
  const needsPro = requiresProAdjudication(flash, params.judgePolicy);
  if (!needsPro) return { mos, flash, pro: null, final: flash, flashModel: flashResult, proModel: null };
  const proModel = process.env.LIGHTCURVE_PRO_JUDGE_MODEL || 'lightcurve-reasoner';
  const proResult = await generateWithLightcurveModelResult(proModel, judgePrompt({ ...params, mos, adjudicate: flash }), judgeOptions);
  const pro = parseJudgment(proResult.text, mos);
  return { mos, flash, pro, final: pro, flashModel: flashResult, proModel: proResult };
}
