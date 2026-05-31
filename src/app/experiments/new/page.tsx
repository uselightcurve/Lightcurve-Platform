'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProviderLogo } from '@/components/ProviderLogo';
import { providerDefinitions } from '@/lib/integrations';
import { REAL_SCENARIO_LIBRARY, mergeWithRealScenarioLibrary } from '@/lib/realScenarioLibrary';
import { trackLightcurveEvent } from '@/lib/clientAnalytics';
import { COST_LANES, costLaneForProvider } from '@/lib/costLanes';

type StoredScenario = typeof REAL_SCENARIO_LIBRARY[number];

const AGENT_TYPES = providerDefinitions.map((provider) => ({
  id: provider.id,
  label: provider.id === 'livekit' ? 'Lightcurve room' : provider.name,
  detail: provider.tagline,
  placeholder: provider.locatorPlaceholder,
  locatorLabel: provider.locatorLabel,
}));

const LIVE_PROVIDER_IDS = ['vapi', 'retell', 'elevenlabs'];
const BOT_TO_BOT_PROVIDER_IDS = ['livekit', 'pipecat', 'custom_webrtc'];
const STUB_PROVIDER_ID = 'stub_agent';
const MAX_REAL_PHONE_SCENARIOS = 10;

function isLiveProvider(provider: string) {
  return LIVE_PROVIDER_IDS.includes(provider);
}

function isBotToBotProvider(provider: string) {
  return BOT_TO_BOT_PROVIDER_IDS.includes(provider);
}

const steps = [
  { id: 1, label: 'Agent' },
  { id: 2, label: 'Callers' },
  { id: 3, label: 'Gate' },
];

const EMOTION_STYLES: Record<string, string> = {
  angry: 'bg-slate-100 text-slate-700 ring-slate-200',
  irate: 'bg-slate-100 text-slate-700 ring-slate-200',
  frustrated: 'bg-slate-100 text-slate-700 ring-slate-200',
  urgent: 'bg-slate-100 text-slate-700 ring-slate-200',
  nervous: 'bg-slate-100 text-slate-700 ring-slate-200',
  confused: 'bg-slate-100 text-slate-700 ring-slate-200',
  calm: 'bg-slate-100 text-slate-700 ring-slate-200',
  neutral: 'bg-slate-50 text-slate-600 ring-slate-200',
};

function formatName(name: string) {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function looksLikePhoneNumber(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 8 && /^[+\d\s().-]+$/.test(trimmed);
}

function endpointTypeFor(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('sip:')) return 'sip';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('wss:')) return 'webrtc';
  if (looksLikePhoneNumber(trimmed)) return 'phone';
  return 'provider_api';
}

async function createAgentConnection(params: {
  provider: string;
  displayName: string;
  endpointType: string;
  endpoint: string;
  credentials: Record<string, string>;
}) {
  const response = await fetch('/api/agent-connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Agent connection could not be saved.');
  return data.agentConnection as { id: string };
}

