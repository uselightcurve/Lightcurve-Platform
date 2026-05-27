export type PronunciationEntityType = 'email' | 'phone_number';
export type PronunciationMode = 'normal' | 'spell_out' | 'grouped' | 'correction';
export type PronunciationPace = 'slow' | 'normal' | 'fast';

export type PronunciationSpec = {
  entityType: PronunciationEntityType;
  targetValue: string;
  spokenForms: string[];
  accent: string;
  pace: PronunciationPace;
  mode: PronunciationMode;
  correctionLine?: string;
  expectedConfirmation: string;
};

export type PronunciationTrace = {
  speaker: 'caller' | 'agent';
  text: string;
  latencyMs?: number;
  totalLatencyMs?: number;
};

export type PronunciationScore = {
  metricName:
    | 'capture_exact_match'
    | 'capture_confirmation'
    | 'capture_integrity'
    | 'capture_correction'
    | 'pace_stability'
    | 'capture_overall';
  value: number;
  rationale: string;
};

export type PronunciationReport = {
  expectedValue: string;
  capturedValue: string | null;
  confirmedValue: string | null;
  spokenForm: string;
  entityType: PronunciationEntityType;
  mode: PronunciationMode;
  accent: string;
  pace: PronunciationPace;
  segments: Array<{ label: string; value: number; pass: boolean; rationale: string }>;
  evidence: string;
  pacing: {
    beforeWpm: number;
    duringWpm: number;
    afterWpm: number;
    driftPercent: number;
  };
};

export const PRONUNCIATION_PRESETS: Record<PronunciationEntityType, string[]> = {
  email: [
    'john.smith@gmail.com',
    'a.kumar+billing@company.co.in',
    'm.n-s_f42@support-mail.co',
  ],
  phone_number: [
    '+1 216 474 8341',
    '+91 98765 43210',
    '+1 800 555 0007',
    '+1 415 555 0199 ext 42',
  ],
};

