import {
  INTERACTION_ATTRIBUTES,
  MODEL_ORBIT_RUBRIC,
  PARTICIPANT_ATTRIBUTES,
  TEMPORAL_ATTRIBUTES,
  type ModelOrbitSubject,
  type ModelOrbitUnit,
} from '@/lib/modelOrbitRubric';

type UnknownRecord = Record<string, unknown>;

export type ModelOrbitObservation = {
  value: number | null;
  unit: ModelOrbitUnit;
  confidence: number;
  disagreement: number | null;
  evaluatorCount: number;
  evaluators: string[];
  evidence: string[];
  sourceNodeIds: string[];
};

export type ModelOrbitNode = {
  id: string;
  turnIndex: number;
  speaker: 'human' | 'agent';
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  timingEstimated: boolean;
  attributes: Record<string, ModelOrbitObservation>;
};

export type ModelOrbitVoiceSignals = {
  durationMs: number;
  rmsMean: number;
  rmsVariation: number;
  pauseRatio: number;
  voicedRatio: number;
  pitchMeanHz: number | null;
  pitchVariationHz: number | null;
  pitchRangeHz: number | null;
  confidence: number;
};

export type ModelOrbitEvaluation = {
  schema: 'lightcurve.modelorbit.v1';
  rubric: typeof MODEL_ORBIT_RUBRIC;
  generatedAt: string;
  profiles: Record<'human' | 'agent', {
    turnCount: number;
    attributes: Record<string, ModelOrbitObservation>;
  }>;
  temporal: Record<string, ModelOrbitObservation>;
  interaction: Record<string, ModelOrbitObservation>;
  voice: Record<'human' | 'agent', ModelOrbitVoiceSignals | null>;
  nodes: ModelOrbitNode[];
  summary: {
    sourceNodeCount: number;
    evidenceCoverage: number;
    averageConfidence: number;
    averageDisagreement: number | null;
    evaluatorCount: number;
    reliability: 'calibrated' | 'provisional' | 'insufficient';
    limitations: string[];
  };
};

type Signal = { value: number; confidence: number; evaluator: string; evidence: string[] };

