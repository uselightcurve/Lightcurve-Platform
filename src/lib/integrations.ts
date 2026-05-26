export type ProviderId = 'vapi' | 'retell' | 'elevenlabs' | 'livekit' | 'pipecat' | 'custom_webrtc';

export type ProviderCapability =
  | 'sandbox-run'
  | 'human-pilot'
  | 'bot-to-bot-bridge'
  | 'low-cost-replay'
  | 'production-import'
  | 'recording-import'
  | 'prompt-recommendation';

export type ProviderDefinition = {
  id: ProviderId;
  name: string;
  tagline: string;
  env: string[];
  locatorLabel: string;
  locatorPlaceholder: string;
  capabilities: ProviderCapability[];
};

export type ProviderStatus = ProviderDefinition & {
  configured: boolean;
  missingEnv: string[];
};

export type NormalizedCall = {
  id: string;
  provider: ProviderId;
  externalCallId: string;
  agentId: string;
  scenarioName: string;
  language: string;
  domain: string;
  emotion: string;
  outcome: 'pass' | 'fail' | 'unknown';
  mos: number | null;
  taskCompletion: number | null;
  latencyP95Ms: number | null;
  audioUrl?: string;
  transcript: Array<{
    speaker: 'caller' | 'agent';
    text: string;
    latencyMs?: number;
  }>;
  failureSummary?: string;
  promptRecommendation?: string;
};

export const providerDefinitions: ProviderDefinition[] = [
  {
    id: 'vapi',
    name: 'Vapi',
    tagline: 'Bot-to-bot phone tests, hosted assistant calls, and production imports.',
    env: ['VAPI_API_KEY', 'VAPI_PHONE_NUMBER_ID'],
    locatorLabel: 'Assistant ID',
    locatorPlaceholder: 'asst_...',
    capabilities: ['sandbox-run', 'human-pilot', 'bot-to-bot-bridge', 'production-import', 'recording-import', 'prompt-recommendation'],
  },
  {
    id: 'retell',
    name: 'Retell',
    tagline: 'Agent calls, phone logs, and failure replay.',
    env: ['RETELL_API_KEY', 'RETELL_AGENT_ID'],
    locatorLabel: 'Agent ID',
    locatorPlaceholder: 'agent_...',
    capabilities: ['sandbox-run', 'human-pilot', 'bot-to-bot-bridge', 'production-import', 'recording-import', 'prompt-recommendation'],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    tagline: 'Conversational AI calls plus low-cost replay imports.',
    env: ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID'],
    locatorLabel: 'Agent ID',
    locatorPlaceholder: 'agent_...',
    capabilities: ['sandbox-run', 'human-pilot', 'low-cost-replay', 'bot-to-bot-bridge', 'production-import', 'recording-import', 'prompt-recommendation'],
  },
  {
    id: 'livekit',
    name: 'LiveKit',
    tagline: 'Realtime rooms, recordings, and runner bridges.',
    env: ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    locatorLabel: 'Runner endpoint',
    locatorPlaceholder: 'https://agent.example.com/lightcurve/run',
    capabilities: ['sandbox-run', 'bot-to-bot-bridge', 'production-import', 'recording-import'],
  },
  {
    id: 'pipecat',
    name: 'Pipecat',
    tagline: 'Custom Python voice pipelines behind your own endpoint.',
    env: ['PIPECAT_AGENT_URL', 'PIPECAT_AUTH_TOKEN'],
    locatorLabel: 'Runner endpoint',
    locatorPlaceholder: 'https://agent.example.com/pipecat',
    capabilities: ['sandbox-run', 'bot-to-bot-bridge', 'production-import', 'recording-import'],
  },
  {
    id: 'custom_webrtc',
    name: 'Custom WebRTC',
    tagline: 'Bring any HTTPS/WebRTC bridge without changing infra.',
    env: ['CUSTOM_WEBRTC_WSS_URL'],
    locatorLabel: 'Runner endpoint',
    locatorPlaceholder: 'https://agent.example.com/lightcurve/run',
    capabilities: ['sandbox-run', 'bot-to-bot-bridge', 'recording-import'],
  },
];

