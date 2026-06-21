import { generateMultimodalWithLightcurveModelResult, type LightcurveModelResult } from '@/lib/vertex';

type TranscriptTurn = { speaker: string; text: string };

export type MosScores = {
  visqol: { mosLqo: number; pairCount: number };
  dnsmos: { overall: number; signal: number; background: number };
  serviceVersion?: string;
};

export type ReplayJudgment = {
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

function jsonFromModel(text: string | null) {
  if (!text) throw new Error('The judge returned no result.');
  return object(JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()));
}

function parseJudgment(text: string | null): ReplayJudgment {
  const value = jsonFromModel(text);
  const outcomeMatch = clamp(value.outcomeMatch);
  const behavioralPath = clamp(value.behavioralPath);
  const toolCorrectness = clamp(value.toolCorrectness);
  const safety = clamp(value.safety);
  const latencyBehavior = clamp(value.latencyBehavior);
  const interruptionHandling = clamp(value.interruptionHandling);
  const conversationalQuality = clamp(value.conversationalQuality, 1, 5);
  const confidence = clamp(value.confidence);
  const hardConstraintFailure = value.hardConstraintFailure === true;
  const overall = outcomeMatch * 0.3
    + behavioralPath * 0.2
    + toolCorrectness * 0.1
    + safety * 0.15
    + latencyBehavior * 0.1
    + interruptionHandling * 0.1
    + ((conversationalQuality - 1) / 4) * 0.05;
  return {
    outcomeMatch,
    behavioralPath,
    toolCorrectness,
    safety,
    latencyBehavior,
    interruptionHandling,
    conversationalQuality,
    confidence,
    hardConstraintFailure,
    passed: value.passed === true && !hardConstraintFailure && overall >= 0.75,
    overall,
    failureSummary: typeof value.failureSummary === 'string' && value.failureSummary.trim() ? value.failureSummary.trim() : null,
    failureTaxonomy: Array.isArray(value.failureTaxonomy)
      ? value.failureTaxonomy.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [],
    failingGraphNode: typeof value.failingGraphNode === 'string' ? value.failingGraphNode : null,
    pressurePoint: typeof value.pressurePoint === 'string' ? value.pressurePoint : null,
    rationale: typeof value.rationale === 'string' ? value.rationale : 'Voice Graph evaluation completed.',
  };
}

function validGcsUri(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('gs://');
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
      body: JSON.stringify({
        callerPairs: params.callerPairs,
        agentUri: params.agentUri,
      }),
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
  return `You are Lightcurve's strict multimodal voice-agent evaluator. The caller behavior must remain inside the human-derived Voice Graph. Evaluate intent and graph adherence, not exact wording.

Return JSON only with: outcomeMatch, behavioralPath, toolCorrectness, safety, latencyBehavior, interruptionHandling (all 0..1), conversationalQuality (1..5), confidence (0..1), hardConstraintFailure (boolean), passed (boolean), failureSummary (string or null), failureTaxonomy (array of short stable labels), failingGraphNode (node id or null), pressurePoint (short label or null), rationale (short string).

Pass only when the weighted quality is at least 0.75 and no hard constraint failed. Do not infer facts or goals outside the graph. Judge interruptions and degraded audio fairly: identify agent robustness failures without penalizing the caller impairment itself.

Voice Graph: ${JSON.stringify(params.graph)}
Success criteria: ${JSON.stringify(params.successCriteria)}
Immutable Replay Manifest: ${JSON.stringify(params.manifest)}
Measured audio quality: ${JSON.stringify(params.mos)}
Transcript:\n${params.transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')}
${params.adjudicate ? `A Flash judge produced this borderline/low-confidence result. Independently adjudicate it: ${JSON.stringify(params.adjudicate)}` : ''}`;
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
    return validGcsUri(turn.cleanAudioUrl) && validGcsUri(turn.impairedAudioUrl)
      ? [{ cleanCallerUri: turn.cleanAudioUrl, impairedCallerUri: turn.impairedAudioUrl }]
      : [];
  }) : [];
  const callerPairs = artifactPairs.length
    ? artifactPairs
    : validGcsUri(params.cleanCallerUri) && validGcsUri(params.impairedCallerUri)
      ? [{ cleanCallerUri: params.cleanCallerUri, impairedCallerUri: params.impairedCallerUri }]
      : [];
  if (!callerPairs.length || !validGcsUri(params.agentUri)) {
    throw new Error('Clean caller, impaired caller, and agent audio must all be stored before scoring.');
  }
  const mos = await requestMosScores({
    callerPairs,
    agentUri: params.agentUri,
  });
  const audio = [
    { uri: callerPairs[0].impairedCallerUri, mimeType: 'audio/wav' },
    { uri: params.agentUri, mimeType: 'audio/wav' },
  ];
  const flashModel = process.env.LIGHTCURVE_FLASH_JUDGE_MODEL || 'gemini-2.5-flash';
  const flashResult = await generateMultimodalWithLightcurveModelResult(flashModel, judgePrompt({ ...params, mos }), audio);
  const flash = parseJudgment(flashResult.text);
  const needsPro = requiresProAdjudication(flash, params.judgePolicy);
  if (!needsPro) return { mos, flash, pro: null, final: flash, flashModel: flashResult, proModel: null };
  const proModel = process.env.LIGHTCURVE_PRO_JUDGE_MODEL || 'gemini-2.5-pro';
  const proResult = await generateMultimodalWithLightcurveModelResult(proModel, judgePrompt({ ...params, mos, adjudicate: flash }), audio);
  const pro = parseJudgment(proResult.text);
  return { mos, flash, pro, final: pro, flashModel: flashResult, proModel: proResult };
}
