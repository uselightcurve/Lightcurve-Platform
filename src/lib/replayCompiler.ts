import { createHash } from 'node:crypto';

export type ExperimentPreset = 'quick' | 'release' | 'stress';

export type ReplayCompilerConfig = {
  preset?: ExperimentPreset;
  replayCount?: number;
  maxConcurrency?: number;
  seed?: number;
  judgePolicy?: 'flash-pro-review' | 'pro' | 'flash';
  environmentMix?: Record<string, number>;
};

export type ReplayCaseInput = {
  id: string;
  name: string;
  language: string;
  domain: string;
  behaviorGraph: unknown;
  riskWeight?: number | null;
  variationPolicy?: unknown;
  historicalFailureRate?: number;
};

export type ReplayManifest = {
  schema: 'lightcurve.replay_manifest.v2';
  caseId: string;
  caseName: string;
  variantIndex: number;
  seed: number;
  graphPath: string[];
  expectedOutcome: unknown;
  groundedFacts: unknown;
  constrainedValues: unknown;
  riskTags: string[];
  lexicalDirective: {
    form: string;
    discourse: string;
    stance: string;
    variant: number;
  };
  voice: { family: string; speakingRate: number; pitch: number };
  timing: { pauseScale: number; responseDelayMs: number; interruptionOffsetMs: number | null };
  environment: string;
  judgePolicy: 'flash-pro-review' | 'pro' | 'flash';
  impairment: ImpairmentProfile;
  variationPolicy: Record<string, unknown>;
  uniquenessSignature: string;
};

export type ImpairmentProfile = {
  id: string;
  label: string;
  server: {
    noiseCategory?: string;
    snrDb?: number;
    reverb?: number;
    gainDb?: number;
    clipping?: number;
    bandwidthHz?: number;
    codec?: string;
  };
  transport: {
    baseLatencyMs?: number;
    jitterMs?: number;
    packetLoss?: number;
    burstLoss?: number;
    reorderProbability?: number;
  };
};

export const EXPERIMENT_PRESETS: Record<ExperimentPreset, Required<Pick<ReplayCompilerConfig, 'replayCount' | 'maxConcurrency' | 'judgePolicy'>>> = {
  quick: { replayCount: 10, maxConcurrency: 3, judgePolicy: 'flash-pro-review' },
  release: { replayCount: 100, maxConcurrency: 20, judgePolicy: 'flash-pro-review' },
  stress: { replayCount: 500, maxConcurrency: 50, judgePolicy: 'flash-pro-review' },
};

export const DEFAULT_ENVIRONMENT_MIX: Record<string, number> = {
  clean: 20,
  office_cafe: 20,
  car_street: 15,
  latency_jitter: 15,
  packet_loss: 10,
  codec_bandwidth: 10,
  compound_stress: 10,
};