const behaviorLexicons: Record<string, { positive: RegExp[]; negative?: RegExp[]; baseline: number }> = {
  politeness: { baseline: 2, positive: [/\bplease\b/i, /\bthank(?:s| you)\b/i, /\bwould you\b/i, /\bkindly\b/i, /\bappreciate\b/i], negative: [/\bidiot\b/i, /\bstupid\b/i, /\bshut up\b/i, /\buseless\b/i] },
  anger: { baseline: 0, positive: [/\bangry\b/i, /\bfurious\b/i, /\bunacceptable\b/i, /\bridiculous\b/i, /\bdisgusting\b/i, /\bdamn\b/i] },
  frustration: { baseline: 0, positive: [/\bfrustrat(?:ed|ing)\b/i, /\bagain\b/i, /\bstill not\b/i, /\bdoesn'?t work\b/i, /\btired of\b/i, /\bhow many times\b/i] },
  confusion: { baseline: 0, positive: [/\bconfused\b/i, /\bdon'?t understand\b/i, /\bwhat do you mean\b/i, /\bnot sure\b/i, /\bwait\b/i, /\bwhich one\b/i] },
  urgency: { baseline: 0, positive: [/\burgent\b/i, /\bimmediately\b/i, /\bright now\b/i, /\bas soon as possible\b/i, /\basap\b/i, /\bcan'?t wait\b/i] },
  assertiveness: { baseline: 1, positive: [/\bi need\b/i, /\bi want\b/i, /\bi expect\b/i, /\byou must\b/i, /\bi will\b/i], negative: [/\bmaybe\b/i, /\bperhaps\b/i, /\bi guess\b/i] },
  empathy: { baseline: 0, positive: [/\bi understand\b/i, /\bi can see\b/i, /\bthat sounds\b/i, /\bsorry (?:that|you)\b/i, /\bmust be\b/i] },
  confidence: { baseline: 2, positive: [/\bdefinitely\b/i, /\bcertainly\b/i, /\bi can confirm\b/i, /\bwill\b/i], negative: [/\bmaybe\b/i, /\bnot sure\b/i, /\bi think\b/i, /\bprobably\b/i] },
  cooperation: { baseline: 2, positive: [/\bokay\b/i, /\bsure\b/i, /\byes\b/i, /\bhappy to\b/i, /\blet'?s\b/i], negative: [/\brefuse\b/i, /\bwon'?t\b/i, /\bnot going to\b/i] },
  clarity: { baseline: 2, positive: [/\bfirst\b/i, /\bnext\b/i, /\bto confirm\b/i, /\bspecifically\b/i], negative: [/\bsomething\b/i, /\bwhatever\b/i, /\byou know\b/i] },
  hesitation: { baseline: 0, positive: [/\bum+\b/i, /\buh+\b/i, /\berm+\b/i, /\bi guess\b/i, /\bmaybe\b/i, /\bnot sure\b/i] },
  defensiveness: { baseline: 0, positive: [/\bnot my fault\b/i, /\bi already told\b/i, /\bthat'?s not what i said\b/i, /\bi can'?t be blamed\b/i] },
  curiosity: { baseline: 0, positive: [/\bwhy\b/i, /\bhow\b/i, /\bwhat if\b/i, /\bcould you explain\b/i, /\btell me more\b/i] },
  respect: { baseline: 2, positive: [/\bplease\b/i, /\bthank(?:s| you)\b/i, /\bsir\b/i, /\bma'am\b/i], negative: [/\bidiot\b/i, /\bstupid\b/i, /\buseless\b/i, /\bshut up\b/i] },
  flexibility: { baseline: 1, positive: [/\balternative\b/i, /\banother option\b/i, /\binstead\b/i, /\beither\b/i, /\bwe can also\b/i], negative: [/\bonly option\b/i, /\bno other way\b/i] },
  persuasiveness: { baseline: 0, positive: [/\bbecause\b/i, /\btherefore\b/i, /\bso that\b/i, /\bbenefit\b/i, /\brecommend\b/i, /\bconsider\b/i] },
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function words(text: string) {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

function matchedPatterns(text: string, patterns: RegExp[]) {
  return patterns.flatMap((pattern) => {
    const match = text.match(pattern);
    return match?.[0] ? [match[0]] : [];
  });
}

function lexicalSignal(attributeId: string, text: string): Signal {
  const config = behaviorLexicons[attributeId];
  const positive = matchedPatterns(text, config.positive);
  const negative = matchedPatterns(text, config.negative ?? []);
  const value = clamp(config.baseline + positive.length * 0.9 - negative.length * 1.15, 0, 4);
  return {
    value,
    confidence: clamp(0.35 + Math.min(0.25, words(text).length / 80) + Math.min(0.2, (positive.length + negative.length) * 0.08), 0.35, 0.72),
    evaluator: 'modelorbit.lexicon.v1',
    evidence: [...positive.map((item) => `matched "${item}"`), ...negative.map((item) => `counter-signal "${item}"`)].slice(0, 4),
  };
}

function discourseSignal(attributeId: string, text: string): Signal {
  const tokenCount = Math.max(1, words(text).length);
  const questions = (text.match(/\?/g) ?? []).length;
  const exclamations = (text.match(/!/g) ?? []).length;
  const uppercaseWords = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
  const ellipses = (text.match(/\.{3,}/g) ?? []).length;
  const longSentence = tokenCount > 35 ? 1 : 0;
  let value = behaviorLexicons[attributeId].baseline;
  const evidence: string[] = [];
  switch (attributeId) {
    case 'anger': value = clamp(exclamations * 0.9 + uppercaseWords * 1.1, 0, 4); break;
    case 'frustration': value = clamp(exclamations * 0.6 + ellipses * 0.5, 0, 4); break;
    case 'confusion': value = clamp(questions * 0.75 + ellipses * 0.4, 0, 4); break;
    case 'urgency': value = clamp(exclamations * 0.7 + uppercaseWords * 0.6, 0, 4); break;
    case 'assertiveness': value = clamp(1.2 + exclamations * 0.5 - ellipses * 0.5, 0, 4); break;
    case 'empathy': value = /\byou\b/i.test(text) ? 0.8 : 0; break;
    case 'confidence': value = clamp(2.4 - ellipses * 0.7 - questions * 0.25, 0, 4); break;
    case 'cooperation': value = /\b(?:yes|okay|sure|let'?s)\b/i.test(text) ? 3 : 1.8; break;
    case 'clarity': value = clamp(3 - longSentence * 0.8 - ellipses * 0.5, 0, 4); break;
    case 'hesitation': value = clamp(ellipses * 0.9 + (text.match(/\b(?:um|uh|erm)\b/gi) ?? []).length, 0, 4); break;
    case 'defensiveness': value = /\b(?:but|actually|already)\b/i.test(text) ? 1.2 : 0; break;
    case 'curiosity': value = clamp(questions * 1.25, 0, 4); break;
    case 'politeness': value = /\b(?:please|thanks|thank you|would you|could you)\b/i.test(text) ? 3.2 : 2; break;
    case 'respect': value = /\b(?:please|thanks|thank you|sir|ma'am)\b/i.test(text) ? 3.2 : 2; break;
    case 'flexibility': value = /\b(?:or|instead|alternative|option)\b/i.test(text) ? 2.8 : 1.2; break;
    case 'persuasiveness': value = /\b(?:because|therefore|so that|recommend)\b/i.test(text) ? 2.8 : 0.5; break;
  }
  if (questions) evidence.push(`${questions} question${questions === 1 ? '' : 's'}`);
  if (exclamations) evidence.push(`${exclamations} exclamation${exclamations === 1 ? '' : 's'}`);
  if (uppercaseWords) evidence.push(`${uppercaseWords} emphasized word${uppercaseWords === 1 ? '' : 's'}`);
  if (ellipses) evidence.push(`${ellipses} hesitation marker${ellipses === 1 ? '' : 's'}`);
  evidence.push(`${tokenCount} words`);
  return { value, confidence: clamp(0.3 + Math.min(0.2, tokenCount / 100), 0.3, 0.5), evaluator: 'modelorbit.discourse.v1', evidence };
}

function combineSignals(signals: Signal[], unit: ModelOrbitUnit, sourceNodeIds: string[]): ModelOrbitObservation {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.confidence, 0);
  if (!signals.length || totalWeight === 0) return missing(unit, sourceNodeIds);
  const value = signals.reduce((sum, signal) => sum + signal.value * signal.confidence, 0) / totalWeight;
  const disagreement = signals.length > 1
    ? Math.sqrt(signals.reduce((sum, signal) => sum + (signal.value - value) ** 2, 0) / signals.length)
    : null;
  const rawConfidence = signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length;
  return {
    value: round(value),
    unit,
    confidence: round(clamp(rawConfidence * (1 - Math.min(0.45, (disagreement ?? 0) / 5)), 0, 1)),
    disagreement: disagreement == null ? null : round(disagreement),
    evaluatorCount: signals.length,
    evaluators: signals.map((signal) => signal.evaluator),
    evidence: [...new Set(signals.flatMap((signal) => signal.evidence))].slice(0, 8),
    sourceNodeIds,
  };
}

function measured(value: number | null, unit: ModelOrbitUnit, confidence: number, evidence: string[], nodeIds: string[]): ModelOrbitObservation {
  return {
    value: value == null ? null : round(value),
    unit,
    confidence: value == null ? 0 : round(confidence),
    disagreement: null,
    evaluatorCount: value == null ? 0 : 1,
    evaluators: value == null ? [] : ['modelorbit.temporal.v1'],
    evidence,
    sourceNodeIds: nodeIds,
  };
}

function missing(unit: ModelOrbitUnit, nodeIds: string[] = []): ModelOrbitObservation {
  return { value: null, unit, confidence: 0, disagreement: null, evaluatorCount: 0, evaluators: [], evidence: [], sourceNodeIds: nodeIds };
}

function normalizeNodes(params: { transcript: unknown; traces?: unknown; graph?: unknown }) {
  const transcript = Array.isArray(params.transcript) ? params.transcript : [];
  const traces = Array.isArray(params.traces) ? params.traces.map(record) : [];
  const graph = record(params.graph);
  const graphNodes = (Array.isArray(graph.observedPath) ? graph.observedPath : Array.isArray(graph.nodes) ? graph.nodes : []).map(record);
  let cursor = 0;
  return transcript.flatMap((item, turnIndex) => {
    const row = record(item);
    const speaker: 'human' | 'agent' | null = row.speaker === 'agent' || row.role === 'assistant'
      ? 'agent'
      : row.speaker === 'human' || row.speaker === 'caller' || row.role === 'user'
        ? 'human'
        : null;
    const text = typeof row.text === 'string' ? row.text.trim() : typeof row.content === 'string' ? row.content.trim() : '';
    if (!speaker || !text) return [];
    const graphNode = graphNodes[turnIndex] ?? {};
    const trace = traces[turnIndex] ?? {};
    const explicitStart = Number(row.startedAtMs ?? row.startMs ?? graphNode.startedAtMs);
    const explicitEnd = Number(row.endedAtMs ?? row.endMs ?? graphNode.endedAtMs);
    const hasTiming = Number.isFinite(explicitStart) && Number.isFinite(explicitEnd) && explicitEnd >= explicitStart;
    const latency = Number(trace.totalLatencyMs);
    const estimatedDuration = Math.max(500, Math.round(words(text).length / 150 * 60_000));
    const start = hasTiming ? explicitStart : cursor + (Number.isFinite(latency) ? Math.max(0, latency) : turnIndex ? 300 : 0);
    const end = hasTiming ? explicitEnd : start + estimatedDuration;
    cursor = Math.max(cursor, end);
    return [{
      id: typeof row.nodeId === 'string' ? row.nodeId : typeof graphNode.id === 'string' ? graphNode.id : `turn_${turnIndex + 1}`,
      turnIndex,
      speaker,
      text,
      startedAtMs: start,
      endedAtMs: end,
      timingEstimated: !hasTiming,
    }];
  });
}

function averageObservations(observations: ModelOrbitObservation[], unit: ModelOrbitUnit): ModelOrbitObservation {
  const present = observations.filter((observation) => observation.value != null && observation.confidence > 0);
  if (!present.length) return missing(unit);
  const weight = present.reduce((sum, observation) => sum + observation.confidence, 0);
  const value = present.reduce((sum, observation) => sum + Number(observation.value) * observation.confidence, 0) / weight;
  const disagreements = present.flatMap((observation) => observation.disagreement == null ? [] : [observation.disagreement]);
  return {
    value: round(value),
    unit,
    confidence: round(present.reduce((sum, observation) => sum + observation.confidence, 0) / present.length),
    disagreement: disagreements.length ? round(disagreements.reduce((sum, value) => sum + value, 0) / disagreements.length) : null,
    evaluatorCount: Math.max(...present.map((observation) => observation.evaluatorCount)),
    evaluators: [...new Set(present.flatMap((observation) => observation.evaluators))],
    evidence: [...new Set(present.flatMap((observation) => observation.evidence))].slice(0, 10),
    sourceNodeIds: [...new Set(present.flatMap((observation) => observation.sourceNodeIds))],
  };
}

function jaccard(left: string, right: string) {
  const a = new Set(words(left));
  const b = new Set(words(right));
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  return [...a].filter((token) => b.has(token)).length / union.size;
}

function interactionObservations(nodes: ModelOrbitNode[], graph: unknown) {
  const nodeIds = nodes.map((node) => node.id);
  const transitions = nodes.slice(1).map((node, index) => ({ previous: nodes[index], node, gap: node.startedAtMs - nodes[index].endedAtMs }));
  const durations = nodes.map((node) => Math.max(0, node.endedAtMs - node.startedAtMs));
  const totalSpeaking = durations.reduce((sum, value) => sum + value, 0);
  const callSpan = nodes.length ? Math.max(1, nodes[nodes.length - 1].endedAtMs - nodes[0].startedAtMs) : 1;
  const positiveGaps = transitions.filter((item) => item.gap >= 0).map((item) => item.gap);
  const overlaps = transitions.filter((item) => item.gap < 0).map((item) => Math.abs(item.gap));
  const timingConfidence = nodes.some((node) => node.timingEstimated) ? 0.45 : 0.96;
  const humanDuration = nodes.filter((node) => node.speaker === 'human').reduce((sum, node) => sum + node.endedAtMs - node.startedAtMs, 0);
  const averageDuration = durations.length ? totalSpeaking / durations.length : null;
  const totalWords = nodes.reduce((sum, node) => sum + words(node.text).length, 0);
  const temporal: Record<string, ModelOrbitObservation> = {
    response_latency_ms: measured(positiveGaps.length ? positiveGaps.reduce((sum, value) => sum + value, 0) / positiveGaps.length : null, 'milliseconds', timingConfidence, ['Mean non-overlapping transition gap'], nodeIds),
    pause_duration_ms: measured(positiveGaps.length ? positiveGaps.reduce((sum, value) => sum + value, 0) / positiveGaps.length : null, 'milliseconds', timingConfidence, ['Mean silence between adjacent turns'], nodeIds),
    turn_duration_ms: measured(averageDuration, 'milliseconds', timingConfidence, [nodes.some((node) => node.timingEstimated) ? 'Estimated from transcript length where timestamps were absent' : 'Measured from speech timestamps'], nodeIds),
    words_per_minute: measured(totalSpeaking ? totalWords / (totalSpeaking / 60_000) : null, 'words_per_minute', timingConfidence, [`${totalWords} words across ${Math.round(totalSpeaking)} ms of speech`], nodeIds),
    interruption_rate: measured(transitions.length ? overlaps.length / transitions.length : null, 'ratio_0_1', timingConfidence, [`${overlaps.length} overlapping transitions`], nodeIds),
    overlap_rate: measured(totalSpeaking ? overlaps.reduce((sum, value) => sum + value, 0) / totalSpeaking : null, 'ratio_0_1', timingConfidence, ['Overlapping duration divided by speaking duration'], nodeIds),
    silence_ratio: measured(callSpan ? positiveGaps.reduce((sum, value) => sum + value, 0) / callSpan : null, 'ratio_0_1', timingConfidence, ['Silent transition time divided by call span'], nodeIds),
    talk_ratio: measured(totalSpeaking ? humanDuration / totalSpeaking : null, 'ratio_0_1', timingConfidence, ['Human speaking duration divided by all speaking duration'], nodeIds),
    repair_latency_ms: missing('milliseconds', nodeIds),
    escalation_time_ms: missing('milliseconds', nodeIds),
  };

  const confusionNodes = nodes.filter((node) => Number(node.attributes.confusion?.value ?? 0) >= 1.5);
  if (confusionNodes.length) {
    const repairs = confusionNodes.flatMap((node) => {
      const next = nodes.find((candidate) => candidate.turnIndex > node.turnIndex && candidate.speaker !== node.speaker);
      return next ? [Math.max(0, next.startedAtMs - node.endedAtMs)] : [];
    });
    temporal.repair_latency_ms = measured(repairs.length ? repairs.reduce((sum, value) => sum + value, 0) / repairs.length : null, 'milliseconds', timingConfidence * 0.8, ['Confusion node to next opposite-speaker response'], confusionNodes.map((node) => node.id));
  }
  const escalationNode = [...nodes].sort((left, right) => {
    const leftValue = Number(left.attributes.anger?.value ?? 0) + Number(left.attributes.frustration?.value ?? 0);
    const rightValue = Number(right.attributes.anger?.value ?? 0) + Number(right.attributes.frustration?.value ?? 0);
    return rightValue - leftValue;
  })[0];
  if (escalationNode && Number(escalationNode.attributes.anger?.value ?? 0) + Number(escalationNode.attributes.frustration?.value ?? 0) > 0.4) {
    temporal.escalation_time_ms = measured(escalationNode.startedAtMs - nodes[0].startedAtMs, 'milliseconds', 0.55, ['Peak transcript-derived anger/frustration node'], [escalationNode.id]);
  }

  const adjacentPairs = transitions.filter((item) => item.previous.speaker !== item.node.speaker);
  const affectDifference = adjacentPairs.map(({ previous, node }) => Math.abs(Number(previous.attributes.anger.value) - Number(node.attributes.anger.value)) + Math.abs(Number(previous.attributes.frustration.value) - Number(node.attributes.frustration.value)));
  const reductions = adjacentPairs.map(({ previous, node }) => Math.max(0, Number(previous.attributes.anger.value) + Number(previous.attributes.frustration.value) - Number(node.attributes.anger.value) - Number(node.attributes.frustration.value)));
  const confusionReductions = adjacentPairs.map(({ previous, node }) => Math.max(0, Number(previous.attributes.confusion.value) - Number(node.attributes.confusion.value)));
  const questions = nodes.filter((node) => node.text.includes('?'));
  const answered = questions.filter((node) => nodes.some((candidate) => candidate.turnIndex === node.turnIndex + 1 && candidate.speaker !== node.speaker && words(candidate.text).length > 1));
  let repetitions = 0;
  for (const node of nodes) {
    const prior = nodes.filter((candidate) => candidate.speaker === node.speaker && candidate.turnIndex < node.turnIndex);
    if (prior.some((candidate) => jaccard(candidate.text, node.text) >= 0.6)) repetitions += 1;
  }
  const novelTurns = nodes.filter((node) => {
    const priorText = nodes.filter((candidate) => candidate.turnIndex < node.turnIndex).map((candidate) => candidate.text).join(' ');
    return node.turnIndex === 0 || jaccard(priorText, node.text) < 0.45;
  });
  const graphRecord = record(graph);
  const configuredNodes = Array.isArray(graphRecord.nodes) ? graphRecord.nodes.length : Array.isArray(graphRecord.observedPath) ? graphRecord.observedPath.length : 0;
  const graphCoverage = configuredNodes ? Math.min(1, nodes.length / configuredNodes) : null;
  const interaction: Record<string, ModelOrbitObservation> = {
    sentiment_alignment: measured(affectDifference.length ? clamp(4 - affectDifference.reduce((sum, value) => sum + value, 0) / affectDifference.length, 0, 4) : null, 'intensity_0_4', 0.45, ['Difference in adjacent transcript-derived anger and frustration'], nodeIds),
    deescalation: measured(reductions.length ? clamp(reductions.reduce((sum, value) => sum + value, 0) / reductions.length, 0, 4) : null, 'intensity_0_4', 0.45, ['Reduction in anger and frustration across adjacent turns'], nodeIds),
    confusion_recovery: measured(confusionReductions.length ? clamp(confusionReductions.reduce((sum, value) => sum + value, 0) / confusionReductions.length, 0, 4) : null, 'intensity_0_4', 0.45, ['Reduction in confusion across adjacent turns'], nodeIds),
    question_answer_fit: measured(questions.length ? answered.length / questions.length : null, 'ratio_0_1', 0.55, [`${answered.length} of ${questions.length} questions received a following response`], questions.map((node) => node.id)),
    repetition_rate: measured(nodes.length ? repetitions / nodes.length : null, 'ratio_0_1', 0.65, [`${repetitions} turns exceeded token-overlap threshold`], nodeIds),
    topic_drift: missing('intensity_0_4', nodeIds),
    conversational_progress: measured(graphCoverage, 'ratio_0_1', configuredNodes ? 0.7 : 0, configuredNodes ? [`${nodes.length} observed turns mapped against ${configuredNodes} graph nodes`] : [], nodeIds),
    resolution_efficiency: missing('ratio_0_1', nodeIds),
    information_exchange: measured(nodes.length ? novelTurns.length / nodes.length : null, 'ratio_0_1', 0.5, [`${novelTurns.length} turns introduced substantially new tokens`], novelTurns.map((node) => node.id)),
    dominance_balance: measured(totalSpeaking ? 1 - Math.abs(humanDuration - (totalSpeaking - humanDuration)) / totalSpeaking : null, 'ratio_0_1', timingConfidence, ['Balance derived from human and agent speaking duration'], nodeIds),
  };
  return { temporal, interaction };
}

export function buildModelOrbitEvaluation(params: {
  transcript: unknown;
  traces?: unknown;
  graph?: unknown;
  voice?: Partial<Record<'human' | 'agent', ModelOrbitVoiceSignals | null>>;
}): ModelOrbitEvaluation {
  const normalized = normalizeNodes(params);
  const nodes: ModelOrbitNode[] = normalized.map((node) => ({
    ...node,
    attributes: Object.fromEntries(PARTICIPANT_ATTRIBUTES.map((attribute) => [
      attribute.id,
      combineSignals([
        lexicalSignal(attribute.id, node.text),
        discourseSignal(attribute.id, node.text),
      ], attribute.unit, [node.id]),
    ])),
  }));
  const profiles = Object.fromEntries((['human', 'agent'] as const).map((speaker) => {
    const speakerNodes = nodes.filter((node) => node.speaker === speaker);
    return [speaker, {
      turnCount: speakerNodes.length,
      attributes: Object.fromEntries(PARTICIPANT_ATTRIBUTES.map((attribute) => [
        attribute.id,
        averageObservations(speakerNodes.map((node) => node.attributes[attribute.id]), attribute.unit),
      ])),
    }];
  })) as ModelOrbitEvaluation['profiles'];
  const { temporal, interaction } = interactionObservations(nodes, params.graph);
  const all = [
    ...nodes.flatMap((node) => Object.values(node.attributes)),
    ...Object.values(temporal),
    ...Object.values(interaction),
  ];
  const present = all.filter((observation) => observation.value != null);
  const disagreements = present.flatMap((observation) => observation.disagreement == null ? [] : [observation.disagreement]);
  const limitations = [
    "Behavior results are an initial review and should be confirmed against your team's standards.",
    ...(nodes.some((node) => node.timingEstimated) ? ['Some timing is estimated because the original call did not include complete timestamps.'] : []),
    ...(!params.voice?.human && !params.voice?.agent ? ['Voice patterns are unavailable for this call.'] : []),
    ...(params.voice?.agent && !params.voice?.human ? ['Caller voice patterns are unavailable for this call.'] : []),
    ...(params.voice?.human && !params.voice?.agent ? ['Agent voice patterns are unavailable for this call.'] : []),
    'Results have not yet been calibrated with trained human reviewers.',
  ];
  const evidenceCoverage = all.length ? present.length / all.length : 0;
  const averageConfidence = present.length ? present.reduce((sum, observation) => sum + observation.confidence, 0) / present.length : 0;
  return {
    schema: 'lightcurve.modelorbit.v1',
    rubric: MODEL_ORBIT_RUBRIC,
    generatedAt: new Date().toISOString(),
    profiles,
    temporal,
    interaction,
    voice: {
      human: params.voice?.human ?? null,
      agent: params.voice?.agent ?? null,
    },
    nodes,
    summary: {
      sourceNodeCount: nodes.length,
      evidenceCoverage: round(evidenceCoverage),
      averageConfidence: round(averageConfidence),
      averageDisagreement: disagreements.length ? round(disagreements.reduce((sum, value) => sum + value, 0) / disagreements.length) : null,
      evaluatorCount: new Set(present.flatMap((observation) => observation.evaluators)).size,
      reliability: nodes.length < 2 ? 'insufficient' : 'provisional',
      limitations,
    },
  };
}

export function modelOrbitAttributeById(id: string) {
  return [...PARTICIPANT_ATTRIBUTES, ...TEMPORAL_ATTRIBUTES, ...INTERACTION_ATTRIBUTES].find((attribute) => attribute.id === id);
}

export function modelOrbitSubjectLabel(subject: ModelOrbitSubject) {
  return subject === 'human' ? 'Human' : subject === 'agent' ? 'Agent' : 'Interaction';
}