export const demoImportedCalls: NormalizedCall[] = [
  {
    id: 'call-retell-hinglish-001',
    provider: 'retell',
    externalCallId: 'retell_84dd2a',
    agentId: 'retell-routing-v1',
    scenarioName: 'plan_upgrade_hinglish',
    language: 'hi-IN',
    domain: 'telecom',
    emotion: 'neutral',
    outcome: 'fail',
    mos: 3.2,
    taskCompletion: 0.54,
    latencyP95Ms: 1910,
    failureSummary: 'Agent gave plan pricing in English only and missed the caller code-switching cue.',
    promptRecommendation: 'Add an instruction to mirror Hinglish when the caller code-switches and confirm price before benefits.',
    transcript: [
      { speaker: 'caller', text: 'Mujhe unlimited data plan chahiye, but price clear batao.' },
      { speaker: 'agent', text: 'We have several exciting unlimited plans. Would you like to hear all options?', latencyMs: 1320 },
      { speaker: 'caller', text: 'Price pehle batao, mujhe confusion nahi chahiye.' },
      { speaker: 'agent', text: 'The premium plan has many benefits including roaming and entertainment.', latencyMs: 1910 },
    ],
  },
  {
    id: 'call-vapi-refund-002',
    provider: 'vapi',
    externalCallId: 'call_92ab7c',
    agentId: 'prod-agent-v2',
    scenarioName: 'angry_refund_call',
    language: 'en-US',
    domain: 'ecommerce',
    emotion: 'angry',
    outcome: 'fail',
    mos: 3.5,
    taskCompletion: 0.61,
    latencyP95Ms: 1460,
    failureSummary: 'Agent repeated tracking status instead of offering a clear refund or escalation path.',
    promptRecommendation: 'When a delivery scan conflicts with caller report, acknowledge uncertainty and offer escalation before restating policy.',
    transcript: [
      { speaker: 'caller', text: 'I have already called twice. Where is my refund?' },
      { speaker: 'agent', text: 'The package shows delivered in our tracking system.', latencyMs: 940 },
      { speaker: 'caller', text: 'It was not delivered. Stop saying that.' },
      { speaker: 'agent', text: 'I understand, but our system still shows delivered.', latencyMs: 1460 },
    ],
  },
  {
    id: 'call-livekit-outage-003',
    provider: 'livekit',
    externalCallId: 'lk_room_7192',
    agentId: 'staging-agent-v3',
    scenarioName: 'internet_outage_credit',
    language: 'en-US',
    domain: 'telecom',
    emotion: 'frustrated',
    outcome: 'fail',
    mos: 3.1,
    taskCompletion: 0.48,
    latencyP95Ms: 2240,
    failureSummary: 'Latency spiked during outage lookup and the agent never confirmed credit eligibility.',
    promptRecommendation: 'Split outage diagnosis from billing credit, and give a short progress update before slow tool calls.',
    transcript: [
      { speaker: 'caller', text: 'My internet has been down for six hours. I work from home.' },
      { speaker: 'agent', text: 'Let me check your area. Please hold while I look that up.', latencyMs: 2240 },
      { speaker: 'caller', text: 'I need to know if I get credit for today.' },
      { speaker: 'agent', text: 'I am still checking the outage details.', latencyMs: 2100 },
    ],
  },
];

export function getProviderStatuses(): ProviderStatus[] {
  return providerDefinitions.map((provider) => {
    const missingEnv = provider.env.filter((name) => !process.env[name]);
    return {
      ...provider,
      configured: missingEnv.length === 0,
      missingEnv,
    };
  });
}

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return providerDefinitions.find((provider) => provider.id === id);
}

export function toScenarioCandidate(call: NormalizedCall) {
  return {
    name: `${call.scenarioName}_from_${call.provider}`,
    language: call.language,
    domain: call.domain,
    persona: {
      name: 'Imported caller',
      emotional_state: call.emotion,
      goal: call.failureSummary ?? 'Reproduce the production failure.',
      noise_db: 3,
      speed_wpm: 145,
      interrupts: call.emotion === 'angry' || call.emotion === 'frustrated',
      opening_line: call.transcript.find((turn) => turn.speaker === 'caller')?.text ?? 'I need help with my issue.',
    },
    successCriteria: [
      { type: 'task_completed', description: 'Agent resolves the original production failure path', weight: 0.45 },
      { type: 'tone_appropriate', description: 'Agent responds appropriately to caller emotion', weight: 0.25 },
      { type: 'latency_control', description: 'Agent avoids long unexplained pauses', weight: 0.15 },
      { type: 'no_hallucination', description: 'Agent does not invent policy, pricing, or account facts', weight: 0.15 },
    ],
    callerSeed: 91,
    source: {
      provider: call.provider,
      externalCallId: call.externalCallId,
      promptRecommendation: call.promptRecommendation,
    },
  };
}