const profiles: Record<string, ImpairmentProfile> = {
  clean: { id: 'clean', label: 'Clean', server: {}, transport: {} },
  office_cafe: {
    id: 'office_cafe', label: 'Office / café',
    server: { noiseCategory: 'office_cafe', snrDb: 14, reverb: 0.12, gainDb: -1 }, transport: {},
  },
  car_street: {
    id: 'car_street', label: 'Car / street',
    server: { noiseCategory: 'car_street', snrDb: 9, reverb: 0.08, bandwidthHz: 12000 }, transport: { baseLatencyMs: 40, jitterMs: 12 },
  },
  latency_jitter: {
    id: 'latency_jitter', label: 'Latency / jitter',
    server: {}, transport: { baseLatencyMs: 220, jitterMs: 95, reorderProbability: 0.02 },
  },
  packet_loss: {
    id: 'packet_loss', label: 'Packet loss / dropouts',
    server: {}, transport: { baseLatencyMs: 80, jitterMs: 30, packetLoss: 0.045, burstLoss: 0.12 },
  },
  codec_bandwidth: {
    id: 'codec_bandwidth', label: 'Codec / bandwidth',
    server: { bandwidthHz: 3400, codec: 'narrowband', clipping: 0.02 }, transport: { baseLatencyMs: 70, jitterMs: 15 },
  },
  compound_stress: {
    id: 'compound_stress', label: 'Compound stress',
    server: { noiseCategory: 'compound', snrDb: 7, reverb: 0.2, gainDb: -3, clipping: 0.04, bandwidthHz: 4000, codec: 'narrowband' },
    transport: { baseLatencyMs: 300, jitterMs: 120, packetLoss: 0.065, burstLoss: 0.18, reorderProbability: 0.035 },
  },
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

export function normalizeReplayConfig(config: ReplayCompilerConfig = {}) {
  const preset = config.preset && EXPERIMENT_PRESETS[config.preset] ? config.preset : 'release';
  const defaults = EXPERIMENT_PRESETS[preset];
  const environmentMix = Object.fromEntries(
    Object.entries(config.environmentMix ?? DEFAULT_ENVIRONMENT_MIX)
      .filter(([key, weight]) => profiles[key] && Number(weight) > 0)
      .map(([key, weight]) => [key, Number(weight)]),
  );
  return {
    preset,
    replayCount: boundedInteger(config.replayCount, defaults.replayCount, 1, 5000),
    maxConcurrency: boundedInteger(config.maxConcurrency, defaults.maxConcurrency, 1, 200),
    seed: boundedInteger(config.seed, 20260620, 1, 2_147_483_647),
    judgePolicy: config.judgePolicy ?? defaults.judgePolicy,
    environmentMix: Object.keys(environmentMix).length ? environmentMix : DEFAULT_ENVIRONMENT_MIX,
  };
}

function pressurePointCount(graph: Record<string, unknown>) {
  return Array.isArray(graph.pressurePoints) ? graph.pressurePoints.length : 0;
}

export function allocateReplayCounts(cases: ReplayCaseInput[], requestedCount: number, seed: number) {
  if (!cases.length) return new Map<string, number>();
  const total = Math.max(requestedCount, cases.length);
  const counts = new Map(cases.map((item) => [item.id, 1]));
  const random = mulberry32(seed);
  const weighted = cases.map((item) => {
    const graph = object(item.behaviorGraph);
    const risk = Math.max(1, Number(item.riskWeight ?? 1));
    const failureBoost = 1 + Math.max(0, Math.min(1, item.historicalFailureRate ?? 0)) * 2;
    const pressureBoost = 1 + pressurePointCount(graph) * 0.2;
    return { item, weight: risk * failureBoost * pressureBoost, tie: random() };
  });
  for (let allocated = cases.length; allocated < total; allocated += 1) {
    const next = weighted.reduce((best, candidate) => {
      const score = candidate.weight / ((counts.get(candidate.item.id) ?? 0) + 0.75) + candidate.tie * 1e-6;
      const bestScore = best.weight / ((counts.get(best.item.id) ?? 0) + 0.75) + best.tie * 1e-6;
      return score > bestScore ? candidate : best;
    });
    counts.set(next.item.id, (counts.get(next.item.id) ?? 0) + 1);
  }
  return counts;
}

function environmentSequence(count: number, mix: Record<string, number>, seed: number) {
  const entries = Object.entries(mix);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const assigned = entries.map(([key, weight]) => {
    const exact = count * weight / totalWeight;
    return { key, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remainder = count - assigned.reduce((sum, item) => sum + item.count, 0);
  assigned.sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
  for (let index = 0; index < assigned.length && remainder > 0; index += 1, remainder -= 1) assigned[index].count += 1;
  const sequence = assigned.flatMap((item) => Array.from({ length: item.count }, () => item.key));
  const random = mulberry32(seed ^ 0x51f15e);
  for (let index = sequence.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [sequence[index], sequence[swap]] = [sequence[swap], sequence[index]];
  }
  return sequence;
}

function graphPaths(graph: Record<string, unknown>) {
  const configured = Array.isArray(graph.allowedPaths) ? graph.allowedPaths : [];
  const allowed = configured.flatMap((path) => Array.isArray(path)
    ? [path.filter((node): node is string => typeof node === 'string')]
    : []
  ).filter((path) => path.length);
  if (allowed.length) return allowed;
  const observed = Array.isArray(graph.observedPath) ? graph.observedPath : Array.isArray(graph.nodes) ? graph.nodes : [];
  const human = observed.map(object).filter((node) => node.speaker === 'human' && typeof node.id === 'string').map((node) => node.id as string);
  return human.length ? [human] : [[]];
}

function riskTags(graph: Record<string, unknown>, environment: string) {
  const tags = Array.isArray(graph.pressurePoints)
    ? graph.pressurePoints.slice(0, 4).map((item) => typeof item === 'string' ? item : String(object(item).name ?? object(item).type ?? 'pressure_point'))
    : [];
  return [...new Set([...tags, environment])];
}

export function compileReplayManifests(cases: ReplayCaseInput[], rawConfig: ReplayCompilerConfig = {}) {
  if (!cases.length) throw new Error('At least one approved Dataset Case is required.');
  const config = normalizeReplayConfig(rawConfig);
  const replayCount = Math.max(config.replayCount, cases.length);
  const allocations = allocateReplayCounts(cases, replayCount, config.seed);
  const environments = environmentSequence(replayCount, config.environmentMix, config.seed);
  const forms = ['direct', 'question', 'clarification', 'correction', 'compressed', 'hesitant', 'multi_clause'];
  const discourses = ['plain', 'self_repair', 'context_first', 'request_first', 'confirm_then_ask', 'contrastive'];
  const stances = ['neutral', 'urgent', 'skeptical', 'frustrated', 'polite', 'uncertain'];
  const voices = ['neutral-a', 'neutral-b', 'warm-a', 'firm-a', 'conversational-a', 'conversational-b'];
  const manifests: ReplayManifest[] = [];
  let globalIndex = 0;
  for (const item of cases) {
    const graph = object(item.behaviorGraph);
    const policy = object(item.variationPolicy);
    const configuredEnvironments = Array.isArray(policy.environmentProfiles)
      ? policy.environmentProfiles.filter((value): value is string => typeof value === 'string' && Boolean(profiles[value]))
      : [];
    const allowedEnvironments = configuredEnvironments.length ? configuredEnvironments : Object.keys(config.environmentMix);
    const paths = graphPaths(graph);
    const count = allocations.get(item.id) ?? 1;
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      const variantSeed = (config.seed + globalIndex * 104729 + localIndex * 8191) >>> 0;
      const random = mulberry32(variantSeed);
      const requestedEnvironment = environments[globalIndex] ?? 'clean';
      const environment = allowedEnvironments.includes(requestedEnvironment)
        ? requestedEnvironment
        : allowedEnvironments[(globalIndex + localIndex) % allowedEnvironments.length] ?? 'clean';
      const lexicalDirective = {
        form: forms[(globalIndex + localIndex) % forms.length],
        discourse: discourses[(globalIndex * 3 + localIndex) % discourses.length],
        stance: stances[(globalIndex * 5 + localIndex) % stances.length],
        variant: Math.floor(random() * 1_000_000),
      };
      const voice = {
        family: voices[(globalIndex * 7 + localIndex) % voices.length],
        speakingRate: Number((0.82 + random() * 0.38).toFixed(3)),
        pitch: Number((-2.5 + random() * 5).toFixed(2)),
      };
      const timing = {
        pauseScale: Number((0.7 + random() * 0.9).toFixed(3)),
        responseDelayMs: Math.round(80 + random() * 950),
        interruptionOffsetMs: random() < 0.28 ? Math.round(120 + random() * 1200) : null,
      };
      const manifestWithoutSignature = {
        schema: 'lightcurve.replay_manifest.v2' as const,
        caseId: item.id,
        caseName: item.name,
        variantIndex: globalIndex,
        seed: variantSeed,
        graphPath: paths[(localIndex + Math.floor(random() * paths.length)) % paths.length],
        expectedOutcome: graph.terminalOutcome ?? graph.terminalOutcomes ?? 'approved_outcome',
        groundedFacts: graph.facts ?? graph.groundedFacts ?? [],
        constrainedValues: graph.slots ?? graph.constrainedValues ?? {},
        riskTags: riskTags(graph, environment),
        lexicalDirective,
        voice,
        timing,
        environment,
        judgePolicy: config.judgePolicy,
        impairment: profiles[environment] ?? profiles.clean,
        variationPolicy: policy,
      };
      manifests.push({ ...manifestWithoutSignature, uniquenessSignature: hash(manifestWithoutSignature) });
      globalIndex += 1;
    }
  }
  const signatures = new Set(manifests.map((manifest) => manifest.uniquenessSignature));
  if (signatures.size !== manifests.length) throw new Error('Replay compiler produced a duplicate manifest.');
  return { config: { ...config, replayCount }, manifests };
}

export function getImpairmentProfile(id: string) {
  return profiles[id] ?? profiles.clean;
}

export function listImpairmentProfiles() {
  return Object.values(profiles);
}