const WORDS_BY_SYMBOL: Record<string, string> = {
  '.': 'dot',
  '-': 'dash',
  '_': 'underscore',
  '+': 'plus',
  '@': 'at',
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function words(value: string) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function entityLabel(entityType: PronunciationEntityType) {
  return entityType === 'email' ? 'Email' : 'Phone number';
}

export function spokenFormForValue(entityType: PronunciationEntityType, value: string, mode: PronunciationMode) {
  if (entityType === 'email') return spokenEmail(value, mode);
  return spokenPhone(value, mode);
}

function spokenEmail(value: string, mode: PronunciationMode) {
  const lower = value.trim().toLowerCase();
  const verbalized = lower
    .split('')
    .map((char) => WORDS_BY_SYMBOL[char] ?? char)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (mode === 'spell_out') return verbalized;
  if (mode === 'correction') return `Actually, correction. The email is ${verbalized}.`;
  return lower
    .replace(/@/g, ' at ')
    .replace(/\./g, ' dot ')
    .replace(/\+/g, ' plus ')
    .replace(/-/g, ' dash ')
    .replace(/_/g, ' underscore ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenPhone(value: string, mode: PronunciationMode) {
  const ext = value.match(/\b(?:ext|extension)\s*(\d+)/i)?.[1];
  const clean = value.replace(/\b(?:ext|extension)\s*\d+/i, '').trim();
  const digitGroups = clean
    .replace(/^\+/, 'plus ')
    .replace(/[().-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (mode === 'spell_out') {
    const digits = value.replace(/\D/g, '').split('').join(' ');
    return ext ? `${digits}, extension ${ext.split('').join(' ')}` : digits;
  }

  if (mode === 'correction') {
    return `Sorry, correction. The number is ${digitGroups}${ext ? `, extension ${ext}` : ''}.`;
  }

  return `${digitGroups}${ext ? `, extension ${ext}` : ''}`;
}

export function createPronunciationSpec(input: {
  entityType: PronunciationEntityType;
  targetValue: string;
  accent: string;
  pace: PronunciationPace;
  mode: PronunciationMode;
}): PronunciationSpec {
  const targetValue = input.targetValue.trim();
  const spoken = spokenFormForValue(input.entityType, targetValue, input.mode);
  return {
    ...input,
    targetValue,
    spokenForms: [spoken],
    correctionLine: input.mode === 'correction' ? spoken : undefined,
    expectedConfirmation:
      input.entityType === 'email'
        ? `Read back and confirm the email exactly as ${targetValue}.`
        : `Read back and confirm the phone number exactly as ${targetValue}.`,
  };
}

export function buildPronunciationScenario<T extends {
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
  source?: Record<string, unknown>;
}>(baseScenario: T, spec: PronunciationSpec): T & { pronunciation: PronunciationSpec; parentName: string } {
  const label = spec.entityType === 'email' ? 'email_capture' : 'phone_number_capture';
  const spoken = spec.spokenForms[0] ?? spokenFormForValue(spec.entityType, spec.targetValue, spec.mode);
  return {
    ...baseScenario,
    id: `${label}-${stableHash(`${baseScenario.id}:${spec.entityType}:${spec.targetValue}:${spec.accent}:${spec.pace}:${spec.mode}`)}`,
    name: `${label}_${stableHash(spec.targetValue).slice(0, 5)}`,
    parentName: baseScenario.name,
    isPreset: false,
    persona: {
      ...baseScenario.persona,
      accent: spec.accent,
      speed_wpm: spec.pace === 'slow' ? 96 : spec.pace === 'fast' ? 178 : 132,
      goal:
        spec.entityType === 'email'
          ? `Update and verify the customer email ${spec.targetValue}.`
          : `Update and verify the customer phone number ${spec.targetValue}.`,
      opening_line:
        spec.entityType === 'email'
          ? `Please update my email. It is ${spoken}.`
          : `Please update my phone number. It is ${spoken}.`,
    },
    successCriteria: [
      { type: 'capture_exact_match', description: `Captured ${entityLabel(spec.entityType).toLowerCase()} exactly`, weight: 0.35 },
      { type: 'capture_confirmation', description: 'Agent read back the value correctly before moving on', weight: 0.25 },
      { type: 'capture_integrity', description: 'No skipped, inserted, or swapped characters/digits', weight: 0.2 },
      { type: 'pace_stability', description: 'Agent pace stays stable while confirming the value', weight: 0.2 },
    ],
    source: {
      ...(baseScenario.source ?? {}),
      provider: 'lightcurve-pronunciation-sandbox',
    },
    pronunciation: spec,
  };
}

function normalizeEmailCandidate(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+dash\s+/g, '-')
    .replace(/\s+hyphen\s+/g, '-')
    .replace(/\s+underscore\s+/g, '_')
    .replace(/\s+plus\s+/g, '+')
    .replace(/\s+/g, '')
    .replace(/,+$/g, '');
}

function emailCandidates(text: string) {
  const converted = normalizeEmailCandidate(` ${text} `);
  return converted.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
}

function normalizePhoneCandidate(value: string) {
  const extMatch = value.match(/\b(?:ext|extension)\s*(\d+)/i);
  const ext = extMatch?.[1] ?? '';
  const withoutExt = value.replace(/\b(?:ext|extension)\s*\d+/i, '');
  return `${withoutExt.replace(/\D/g, '')}${ext ? `x${ext}` : ''}`;
}

function phoneCandidates(text: string) {
  const matches = text.match(/(?:\+?\d[\d\s().-]{7,}\d)(?:\s*(?:ext|extension)\s*\d+)?/gi) ?? [];
  return matches.map(normalizePhoneCandidate).filter((candidate) => candidate.length >= 8);
}

function levenshtein(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const insert = previous[j] + 1;
      const deleteCost = previous[j - 1] + 1;
      const replace = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      diagonal = previous[j];
      previous[j] = Math.min(insert, deleteCost, replace);
    }
  }
  return previous[b.length];
}

function similarity(expected: string, candidate: string | null) {
  if (!candidate) return 0;
  if (!expected && !candidate) return 1;
  return Math.max(0, 1 - levenshtein(expected, candidate) / Math.max(expected.length, candidate.length, 1));
}

function normalizedExpected(spec: PronunciationSpec) {
  return spec.entityType === 'email'
    ? normalizeEmailCandidate(spec.targetValue)
    : normalizePhoneCandidate(spec.targetValue);
}

function extractCandidates(spec: PronunciationSpec, text: string) {
  return spec.entityType === 'email' ? emailCandidates(text) : phoneCandidates(text);
}

function bestCandidate(expected: string, candidates: string[]) {
  return candidates
    .map((candidate) => ({ candidate, score: similarity(expected, candidate) }))
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function estimatedWpm(turns: PronunciationTrace[]) {
  const wordCount = turns.reduce((sum, turn) => sum + words(turn.text).length, 0);
  const latency = turns.reduce((sum, turn) => sum + (turn.totalLatencyMs ?? turn.latencyMs ?? 900), 0);
  return Math.round((wordCount / Math.max(latency, 1)) * 60000);
}

function pacingScore(spec: PronunciationSpec, traces: PronunciationTrace[]) {
  const agentTurns = traces.filter((trace) => trace.speaker === 'agent');
  const during = agentTurns.filter((trace) => extractCandidates(spec, trace.text).length > 0);
  const before = agentTurns.slice(0, Math.max(1, agentTurns.findIndex((trace) => during.includes(trace))));
  const after = agentTurns.slice(Math.max(0, agentTurns.findIndex((trace) => during.includes(trace)) + 1));
  const beforeWpm = estimatedWpm(before.length ? before : agentTurns.slice(0, 1));
  const duringWpm = estimatedWpm(during.length ? during : agentTurns);
  const afterWpm = estimatedWpm(after.length ? after : agentTurns.slice(-1));
  const baseline = Math.max(1, (beforeWpm + afterWpm) / 2);
  const driftPercent = Math.round(Math.abs(duringWpm - baseline) / baseline * 100);
  const allowed = spec.pace === 'fast' ? 38 : spec.pace === 'slow' ? 24 : 30;
  const score = Math.max(0.35, Math.min(1, 1 - Math.max(0, driftPercent - allowed) / 100));
  return { beforeWpm, duringWpm, afterWpm, driftPercent, score: Number(score.toFixed(2)) };
}

export function buildPronunciationReport(spec: PronunciationSpec, traces: PronunciationTrace[]): PronunciationReport {
  const expected = normalizedExpected(spec);
  const agentText = traces.filter((trace) => trace.speaker === 'agent').map((trace) => trace.text).join(' ');
  const candidates = extractCandidates(spec, agentText);
  const best = bestCandidate(expected, candidates);
  const capturedValue = best?.candidate ?? null;
  const exactValue = capturedValue === expected ? 1 : 0;
  const integrity = Number((best?.score ?? 0).toFixed(2));
  const confirmation = exactValue;
  const correction = spec.mode === 'correction' ? exactValue : 1;
  const pacing = pacingScore(spec, traces);
  const overall = Number(((exactValue * 0.3) + (confirmation * 0.25) + (integrity * 0.2) + (correction * 0.1) + (pacing.score * 0.15)).toFixed(2));

  return {
    expectedValue: spec.targetValue,
    capturedValue,
    confirmedValue: confirmation ? spec.targetValue : capturedValue,
    spokenForm: spec.spokenForms[0] ?? spokenFormForValue(spec.entityType, spec.targetValue, spec.mode),
    entityType: spec.entityType,
    mode: spec.mode,
    accent: spec.accent,
    pace: spec.pace,
    evidence: agentText || 'No agent transcript available.',
    pacing,
    segments: [
      {
        label: 'Exact value',
        value: exactValue,
        pass: exactValue === 1,
        rationale: exactValue === 1 ? 'The agent captured the exact normalized value.' : 'The confirmed value did not exactly match.',
      },
      {
        label: 'Readback',
        value: confirmation,
        pass: confirmation === 1,
        rationale: confirmation === 1 ? 'The agent read the value back correctly.' : 'No correct readback was found in agent turns.',
      },
      {
        label: 'Character integrity',
        value: integrity,
        pass: integrity >= 0.95,
        rationale: integrity >= 0.95 ? 'No skipped or inserted characters/digits detected.' : 'The closest captured value differs from expected.',
      },
      {
        label: 'Correction handling',
        value: correction,
        pass: correction === 1,
        rationale: spec.mode === 'correction' ? 'The final corrected value was used.' : 'No correction was required.',
      },
      {
        label: 'Pacing stability',
        value: pacing.score,
        pass: pacing.score >= 0.8,
        rationale: `${pacing.driftPercent}% estimated WPM drift during the value readback.`,
      },
      {
        label: 'Overall capture',
        value: overall,
        pass: overall >= 0.8,
        rationale: overall >= 0.8 ? 'Capture is production-ready for this scenario.' : 'Capture needs prompt or flow changes.',
      },
    ],
  };
}

export function scorePronunciationCapture(spec: PronunciationSpec, traces: PronunciationTrace[]): PronunciationScore[] {
  const report = buildPronunciationReport(spec, traces);
  return [
    { metricName: 'capture_exact_match', value: report.segments[0].value, rationale: report.segments[0].rationale },
    { metricName: 'capture_confirmation', value: report.segments[1].value, rationale: report.segments[1].rationale },
    { metricName: 'capture_integrity', value: report.segments[2].value, rationale: report.segments[2].rationale },
    { metricName: 'capture_correction', value: report.segments[3].value, rationale: report.segments[3].rationale },
    { metricName: 'pace_stability', value: report.segments[4].value, rationale: report.segments[4].rationale },
    { metricName: 'capture_overall', value: report.segments[5].value, rationale: report.segments[5].rationale },
  ];
}
