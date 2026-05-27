import importedSeeds from '@/data/real-scenario-seeds.json';
import { seedToScenario, type DatasetScenarioSeed } from './datasetScenarios';
import type { PronunciationSpec } from './pronunciation';

export type LibraryScenario = {
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

const personaNames: Record<string, string[]> = {
  ecommerce: ['Jordan', 'Maya', 'Dev', 'Nora', 'Sam'],
  banking: ['Priya', 'Elliot', 'Rohan', 'Nina', 'Marcus'],
  telecom: ['Rahul', 'Kevin', 'Aarav', 'Meera', 'Owen'],
  healthcare: ['Elena', 'Carlos', 'Anika', 'Leah', 'Noah'],
  general: ['Taylor', 'Alex', 'Riley', 'Casey', 'Jamie'],
};

function formatScenarioName(seed: DatasetScenarioSeed, index: number) {
  const label = seed.intent.replace(/_/g, ' ');
  const suffix = (index + 1).toString().padStart(3, '0');
  return `${label} ${suffix}`;
}

function personaName(domain: string, index: number) {
  const names = personaNames[domain] ?? personaNames.general;
  return names[index % names.length];
}

function deterministicUuid(value: string) {
  let hash = 2166136261;
  let hex = '';
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
    hex += (hash >>> 0).toString(16).padStart(8, '0');
    if (hex.length >= 32) break;
  }
  hex = (hex + '0'.repeat(32)).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const REAL_SCENARIO_LIBRARY: LibraryScenario[] = (importedSeeds as DatasetScenarioSeed[]).map((seed, index) => {
  const scenario = seedToScenario(seed);
  return {
    id: deterministicUuid(`lightcurve:${seed.id}:${seed.intent}:${index}`),
    name: formatScenarioName(seed, index),
    language: scenario.language,
    domain: scenario.domain,
    persona: {
      name: personaName(scenario.domain, index),
      age: 28 + (index % 33),
      accent: scenario.persona.accent,
      emotional_state: scenario.persona.emotional_state,
      goal: scenario.persona.goal,
      noise_db: scenario.persona.noise_db,
      speed_wpm: scenario.persona.speed_wpm,
      interrupts: scenario.persona.interrupts,
      opening_line: scenario.persona.opening_line,
      code_switching: scenario.persona.code_switching,
    },
    successCriteria: scenario.successCriteria,
    callerSeed: 1000 + index,
    isPreset: true,
    source: {
      provider: seed.source.provider,
      dataset: seed.source.dataset,
    },
  };
});

export function mergeWithRealScenarioLibrary(stored: LibraryScenario[] | undefined | null) {
  const storedItems = stored ?? [];
  const customItems = storedItems.filter((scenario) => {
    return !scenario.isPreset || scenario.id.startsWith('custom-') || scenario.id.startsWith('dataset-');
  });
  const dedupedCustomItems = customItems.filter((scenario, index, items) => {
    return items.findIndex((candidate) => candidate.id === scenario.id) === index;
  });
  const customIds = new Set(dedupedCustomItems.map((scenario) => scenario.id));
  return [
    ...dedupedCustomItems,
    ...REAL_SCENARIO_LIBRARY.filter((scenario) => !customIds.has(scenario.id)),
  ];
}
