import { createHash } from 'node:crypto';

type ObjectValue = Record<string, unknown>;

export type TemporalScenarioTurn = {
  nodeId: string;
  speaker: 'human' | 'agent';
  intentOrResponseClass: string;
  targetStartMs: number | null;
  targetDurationMs: number | null;
  pauseBeforeMs: number | null;
  interruption: boolean;
  emotion: string;
};

export type TemporalScenarioClone = {
  schema: 'lightcurve.temporal_scenario.v1';
  mode: 'human_scenario_clone';
  sourceFingerprint: string;
  humanGoal: unknown;
  persona: {
    accent: string | null;
    dialect: string | null;
    speakingStyle: string;
    emotionalArc: string[];
  };
  turns: TemporalScenarioTurn[];
  temporalProfile: {
    averageTurnMs: number | null;
    averagePauseMs: number | null;
    pauseScale: number;
    responseDelayMs: number;
    interruptionOffsetMs: number | null;
  };
  voiceClone: {
    enabled: boolean;
    provider: 'chatterbox' | 'none';
    referenceAudioUri?: string;
    consentVerified: boolean;
  };
};

function object(value: unknown): ObjectValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value != null && value >= 0);
  return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function emotionForNode(node: ObjectValue, index: number, graph: ObjectValue) {
  const explicit = stringValue(node.emotion) || stringValue(node.stance) || stringValue(node.state);
  if (explicit) return explicit;
  const profile = object(graph.temporalProfile);
  const arc = Array.isArray(profile.emotionalArc) ? profile.emotionalArc.filter((value): value is string => typeof value === 'string') : [];
  return arc[index] || 'neutral';
}

export function compileTemporalScenario(params: {
  graph: unknown;
  provenance?: unknown;
  variationPolicy?: unknown;
  timing: { pauseScale: number; responseDelayMs: number; interruptionOffsetMs: number | null };
  graphPath: string[];
}) : TemporalScenarioClone {
  const graph = object(params.graph);
  const provenance = object(params.provenance);
  const policy = object(params.variationPolicy);
  const sourceNodes = Array.isArray(graph.observedPath) ? graph.observedPath : Array.isArray(graph.nodes) ? graph.nodes : [];
  const nodes = sourceNodes.map(object).filter((node) => typeof node.id === 'string');
  const path = new Set(params.graphPath);
  const selected = nodes.filter((node) => node.speaker === 'agent' || path.size === 0 || path.has(String(node.id)));
  const turns = selected.map((node, index): TemporalScenarioTurn => {
    const startedAtMs = finite(node.startedAtMs);
    const endedAtMs = finite(node.endedAtMs);
    const previousEnd = index > 0 ? finite(selected[index - 1].endedAtMs) : null;
    return {
      nodeId: String(node.id),
      speaker: node.speaker === 'agent' ? 'agent' : 'human',
      intentOrResponseClass: stringValue(node.intentOrResponseClass) || stringValue(node.intent) || stringValue(node.state) || 'observed_turn',
      targetStartMs: startedAtMs,
      targetDurationMs: startedAtMs != null && endedAtMs != null ? Math.max(0, endedAtMs - startedAtMs) : null,
      pauseBeforeMs: startedAtMs != null && previousEnd != null ? Math.max(0, startedAtMs - previousEnd) : null,
      interruption: previousEnd != null && startedAtMs != null && startedAtMs < previousEnd,
      emotion: emotionForNode(node, index, graph),
    };
  });
  const callerProfile = object(provenance.callerProfile ?? graph.callerProfile);
  const emotionalArc = turns.filter((turn) => turn.speaker === 'human').map((turn) => turn.emotion);
  const referenceAudioUri = stringValue(provenance.voiceReferenceUri);
  const consentVerified = provenance.voiceCloneConsent === true;
  const enabled = policy.allowVoiceCloning === true
    && consentVerified
    && Boolean(referenceAudioUri?.startsWith('azblob://') || referenceAudioUri?.startsWith('local://'));
  const fingerprint = createHash('sha256').update(JSON.stringify({
    nodes: turns.map((turn) => [turn.nodeId, turn.speaker, turn.intentOrResponseClass, turn.targetStartMs, turn.targetDurationMs]),
    goal: graph.humanGoal,
  })).digest('hex');

  return {
    schema: 'lightcurve.temporal_scenario.v1',
    mode: 'human_scenario_clone',
    sourceFingerprint: fingerprint,
    humanGoal: graph.humanGoal ?? graph.goal ?? 'preserve_observed_goal',
    persona: {
      accent: stringValue(callerProfile.accent),
      dialect: stringValue(callerProfile.dialect),
      speakingStyle: stringValue(callerProfile.speakingStyle) || 'preserve observed conversational style',
      emotionalArc: emotionalArc.length ? emotionalArc : ['neutral'],
    },
    turns,
    temporalProfile: {
      averageTurnMs: mean(turns.map((turn) => turn.targetDurationMs)),
      averagePauseMs: mean(turns.map((turn) => turn.pauseBeforeMs)),
      pauseScale: params.timing.pauseScale,
      responseDelayMs: params.timing.responseDelayMs,
      interruptionOffsetMs: params.timing.interruptionOffsetMs,
    },
    voiceClone: {
      enabled,
      provider: enabled ? 'chatterbox' : 'none',
      ...(enabled && referenceAudioUri ? { referenceAudioUri } : {}),
      consentVerified,
    },
  };
}