function Stepper({ step, setStep }: { step: number; setStep: (step: number) => void }) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((item, index) => {
        const active = step === item.id;
        const complete = step > item.id;

        return (
          <div key={item.id} className="flex items-center">
            <button
              type="button"
              onClick={() => complete && setStep(item.id)}
              className={`flex items-center gap-2 text-sm font-medium ${
                active ? 'text-slate-950' : complete ? 'text-[#2448bb]' : 'text-slate-400'
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                  active
                    ? 'bg-slate-100 text-slate-800 ring-1 ring-slate-200'
                    : complete
                      ? 'bg-[#eef2ff] text-[#2448bb] ring-1 ring-[#cfd8ff]'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {complete ? (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  item.id
                )}
              </span>
              {item.label}
            </button>
            {index < steps.length - 1 && <div className="mx-3 h-px w-16 bg-slate-200" />}
          </div>
        );
      })}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-medium text-slate-950">{value}</p>
    </div>
  );
}

export default function NewExperiment() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [agentType, setAgentType] = useState(STUB_PROVIDER_ID);
  const [apiKey, setApiKey] = useState('');
  const [agentLocator, setAgentLocator] = useState('');
  const [stubInstructions, setStubInstructions] = useState(
    'Be concise, verify critical details, follow policy, and confirm the next step before ending the call.',
  );
  const [stubKnowledge, setStubKnowledge] = useState(
    'Use the scenario facts only. If account, policy, or availability is unclear, ask one clarifying question.',
  );
  const [stubTools, setStubTools] = useState('CRM lookup may find duplicates; ticket policy may require escalation; calendar slots may be limited.');
  const [stubConfirmationRules, setStubConfirmationRules] = useState(
    'Read back emails, phone numbers, appointment times, amounts, and final next steps before ending the call.',
  );
  const [stubEscalationPolicy, setStubEscalationPolicy] = useState(
    'Escalate when a customer disputes account data, policy conflicts, or the requested action is blocked.',
  );
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState('');
  const [vapiCustomerNumber, setVapiCustomerNumber] = useState('');
  const [vapiMode, setVapiMode] = useState<'bot_to_bot_phone' | 'human_pilot'>('bot_to_bot_phone');
  const [retellFromNumber, setRetellFromNumber] = useState('');
  const [elevenLabsPhoneNumberId, setElevenLabsPhoneNumberId] = useState('');
  const [elevenLabsMode, setElevenLabsMode] = useState<'live_call' | 'recording_replay'>('recording_replay');
  const [expName, setExpName] = useState('pre-production voice preflight');
  const [promotedFromExperimentId, setPromotedFromExperimentId] = useState('');
  const [scenarios, setScenarios] = useState<StoredScenario[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const response = await fetch('/api/scenarios', { cache: 'no-store' });
      if (!response.ok) {
        setError('Scenario library is unavailable. Check the database connection and retry.');
        return;
      }
      const data = await response.json();
      setScenarios(mergeWithRealScenarioLibrary(data.scenarios ?? []) as StoredScenario[]);
    };
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('provider');
    const scenarioId = params.get('scenario');
    const scenarioIds = params.get('scenarios')?.split(',').filter(Boolean) ?? [];
    const promotedFrom = params.get('promotedFrom');
    if (provider && AGENT_TYPES.some((agent) => agent.id === provider)) {
      setAgentType(provider);
    }
    if (promotedFrom) {
      setPromotedFromExperimentId(promotedFrom);
      setExpName('promoted real-call verification');
    }
    if (scenarioId && scenarios.some((scenario) => scenario.id === scenarioId)) {
      setSelectedIds((current) => (current.includes(scenarioId) ? current : [scenarioId]));
      setStep(2);
    }
    if (scenarioIds.length) {
      const validIds = scenarioIds.filter((id) => scenarios.some((scenario) => scenario.id === id));
      if (validIds.length) {
        setSelectedIds(validIds);
        setStep(promotedFrom ? 1 : 2);
      }
    }
  }, [scenarios]);

  const selectedScenarios = useMemo(() => {
    return scenarios.filter((scenario) => selectedIds.includes(scenario.id));
  }, [scenarios, selectedIds]);

  const highPressureIds = useMemo(() => {
    return scenarios
      .filter((scenario) => {
        const emotion = scenario.persona?.emotional_state;
        return scenario.persona?.interrupts || ['angry', 'irate', 'urgent', 'frustrated'].includes(emotion);
      })
      .map((scenario) => scenario.id);
  }, [scenarios]);

  const activeAgent = AGENT_TYPES.find((agent) => agent.id === agentType) ?? AGENT_TYPES[0];
  const stubMode = agentType === STUB_PROVIDER_ID;
  const liveProvider = isLiveProvider(agentType);
  const botToBotProvider = isBotToBotProvider(agentType);
  const hostedLiveKit = agentType === 'livekit';
  const replayMode = agentType === 'elevenlabs' && elevenLabsMode === 'recording_replay';
  const vapiBotToBotPhone = agentType === 'vapi' && vapiMode === 'bot_to_bot_phone';
  const providerPhoneMode = liveProvider && !replayMode;
  const needsProviderApiKey = providerPhoneMode;
  const locatorLabel = stubMode
    ? 'Agent instructions'
    : hostedLiveKit
      ? 'Lightcurve room connection'
    : vapiBotToBotPhone
      ? 'Your agent phone number or SIP URI'
      : activeAgent.locatorLabel;
  const locatorPlaceholder = stubMode
    ? 'Paste the policy, prompt, or expected call flow you want to preflight'
    : hostedLiveKit
      ? 'Lightcurve creates this after you start the run'
    : vapiBotToBotPhone
      ? 'Put your agent phone number, e.g. +14155550123'
      : activeAgent.placeholder;
  const callerMode = stubMode
    ? 'Agent replica'
    : hostedLiveKit
      ? 'Lightcurve room'
    : replayMode
      ? 'Replay import'
      : vapiBotToBotPhone
        ? 'Bot-to-bot phone'
        : liveProvider
          ? 'Human pilot'
          : 'Bot-to-bot';
  const realPhoneMode = providerPhoneMode;
  const selectedTooManyPhoneScenarios = realPhoneMode && selectedIds.length > MAX_REAL_PHONE_SCENARIOS;
  const canProceedFromAgentStep = stubMode ? stubInstructions.trim().length > 0 : hostedLiveKit ? true : agentLocator.trim().length > 0;

  const toggleScenario = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const handleRun = async () => {
    if (!expName.trim() || selectedIds.length === 0) return;
    if (stubMode && !stubInstructions.trim()) return;
    if (!stubMode && !hostedLiveKit && !agentLocator.trim()) return;
    const usesLiveProvider = isLiveProvider(agentType);
    const elevenLabsReplay = agentType === 'elevenlabs' && elevenLabsMode === 'recording_replay';
    const needsHumanTester = usesLiveProvider && !elevenLabsReplay && !vapiBotToBotPhone;
    if (usesLiveProvider && !elevenLabsReplay && selectedIds.length > MAX_REAL_PHONE_SCENARIOS) {
      setError(`Real phone sandboxes can run up to ${MAX_REAL_PHONE_SCENARIOS} scenarios at once. Select a smaller pilot suite, then batch the rest.`);
      return;
    }
    if (!stubMode && vapiBotToBotPhone) {
      if (looksLikeUuid(agentLocator)) {
        setError('For Vapi bot-to-bot, enter the target agent phone number or SIP URI here, not a Vapi phone-number ID.');
        return;
      }
      if (!agentLocator.trim().startsWith('sip:') && !looksLikePhoneNumber(agentLocator)) {
        setError('Enter the phone number or SIP URI your voice agent answers. Example: +14155550123 or sip:agent@example.com.');
        return;
      }
      if (vapiPhoneNumberId.trim() && !looksLikeUuid(vapiPhoneNumberId)) {
        setError('Paste the Vapi Phone Number UUID for the outbound caller. Do not paste the +1 phone number here.');
        return;
      }
    }
    if (!stubMode && isBotToBotProvider(agentType) && !hostedLiveKit && !agentLocator.trim().startsWith('https://')) {
      setError('For LiveKit, Pipecat, or Custom WebRTC today, enter a compatible HTTPS runner endpoint. Native SIP/WebRTC media bridge is coming next.');
      return;
    }
    if (needsHumanTester && !vapiCustomerNumber.trim()) {
      setError('Add a consented test phone number for the live sandbox call.');
      return;
    }

    setLoading(true);
    setError('');
    trackLightcurveEvent('Experiment Run Submitted', {
      agent_type: agentType,
      scenario_count: selectedIds.length,
      live_provider: usesLiveProvider,
      bot_to_bot_phone: vapiBotToBotPhone,
      elevenlabs_mode: agentType === 'elevenlabs' ? elevenLabsMode : undefined,
    });

    try {
      const agentConfig: Record<string, string> =
        stubMode
          ? {
              mode: 'agent_replica',
              instructions: stubInstructions,
              knowledge: stubKnowledge,
              toolMocks: stubTools,
              confirmationRules: stubConfirmationRules,
              escalationPolicy: stubEscalationPolicy,
              costMode: 'low_cost_testing',
            }
          : hostedLiveKit
            ? {
                mode: 'lightcurve_hosted_room',
                costMode: 'low_cost_testing',
                bridge: 'livekit',
              }
          : agentType === 'custom_webrtc'
            ? { runnerUrl: agentLocator, apiKey }
            : agentType === 'vapi'
            ? vapiBotToBotPhone
              ? {
                  callMode: 'bot_to_bot_phone',
                  targetAgentNumber: agentLocator,
                  apiKey,
                  phoneNumberId: vapiPhoneNumberId,
                }
              : {
                  callMode: 'human_pilot',
                  assistantId: agentLocator,
                  apiKey,
                  phoneNumberId: vapiPhoneNumberId,
                  customerNumber: vapiCustomerNumber,
                }
            : agentType === 'retell'
              ? {
                  agentId: agentLocator,
                  apiKey,
                  fromNumber: retellFromNumber,
                  customerNumber: vapiCustomerNumber,
                }
              : agentType === 'elevenlabs'
                ? {
                    agentId: agentLocator,
                    apiKey,
                    agentPhoneNumberId: elevenLabsPhoneNumberId,
                    customerNumber: vapiCustomerNumber,
                    costMode: elevenLabsMode,
                  }
            : agentType === 'livekit'
              ? { runnerUrl: agentLocator, apiKey }
              : agentType === 'pipecat'
              ? { runnerUrl: agentLocator, apiKey }
              : { agentId: agentLocator, apiKey };
      const credentials: Record<string, string> =
        stubMode
          ? {}
          : agentType === 'vapi'
          ? vapiBotToBotPhone
            ? {
                apiKey,
                phoneNumberId: vapiPhoneNumberId,
              }
            : {
                apiKey,
                assistantId: agentLocator,
                phoneNumberId: vapiPhoneNumberId,
                customerNumber: vapiCustomerNumber,
              }
          : agentType === 'retell'
            ? { apiKey, agentId: agentLocator, fromNumber: retellFromNumber, customerNumber: vapiCustomerNumber }
            : agentType === 'elevenlabs'
              ? { apiKey, agentId: agentLocator, agentPhoneNumberId: elevenLabsPhoneNumberId, customerNumber: vapiCustomerNumber }
              : { apiKey };

      const connection = stubMode || hostedLiveKit
        ? null
        : await createAgentConnection({
            provider: agentType,
            displayName: `${activeAgent.label} ${new Date().toLocaleDateString()}`,
            endpointType: endpointTypeFor(agentLocator),
            endpoint: vapiBotToBotPhone || isBotToBotProvider(agentType) ? agentLocator : '',
            credentials,
          });

      const response = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: expName,
          agentType,
          agentConnectionId: connection?.id ?? null,
          agentConfig,
          webrtcEndpoint: stubMode
            ? 'agent-replica://low-cost-testing'
            : hostedLiveKit
              ? 'livekit://lightcurve-hosted-room'
              : `${agentType}:${agentLocator}`,
          scenarioIds: selectedIds,
          promotedFromExperimentId,
          gitSha: stubMode ? 'low-cost-agent-replica' : 'live-sandbox',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'Sandbox experiment could not be created');
      }

      await Promise.all(
        (data.runs ?? []).map(async (run: { id: string }) => {
          const startResponse = await fetch(`/api/runs/${run.id}/start`, { method: 'POST' });
          if (!startResponse.ok) {
            const startData = await startResponse.json().catch(() => ({}));
            throw new Error(startData.error ?? `Run ${run.id} could not be started`);
          }
        }),
      );

      trackLightcurveEvent('Experiment Run Created', {
        experiment_id: data.experiment.id,
        agent_type: agentType,
        scenario_count: selectedIds.length,
        run_count: (data.runs ?? []).length,
      });
      router.push(`/experiments/${data.experiment.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Experiment could not be created';
      trackLightcurveEvent('Experiment Run Failed', {
        agent_type: agentType,
        scenario_count: selectedIds.length,
        error: message,
      });
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="page-header flex items-start justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
            <Link href="/experiments" className="hover:text-slate-900">Call tests</Link>
            <span>/</span>
            <span className="font-medium text-slate-900">New</span>
          </div>
          <h1 className="page-title">New voice-agent sandbox test</h1>
          <p className="page-subtitle max-w-2xl">
            Connect an agent, choose real-world caller scenarios, then run a sandbox check for MOS, task completion,
            hallucination risk, and latency.
          </p>
          {promotedFromExperimentId && (
            <div className="mt-3 inline-flex rounded-lg border border-[#cfd8ff] bg-white px-3 py-2 text-xs text-slate-600">
              Promoted from low-cost testing. Verify only the failed or risky scenarios against a real provider path.
            </div>
          )}
        </div>
        <Stepper step={step} setStep={setStep} />
      </div>

      {step === 1 && (
        <div className="grid grid-cols-[1fr_360px] gap-5">
          <section className="card p-5">
            <div>
              <h2 className="text-base font-medium text-slate-950">Connect your voice agent</h2>
              <p className="mt-1 text-sm text-slate-500">
                Lightcurve tests your voice agent through live calls, replay imports, or the isolated bot-to-bot caller bridge.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2.5">
              {AGENT_TYPES.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setAgentType(agent.id)}
                  className={`inline-flex h-11 items-center gap-2.5 rounded-lg border px-4 text-sm transition-colors ${
                    agentType === agent.id
                      ? 'border-[#526dff] bg-[#f4f6ff] text-[#2448bb] ring-1 ring-[#526dff]'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <ProviderLogo provider={agent.id} className="h-5 w-5" />
                  <span className="font-medium">{agent.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
              {Object.values(COST_LANES).map((lane) => (
                <div
                  key={lane.id}
                  className={`rounded-md border px-3 py-2 ${
                    costLaneForProvider(agentType) === lane.id
                      ? 'border-[#cfd8ff] bg-white text-[#2448bb]'
                      : 'border-transparent text-slate-500'
                  }`}
                >
                  <p className="text-xs font-medium">{lane.label}</p>
                  <p className="mt-1 text-[11px] leading-4">{lane.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-[#cfd8ff] bg-[#f8faff] p-3 text-sm leading-relaxed text-slate-600">
              <span className="font-medium text-slate-950">Default path:</span> no provider API key. Use Agent Replica for
              prompt/policy coverage, or Lightcurve room when your real agent can join the test room. Use Vapi, Retell, or
              ElevenLabs credentials only for phone-realism checks and imports.
            </div>

            {agentType === 'vapi' && (
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Call mode</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {vapiBotToBotPhone
                        ? 'Lightcurve acts as the caller and dials your agent.'
                        : 'A consented tester receives the call while Lightcurve scores it.'}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
                    <button
                      type="button"
                      onClick={() => setVapiMode('bot_to_bot_phone')}
                      className={`rounded-md px-3 py-1.5 ${vapiBotToBotPhone ? 'bg-[#eef2ff] text-[#2448bb]' : 'text-slate-500'}`}
                    >
                      Bot-to-bot phone
                    </button>
                    <button
                      type="button"
                      onClick={() => setVapiMode('human_pilot')}
                      className={`rounded-md px-3 py-1.5 ${vapiMode === 'human_pilot' ? 'bg-[#eef2ff] text-[#2448bb]' : 'text-slate-500'}`}
                    >
                      Human pilot
                    </button>
                  </div>
                </div>
                {vapiBotToBotPhone && (
                  <div className="mt-3 rounded-md border border-[#cfd8ff] bg-white p-3 text-xs leading-relaxed text-slate-600">
                    <p className="font-medium text-slate-900">Vapi phone realism needs three customer-owned values:</p>
                    <div className="mt-2 grid gap-1.5">
                      <p>1. Your Vapi API key.</p>
                      <p>2. The inbound phone number your agent answers.</p>
                      <p>3. The Vapi Phone Number UUID for a different outbound caller number.</p>
                    </div>
                    <p className="mt-2 text-slate-500">
                      This is only for the small set of risky cases you want verified over Vapi phone infrastructure.
                      Broad testing should run through Agent Replica or Lightcurve room first.
                    </p>
                  </div>
                )}
              </div>
            )}

            {stubMode ? (
              <div className="mt-5 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="rounded-lg border border-[#cfd8ff] bg-white p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Testing lane</p>
                  <p className="mt-1 text-sm font-medium text-slate-950">Low-cost hosted agent replica</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    Mirror the customer agent with prompt, policy, and tool behavior first. Run broad coverage here,
                    then promote only risky failures to provider-backed or phone-realism checks.
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">{locatorLabel}</label>
                  <textarea
                    className="input-field min-h-24 resize-y"
                    value={stubInstructions}
                    onChange={(event) => setStubInstructions(event.target.value)}
                    placeholder={locatorPlaceholder}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">Knowledge and policy notes</label>
                    <textarea
                      className="input-field min-h-20 resize-y"
                      value={stubKnowledge}
                      onChange={(event) => setStubKnowledge(event.target.value)}
                      placeholder="Refund policy, booking rules, escalation constraints..."
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">Sandbox tool conditions</label>
                    <textarea
                      className="input-field min-h-20 resize-y"
                      value={stubTools}
                      onChange={(event) => setStubTools(event.target.value)}
                      placeholder="CRM duplicate, payment failure, no slots, ticket already open..."
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">Confirmation rules</label>
                    <textarea
                      className="input-field min-h-20 resize-y"
                      value={stubConfirmationRules}
                      onChange={(event) => setStubConfirmationRules(event.target.value)}
                      placeholder="Read back emails, phone numbers, amounts, dates, next steps..."
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">Escalation policy</label>
                    <textarea
                      className="input-field min-h-20 resize-y"
                      value={stubEscalationPolicy}
                      onChange={(event) => setStubEscalationPolicy(event.target.value)}
                      placeholder="When to escalate, when to refuse, when to ask for clarification..."
                    />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  This path spends Lightcurve tested minutes only. It does not call your Vapi, Retell, ElevenLabs, or model-provider account.
                </p>
              </div>
            ) : hostedLiveKit ? (
              <div className="mt-5 rounded-lg border border-[#cfd8ff] bg-[#f8faff] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[#526894]">Testing lane</p>
                    <h3 className="mt-1 text-sm font-medium text-slate-950">Lightcurve room for real-agent testing</h3>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                      Lightcurve creates an isolated communication room for this run. Your agent joins with a short-lived
                      test token, while Lightcurve joins as the synthetic caller and scores the transcript.
                    </p>
                  </div>
                  <span className="rounded-full border border-[#cfd8ff] bg-white px-2.5 py-1 text-xs font-medium text-[#2448bb]">
                    Low-cost testing
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <MiniMetric label="Transport" value="WebRTC" />
                  <MiniMetric label="Phone minutes" value="0" />
                  <MiniMetric label="Provider spend" value="None" />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  Use this for broad sandbox coverage before sending only failed or risky cases to Vapi, Retell,
                  ElevenLabs, or carrier-phone checks.
                </p>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">
                    {locatorLabel}
                  </label>
                  <input
                    className="input-field"
                    value={agentLocator}
                    onChange={(event) => setAgentLocator(event.target.value)}
                    placeholder={locatorPlaceholder}
                  />
                  {vapiBotToBotPhone && (
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                      Put the phone number your voice agent answers. This must be different from the Vapi outbound caller number.
                    </p>
                  )}
                  {botToBotProvider && (
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                      This is the HTTPS endpoint your team exposes for Lightcurve to send synthetic caller turns and receive agent replies. It is not a public app URL.
                    </p>
                  )}
                </div>
                {needsProviderApiKey && (
                  <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">API key override</label>
                  <input
                    type="password"
                    className="input-field"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Only for provider phone/import runs"
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    Not needed for Agent Replica or Lightcurve room. Required only when Lightcurve asks your provider to place or import calls.
                  </p>
                </div>
                )}
              </div>
            )}

            {liveProvider && (
              <div className="mt-4 space-y-3">
                {agentType !== 'vapi' && (
                  <p className="rounded-md border border-[#e6cf93] bg-[#fffaf0] px-3 py-2 text-xs leading-relaxed text-[#765b1f]">
                    {replayMode
                      ? 'Low-cost replay imports an existing recording or transcript, then scores it against the selected scenario.'
                      : `${activeAgent.label} live mode dials a consented tester and scores the call result.`}
                  </p>
                )}
                {agentType === 'elevenlabs' && (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
                    <button
                      type="button"
                      onClick={() => setElevenLabsMode('recording_replay')}
                      className={`rounded-md px-3 py-1.5 ${elevenLabsMode === 'recording_replay' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                    >
                      Low-cost replay
                    </button>
                    <button
                      type="button"
                      onClick={() => setElevenLabsMode('live_call')}
                      className={`rounded-md px-3 py-1.5 ${elevenLabsMode === 'live_call' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                    >
                      Live phone call
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  {agentType === 'vapi' && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">
                        {vapiBotToBotPhone ? 'Vapi outbound caller phone number UUID' : 'Vapi phone number UUID'}
                      </label>
                      <input
                        className="input-field"
                        value={vapiPhoneNumberId}
                        onChange={(event) => setVapiPhoneNumberId(event.target.value)}
                        placeholder="b1c3cda9-6573-4ba2-b571-79e9509c453a"
                      />
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                        Add the UUID from Vapi Phone Numbers, not the formatted +1 phone number. This caller UUID should belong to a different number than your agent answers.
                      </p>
                    </div>
                  )}
                  {vapiBotToBotPhone && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Synthetic caller</p>
                      <p className="mt-1 text-sm font-medium text-slate-950">Generated by Lightcurve</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        We build the caller from the selected scenario, so customers do not need a separate Vapi assistant ID for the caller side.
                      </p>
                    </div>
                  )}
                  {agentType === 'retell' && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Retell from number</label>
                      <input
                        className="input-field"
                        value={retellFromNumber}
                        onChange={(event) => setRetellFromNumber(event.target.value)}
                        placeholder="+14155550123"
                      />
                    </div>
                  )}
                  {agentType === 'elevenlabs' && !replayMode && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">ElevenLabs phone number ID</label>
                      <input
                        className="input-field"
                        value={elevenLabsPhoneNumberId}
                        onChange={(event) => setElevenLabsPhoneNumberId(event.target.value)}
                        placeholder="ElevenLabs phone number ID"
                      />
                    </div>
                  )}
                  {liveProvider && !replayMode && !vapiBotToBotPhone && (
                    <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">Consented tester phone number</label>
                    <input
                      className="input-field"
                      value={vapiCustomerNumber}
                      onChange={(event) => setVapiCustomerNumber(event.target.value)}
                      placeholder="+14155550123"
                    />
                    </div>
                  )}
                </div>
              </div>
            )}

            {botToBotProvider && !hostedLiveKit && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
                Bot-to-bot mode queues an isolated caller simulator against your real agent runner URL. Point Pipecat or a Custom WebRTC bridge to your HTTPS runner endpoint; use Lightcurve room if your agent can join a test room directly.
              </div>
            )}

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-3 gap-3">
                <MiniMetric label="Input" value={stubMode ? 'Scenario text' : 'Phone audio'} />
                <MiniMetric label="Caller" value={callerMode} />
                <MiniMetric label="Output" value={stubMode ? 'Strict score' : 'MOS + CI'} />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setStep(2)} disabled={!canProceedFromAgentStep}>
                Pick callers
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </section>

          <aside className="card p-5">
            <p className="section-label">What gets tested</p>
            <h2 className="mt-2 text-base font-medium text-slate-950">A sandboxed voice loop</h2>
            <div className="mt-5 space-y-4">
              {[
                ['Caller behavior', 'Anger, interruptions, accents, code switching, background noise.'],
                ['Agent outcome', 'Task completion, safety, policy accuracy, escalation handling.'],
                ['Speech quality', 'MOS from recorded audio or a proxy score until the MOS service is connected.'],
                ['Release signal', 'A clean pass/fail readout developers can use before production.'],
              ].map(([label, text]) => (
                <div key={label} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#2f5ae0]" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-medium text-slate-950">
                  Choose sandbox callers
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {liveProvider
                    ? 'Pick the scenario your human tester will act out on the phone call.'
                    : 'Select the calls that should run before this voice-agent release ships.'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setSelectedIds(realPhoneMode ? highPressureIds.slice(0, MAX_REAL_PHONE_SCENARIOS) : highPressureIds)}
                >
                  High-pressure set
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() =>
                    selectedIds.length === scenarios.length
                      ? setSelectedIds([])
                      : setSelectedIds(
                          realPhoneMode
                            ? scenarios.slice(0, MAX_REAL_PHONE_SCENARIOS).map((scenario) => scenario.id)
                            : scenarios.map((scenario) => scenario.id),
                        )
                  }
                >
                  {selectedIds.length === scenarios.length ? 'Clear all' : realPhoneMode ? `Select first ${MAX_REAL_PHONE_SCENARIOS}` : 'Select all'}
                </button>
              </div>
            </div>
          </div>

          {selectedTooManyPhoneScenarios && (
            <div className="rounded-lg border border-[#e6cf93] bg-[#fffaf0] px-4 py-3 text-sm text-[#765b1f]">
              Real phone runs are capped at {MAX_REAL_PHONE_SCENARIOS} scenarios per batch so Lightcurve does not accidentally place hundreds of carrier calls. Use bot-to-bot runner mode for large-scale suites.
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            {scenarios.map((scenario) => {
              const selected = selectedIds.includes(scenario.id);
              const emotion = scenario.persona?.emotional_state ?? 'neutral';

              return (
                <button
                  type="button"
                  key={scenario.id}
                  onClick={() => toggleScenario(scenario.id)}
                  className={`card min-h-[188px] p-4 text-left transition-shadow hover:shadow-md ${
                    selected ? 'border-slate-300 bg-slate-50 ring-1 ring-slate-200' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {scenario.language} / {scenario.domain}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-950">{formatName(scenario.name)}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                        EMOTION_STYLES[emotion] ?? EMOTION_STYLES.neutral
                      }`}
                    >
                      {emotion}
                    </span>
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-slate-600">{scenario.persona?.goal}</p>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span>{scenario.persona?.name ?? 'Caller'}, {scenario.persona?.speed_wpm ?? 140} wpm</span>
                    <span className="font-medium text-slate-700">{selected ? 'Selected' : 'Add'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep(3)} disabled={selectedIds.length === 0 || selectedTooManyPhoneScenarios}>
              Configure gate
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid grid-cols-[1fr_400px] gap-5">
          <section className="card p-5">
            <h2 className="text-base font-medium text-slate-950">Name the release gate</h2>
            <p className="mt-1 text-sm text-slate-500">
              This creates the sandbox run and prepares an operator-ready quality report.
            </p>

            <div className="mt-5">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Experiment name</label>
              <input
                className="input-field"
                value={expName}
                onChange={(event) => setExpName(event.target.value)}
                placeholder="prod-agent-v2 preflight"
              />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <MiniMetric label="Agent" value={activeAgent.label} />
              <MiniMetric label="Callers" value={selectedIds.length} />
              <MiniMetric label="Gate" value="MOS 3.8+" />
            </div>

            {selectedTooManyPhoneScenarios && (
              <div className="mt-4 rounded-lg border border-[#e6cf93] bg-[#fffaf0] px-4 py-3 text-sm text-[#765b1f]">
                Reduce this real phone batch to {MAX_REAL_PHONE_SCENARIOS} scenarios or fewer before creating the sandbox run.
              </div>
            )}

            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">CI command preview</p>
              <div className="code-line">
                pnpm lightcurve run "{expName || 'voice-agent-preflight'}" --gate mos&gt;=3.8 --gate task&gt;=0.8
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-[#e3c3c1] bg-[#fbf3f2] px-4 py-3 text-sm text-[#8f3d3b]">
                {error}
              </div>
            )}

            <div className="mt-6 flex items-center justify-between">
              <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleRun}
                disabled={!expName.trim() || !canProceedFromAgentStep || selectedIds.length === 0 || selectedTooManyPhoneScenarios || loading}
              >
                {loading
                  ? 'Creating sandbox...'
                  : stubMode
                    ? 'Run low-cost test suite'
                    : replayMode
                    ? 'Create replay sandbox'
                    : vapiBotToBotPhone
                      ? 'Run bot-to-bot phone test'
                    : liveProvider
                      ? 'Dial human pilot call'
                      : 'Run bot-to-bot sandbox'}
              </button>
            </div>
          </section>

          <aside className="card p-5">
            <p className="section-label">Selected callers</p>
            <div className="mt-4 space-y-3">
              {selectedScenarios.map((scenario) => (
                <div key={scenario.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-950">{formatName(scenario.name)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {scenario.persona?.name}, {scenario.language}, {scenario.persona?.speed_wpm ?? 140} wpm
                      </p>
                    </div>
                    <span className="text-xs font-medium text-slate-500">{scenario.domain}</span>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
