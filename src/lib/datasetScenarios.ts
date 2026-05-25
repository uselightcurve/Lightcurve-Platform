export type DatasetScenarioSeed = {
  id: string;
  source: {
    provider: 'huggingface' | 'csv' | 'json' | 'manual';
    dataset: string;
    license: string;
    rowId?: string;
  };
  intent: string;
  domain: string;
  language: string;
  emotion: string;
  goal: string;
  openingLine: string;
  expectedOutcome: string;
  voiceModifiers: {
    noiseDb: number;
    speedWpm: number;
    interrupts: boolean;
    codeSwitching: boolean;
    accent: string;
  };
  confidence: number;
  reviewStatus: 'needs-review' | 'approved' | 'rejected';
};

export type ScenarioImportInput = {
  provider?: DatasetScenarioSeed['source']['provider'];
  dataset?: string;
  license?: string;
  rows?: Array<{
    id?: string;
    text?: string;
    intent?: string;
    domain?: string;
    language?: string;
    emotion?: string;
    expectedOutcome?: string;
  }>;
};

const emotionHints = [
  ['angry', ['angry', 'furious', 'refund', 'complaint', 'wrong charge']],
  ['frustrated', ['again', 'waiting', 'not working', 'outage', 'cancel']],
  ['confused', ['confused', 'understand', 'help me', 'lost']],
  ['urgent', ['urgent', 'today', 'emergency', 'immediately']],
  ['nervous', ['fraud', 'suspicious', 'stolen', 'worried']],
] as const;

const domainHints = [
  ['telecom', ['plan', 'data', 'internet', 'outage', 'phone bill', 'sim']],
  ['banking', ['card', 'charge', 'fraud', 'account', 'transaction']],
  ['healthcare', ['appointment', 'doctor', 'clinic', 'symptom', 'medicine']],
  ['ecommerce', ['refund', 'order', 'delivery', 'package', 'return']],
] as const;

export const demoDatasetSeeds: DatasetScenarioSeed[] = [
  {
    id: 'seed-hf-refund-001',
    source: { provider: 'huggingface', dataset: 'customer-support-intents', license: 'review-required', rowId: 'demo-001' },
    intent: 'refund_missing_delivery',
    domain: 'ecommerce',
    language: 'en-US',
    emotion: 'angry',
    goal: 'Get a refund for an order marked delivered but never received.',
    openingLine: 'Your tracking says delivered, but I never got my package.',
    expectedOutcome: 'Agent confirms uncertainty, opens a missing-package path, and explains refund escalation.',
    voiceModifiers: { noiseDb: 4, speedWpm: 164, interrupts: true, codeSwitching: false, accent: 'US' },
    confidence: 0.86,
    reviewStatus: 'needs-review',
  },
  {
    id: 'seed-hf-plan-002',
    source: { provider: 'huggingface', dataset: 'multilingual-service-dialogs', license: 'review-required', rowId: 'demo-002' },
    intent: 'plan_upgrade_price',
    domain: 'telecom',
    language: 'hi-IN',
    emotion: 'frustrated',
    goal: 'Upgrade to a higher data plan while forcing the agent to explain price clearly in Hinglish.',
    openingLine: 'Mujhe data upgrade karna hai, but hidden charges nahi chahiye.',
    expectedOutcome: 'Agent mirrors Hinglish, gives exact price, and confirms plan change only after consent.',
    voiceModifiers: { noiseDb: 5, speedWpm: 148, interrupts: false, codeSwitching: true, accent: 'Hindi' },
    confidence: 0.82,
    reviewStatus: 'needs-review',
  },
  {
    id: 'seed-hf-fraud-003',
    source: { provider: 'huggingface', dataset: 'banking77-style-intents', license: 'review-required', rowId: 'demo-003' },
    intent: 'card_fraud_dispute',
    domain: 'banking',
    language: 'en-GB',
    emotion: 'nervous',
    goal: 'Dispute an unknown card charge and secure the account without getting false guarantees.',
    openingLine: 'There is a transaction on my card that I definitely did not make.',
    expectedOutcome: 'Agent starts the dispute path, asks safe verification questions, and avoids invented refund timelines.',
    voiceModifiers: { noiseDb: 2, speedWpm: 132, interrupts: false, codeSwitching: false, accent: 'British' },
    confidence: 0.9,
    reviewStatus: 'needs-review',
  },
];

function inferFromText(text: string) {
  const lower = text.toLowerCase();
  const domain = domainHints.find(([, hints]) => hints.some((hint) => lower.includes(hint)))?.[0] ?? 'general';
  const emotion = emotionHints.find(([, hints]) => hints.some((hint) => lower.includes(hint)))?.[0] ?? 'neutral';

  return { domain, emotion };
}

export function normalizeDatasetRows(input: ScenarioImportInput): DatasetScenarioSeed[] {
  if (!input.rows?.length) return demoDatasetSeeds;

  return input.rows.map((row, index) => {
    const text = row.text ?? row.intent ?? 'Customer needs help with a support issue.';
    const inferred = inferFromText(text);
    const language = row.language ?? 'en-US';
    const emotion = row.emotion ?? inferred.emotion;
    const domain = row.domain ?? inferred.domain;

    return {
      id: `seed-${input.provider ?? 'manual'}-${row.id ?? index}`,
      source: {
        provider: input.provider ?? 'manual',
        dataset: input.dataset ?? 'custom-upload',
        license: input.license ?? 'review-required',
        rowId: row.id,
      },
      intent: row.intent ?? text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48),
      domain,
      language,
      emotion,
      goal: text,
      openingLine: text,
      expectedOutcome: row.expectedOutcome ?? 'Agent completes the customer goal without hallucinating policy or account details.',
      voiceModifiers: {
        noiseDb: emotion === 'angry' || emotion === 'frustrated' ? 5 : 2,
        speedWpm: emotion === 'angry' ? 166 : 140,
        interrupts: emotion === 'angry' || emotion === 'frustrated',
        codeSwitching: language === 'hi-IN',
        accent: language.split('-')[1] ?? language,
      },
      confidence: 0.72,
      reviewStatus: 'needs-review',
    };
  });
}

export function seedToScenario(seed: DatasetScenarioSeed) {
  return {
    name: seed.intent,
    language: seed.language,
    domain: seed.domain,
    persona: {
      name: 'Dataset caller',
      accent: seed.voiceModifiers.accent,
      emotional_state: seed.emotion,
      goal: seed.goal,
      noise_db: seed.voiceModifiers.noiseDb,
      speed_wpm: seed.voiceModifiers.speedWpm,
      interrupts: seed.voiceModifiers.interrupts,
      code_switching: seed.voiceModifiers.codeSwitching,
      opening_line: seed.openingLine,
    },
    successCriteria: [
      { type: 'task_completed', description: seed.expectedOutcome, weight: 0.5 },
      { type: 'tone_appropriate', description: `Agent handles ${seed.emotion} caller state naturally`, weight: 0.2 },
      { type: 'language_match', description: `Agent responds appropriately in ${seed.language}`, weight: 0.15 },
      { type: 'no_hallucination', description: 'Agent does not invent unavailable facts', weight: 0.15 },
    ],
    callerSeed: 77,
    isPreset: false,
    source: seed.source,
  };
}
