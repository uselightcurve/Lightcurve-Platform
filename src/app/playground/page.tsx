'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScoreBar } from '@/components/PageActions';
import {
  PRONUNCIATION_PRESETS,
  buildPronunciationReport,
  buildPronunciationScenario,
  createPronunciationSpec,
  entityLabel,
  spokenFormForValue,
  type PronunciationEntityType,
  type PronunciationMode,
  type PronunciationPace,
} from '@/lib/pronunciation';
import { REAL_SCENARIO_LIBRARY, mergeWithRealScenarioLibrary } from '@/lib/realScenarioLibrary';
import type { LibraryScenario as StoredScenario } from '@/lib/realScenarioLibrary';
import { trackLightcurveEvent } from '@/lib/clientAnalytics';

const ACCENTS = ['en-US', 'en-IN', 'hi-IN', 'en-GB', 'es-ES'];
const PACES: PronunciationPace[] = ['slow', 'normal', 'fast'];
const MODES: PronunciationMode[] = ['normal', 'spell_out', 'grouped', 'correction'];
const ENVIRONMENT_TYPES = ['CRM', 'Calendar', 'Tickets', 'Payments', 'Knowledge Base'];
type PlaygroundConnectionMode = 'lightcurve_room' | 'https_runner';
type ActiveSandboxRun = {
  experimentId: string;
  runId: string;
  provider?: string;
  status?: string;
  liveKit?: {
    roomName: string;
    liveKitUrl: string;
    agentToken: string;
    instructions: string;
  };
};

function dedupeScenarios(items: StoredScenario[]) {
  return items.filter((scenario, index, array) => {
    return array.findIndex((candidate) => candidate.id === scenario.id) === index;
  });
}

function Waveform({ active = false }: { active?: boolean }) {
  return (
    <div className="flex h-16 items-center gap-1 rounded-lg border border-slate-200 bg-white px-4">
      {Array.from({ length: 34 }).map((_, index) => (
        <span
          key={index}
          className={`w-1 rounded-full ${active ? 'animate-pulse bg-[#2f5ae0]' : 'bg-slate-300'}`}
          style={{ height: `${12 + ((index * 7) % 34)}px`, opacity: active ? 0.75 + ((index % 4) * 0.06) : 0.55 }}
        />
      ))}
    </div>
  );
}

function modeLabel(mode: PronunciationMode) {
  const labels: Record<PronunciationMode, string> = {
    normal: 'Normal',
    spell_out: 'Spell out',
    grouped: 'Grouped',
    correction: 'Correction',
  };
  return labels[mode];
}

function speechLang(accent: string) {
  if (accent === 'hi-IN') return 'hi-IN';
  if (accent === 'en-IN') return 'en-IN';
  if (accent === 'en-GB') return 'en-GB';
  if (accent === 'es-ES') return 'es-ES';
  return 'en-US';
}

function speechRate(pace: PronunciationPace) {
  if (pace === 'slow') return 0.72;
  if (pace === 'fast') return 1.18;
  return 0.92;
}

async function createPlaygroundConnection(endpoint: string) {
  const response = await fetch('/api/agent-connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'custom_webrtc',
      displayName: 'Playground HTTPS runner',
      endpointType: 'webrtc',
      endpoint,
      credentials: {},
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Agent connection could not be saved.');
  return data.agentConnection as { id: string };
}

function environmentForScenario(scenario: StoredScenario, environmentType: string) {
  const domain = scenario.domain ?? 'general';
  const name = scenario.persona.name;
  const valueType = scenario.pronunciation?.entityType === 'email' ? 'Email' : scenario.pronunciation?.entityType === 'phone_number' ? 'Phone' : 'Intent';
  const targetValue = scenario.pronunciation?.targetValue ?? scenario.persona.goal;

  const environments: Record<string, {
    title: string;
    endpoint: string;
    status: string;
    rows: Array<{ label: string; value: string }>;
    timeline: Array<{ tool: string; detail: string }>;
  }> = {
    CRM: {
      title: 'CRM',
      endpoint: '/sandbox/crm/customer',
      status: scenario.pronunciation ? 'Contact update open' : 'Customer profile loaded',
      rows: [
        { label: 'Customer', value: name },
        { label: valueType, value: targetValue },
        { label: 'Record', value: scenario.persona.interrupts ? 'Duplicate match' : `${domain.slice(0, 3).toUpperCase()}-${scenario.callerSeed}` },
      ],
      timeline: [
        { tool: 'crm.lookup_customer', detail: `${name} profile` },
        { tool: 'crm.validate_field', detail: scenario.pronunciation ? targetValue : 'Required customer field' },
        { tool: 'crm.save_pending', detail: 'Waits for caller confirmation' },
      ],
    },
    Calendar: {
      title: 'Calendar',
      endpoint: '/sandbox/calendar/slots',
      status: 'Availability fixture',
      rows: [
        { label: 'Today', value: domain === 'healthcare' ? 'No slots' : '2 slots' },
        { label: 'Next open', value: 'Fri 3:30 PM' },
        { label: 'Timezone', value: scenario.language === 'hi-IN' ? 'IST locked' : 'Caller local' },
      ],
      timeline: [
        { tool: 'calendar.find_slots', detail: 'Available appointment windows' },
        { tool: 'calendar.detect_conflict', detail: 'Double-booking guard' },
        { tool: 'calendar.hold_slot', detail: 'Temporary sandbox hold' },
      ],
    },
    Tickets: {
      title: 'Tickets',
      endpoint: '/sandbox/tickets/open',
      status: 'Support fixture',
      rows: [
        { label: 'Open ticket', value: scenario.persona.interrupts ? 'Exists' : 'None' },
        { label: 'Policy', value: domain === 'ecommerce' ? 'Refund review' : 'Escalation path' },
        { label: 'SLA', value: domain === 'healthcare' ? 'Priority' : 'Standard' },
      ],
      timeline: [
        { tool: 'tickets.search_open', detail: 'Existing issue lookup' },
        { tool: 'tickets.apply_policy', detail: 'Refund or escalation rule' },
        { tool: 'tickets.create_note', detail: 'Transcript evidence attached' },
      ],
    },
    Payments: {
      title: 'Payments',
      endpoint: '/sandbox/payments/authorize',
      status: 'Payment fixture',
      rows: [
        { label: 'Method', value: domain === 'banking' ? 'ACH' : 'Visa ending 4242' },
        { label: 'Auth', value: scenario.persona.interrupts ? 'Requires retry' : 'Approved' },
        { label: 'Fallback', value: 'Confirm consent' },
      ],
      timeline: [
        { tool: 'payments.authorize', detail: 'Sandbox authorization' },
        { tool: 'payments.handle_failure', detail: 'Failed-card branch available' },
        { tool: 'payments.write_receipt', detail: 'Receipt waits for confirmation' },
      ],
    },
    'Knowledge Base': {
      title: 'Knowledge Base',
      endpoint: '/sandbox/kb/search',
      status: 'Policy grounding',
      rows: [
        { label: 'Article', value: `${domain} policy` },
        { label: 'Version', value: scenario.persona.interrupts ? 'Conflict found' : 'Current' },
        { label: 'Escalate', value: 'If policy mismatch' },
      ],
      timeline: [
        { tool: 'kb.search_policy', detail: 'Relevant policy snippets' },
        { tool: 'kb.compare_versions', detail: 'Outdated-info guard' },
        { tool: 'kb.cite_answer', detail: 'Grounded response check' },
      ],
    },
  };

  return environments[environmentType] ?? environments.CRM;
}

function SandboxEnvironmentPanel({
  scenario,
  environmentType,
  callState,
  visibleTurns,
}: {
  scenario: StoredScenario;
  environmentType: string;
  callState: 'idle' | 'running' | 'complete';
  visibleTurns: number;
}) {
  const environment = environmentForScenario(scenario, environmentType);
  const phase = callState === 'complete' ? environment.timeline.length : Math.max(0, Math.min(visibleTurns - 1, environment.timeline.length));

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        <span className={`h-2 w-2 rounded-full ${callState === 'running' ? 'animate-pulse bg-[#2f5ae0]' : callState === 'complete' ? 'bg-[#2f6f5f]' : 'bg-slate-300'}`} />
        <span className="ml-1 truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500">
          {environment.endpoint}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-950">{environment.title}</p>
            <p className="mt-1 text-xs text-slate-500">{environment.status}</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">
            sandbox
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
          {environment.rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[76px_1fr] gap-2 text-xs">
              <span className="text-slate-400">{row.label}</span>
              <span className="truncate text-slate-800">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Tool timeline</p>
          {environment.timeline.map((item, index) => {
            const active = callState === 'running' && phase === index;
            const complete = callState === 'complete' || phase > index;
            return (
              <div
                key={item.tool}
                className={`rounded-md border px-3 py-2 ${active ? 'border-[#cfd8ff] bg-[#f5f7ff]' : 'border-slate-100 bg-slate-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-[11px] text-slate-800">{item.tool}</code>
                  <span className={`shrink-0 text-[11px] ${complete ? 'text-[#2f6f5f]' : active ? 'text-[#2448bb]' : 'text-slate-400'}`}>
                    {complete ? '200 OK' : active ? 'calling' : 'queued'}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function PlaygroundPage() {
  const router = useRouter();
  const [callState, setCallState] = useState<'idle' | 'running' | 'complete'>('idle');
  const [scenarioId, setScenarioId] = useState(REAL_SCENARIO_LIBRARY[0]?.id ?? '');
  const [agent, setAgent] = useState('');
  const [connectionMode, setConnectionMode] = useState<PlaygroundConnectionMode>('lightcurve_room');
  const [scenarios, setScenarios] = useState<StoredScenario[]>(dedupeScenarios(REAL_SCENARIO_LIBRARY as StoredScenario[]));
  const [visibleTurns, setVisibleTurns] = useState(0);
  const [pronunciationEnabled, setPronunciationEnabled] = useState(true);
  const [entityType, setEntityType] = useState<PronunciationEntityType>('email');
  const [targetValue, setTargetValue] = useState(PRONUNCIATION_PRESETS.email[0]);
  const [accent, setAccent] = useState('en-US');
  const [pace, setPace] = useState<PronunciationPace>('normal');
  const [mode, setMode] = useState<PronunciationMode>('spell_out');
  const [environmentType, setEnvironmentType] = useState('CRM');
  const [runError, setRunError] = useState('');
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [activeSandboxRun, setActiveSandboxRun] = useState<ActiveSandboxRun | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadScenarios() {
      try {
        const response = await fetch('/api/scenarios', { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load scenarios.');
        const payload = await response.json();
        const loaded = (Array.isArray(payload) ? payload : payload.scenarios ?? []) as StoredScenario[];
        if (!cancelled) {
          const deduped = dedupeScenarios(mergeWithRealScenarioLibrary(loaded) as StoredScenario[]);
          setScenarios(deduped);
          if (deduped[0] && !scenarioId) setScenarioId(deduped[0].id);
        }
      } catch (error) {
        if (!cancelled) setRunError(error instanceof Error ? error.message : 'Unable to load scenarios.');
      }
    }

    loadScenarios();
    return () => {
      cancelled = true;
    };
  }, []);

  const baseScenario = useMemo(() => {
    return scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0];
  }, [scenarioId, scenarios]);

  const pronunciationSpec = useMemo(() => {
    return createPronunciationSpec({
      entityType,
      targetValue,
      accent,
      pace,
      mode,
    });
  }, [accent, entityType, mode, pace, targetValue]);

  const activeScenario = useMemo(() => {
    if (!baseScenario || !pronunciationEnabled) return baseScenario;
    return buildPronunciationScenario(baseScenario, pronunciationSpec);
  }, [baseScenario, pronunciationEnabled, pronunciationSpec]);

  const transcript = useMemo(() => {
    if (!activeScenario) return [];

    if (activeScenario.pronunciation) {
      const spec = activeScenario.pronunciation;
      const spoken = spec.spokenForms[0] ?? spokenFormForValue(spec.entityType, spec.targetValue, spec.mode);
      const slowReadback =
        spec.entityType === 'email'
          ? spec.targetValue.replace(/@/g, ' at ').replace(/\./g, ' dot ').replace(/\+/g, ' plus ').replace(/-/g, ' dash ').replace(/_/g, ' underscore ')
          : spokenFormForValue(spec.entityType, spec.targetValue, 'grouped');

      return [
        {
          speaker: 'caller' as const,
          text: `Please update my ${spec.entityType === 'email' ? 'email' : 'phone number'}. It is ${spoken}.`,
          latencyMs: 0,
        },
        {
          speaker: 'agent' as const,
          text: `I heard ${spec.targetValue}. I will read it back slowly before I save it.`,
          latencyMs: pace === 'slow' ? 1380 : pace === 'fast' ? 820 : 1040,
        },
        {
          speaker: 'agent' as const,
          text: `Confirming ${spec.entityType === 'email' ? 'email' : 'phone number'}: ${spec.targetValue}. Spoken back as ${slowReadback}. Is that correct?`,
          latencyMs: pace === 'slow' ? 1740 : pace === 'fast' ? 980 : 1320,
        },
        {
          speaker: 'caller' as const,
          text: 'Yes, that is correct.',
          latencyMs: 0,
        },
      ];
    }

    return [
      {
        speaker: 'caller' as const,
        text: activeScenario.persona.opening_line,
        latencyMs: 0,
      },
      {
        speaker: 'agent' as const,
        text: `I can help with that. I will work on: ${activeScenario.persona.goal}`,
        latencyMs: 880,
      },
      {
        speaker: 'caller' as const,
        text: activeScenario.persona.interrupts ? 'Please do not put me through another loop.' : 'Please confirm the next step clearly.',
        latencyMs: 0,
      },
      {
        speaker: 'agent' as const,
        text: activeScenario.persona.emotional_state === 'neutral'
          ? 'Here is the shortest path: I will confirm pricing, complete the change, and summarize it.'
          : 'I understand the urgency. I will give you a clear next step and avoid guessing.',
        latencyMs: 1020,
      },
    ];
  }, [activeScenario, pace]);

  const pronunciationReport = useMemo(() => {
    if (!activeScenario?.pronunciation) return null;
    return buildPronunciationReport(activeScenario.pronunciation, transcript);
  }, [activeScenario, transcript]);

  useEffect(() => {
    if (callState !== 'running') return;
    setVisibleTurns(0);
    const interval = window.setInterval(() => {
      setVisibleTurns((current) => {
        const next = current + 1;
        if (next >= transcript.length) {
          window.clearInterval(interval);
          window.setTimeout(() => setCallState('complete'), 700);
        }
        return next;
      });
    }, 850);
    return () => window.clearInterval(interval);
  }, [callState, transcript.length]);

  function selectPreset(value: string) {
    setTargetValue(value);
    setCallState('idle');
    setVisibleTurns(0);
    trackLightcurveEvent('Pronunciation Preset Selected', {
      entity_type: entityType,
      mode,
      accent,
      pace,
    });
  }

  function listenToPronunciation() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    trackLightcurveEvent('Pronunciation Listen Clicked', {
      entity_type: entityType,
      mode,
      accent,
      pace,
    });
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(pronunciationSpec.spokenForms[0]);
    utterance.lang = speechLang(accent);
    utterance.rate = speechRate(pace);
    window.speechSynthesis.speak(utterance);
  }

  async function startOrEndCall() {
    if (callState === 'running') {
      setVisibleTurns(transcript.length);
      setCallState('complete');
      trackLightcurveEvent('Playground Call Ended', {
        scenario_id: activeScenario?.id,
        transcript_turns: transcript.length,
      });
      return;
    }
    if (!activeScenario) return;
    const usesHttpsRunner = connectionMode === 'https_runner';
    if (usesHttpsRunner && !agent.trim()) {
      setRunError('Enter your compatible HTTPS runner URL, or switch back to the Lightcurve room for a no-endpoint Playground test.');
      return;
    }
    if (usesHttpsRunner) {
      if (agent.trim().startsWith('sip:') || agent.trim().startsWith('wss:')) {
        setRunError('Native SIP/WebRTC bridge endpoints belong in Experiments. Playground accepts a Lightcurve room or a compatible HTTPS runner URL.');
        return;
      }
      if (!agent.trim().startsWith('https://')) {
        setRunError('Use a compatible HTTPS runner URL here. Random text, raw phone numbers, and provider phone IDs cannot start a Playground call.');
        return;
      }
    }
    setRunError('');
    setVisibleTurns(0);
    setCallState('running');
    trackLightcurveEvent('Playground Sandbox Started', {
      scenario_id: baseScenario?.id ?? activeScenario.id,
      environment_type: environmentType,
      pronunciation_enabled: pronunciationEnabled,
      entity_type: pronunciationEnabled ? entityType : undefined,
      connection_mode: connectionMode,
    });
    try {
      const connection = usesHttpsRunner ? await createPlaygroundConnection(agent.trim()) : null;
      const scenarioForRun = activeScenario.pronunciation ? activeScenario : baseScenario ?? activeScenario;
      const scenarioOverrides = activeScenario.pronunciation ? [activeScenario] : [];
      const experimentResponse = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${activeScenario.name} playground check`,
          agentType: usesHttpsRunner ? 'custom_webrtc' : 'livekit',
          agentConnectionId: connection?.id ?? null,
          agentConfig: {
            endpointType: usesHttpsRunner ? 'webrtc' : 'livekit_room',
            endpoint: usesHttpsRunner ? agent.trim() : 'livekit://lightcurve-hosted-room',
            mode: usesHttpsRunner ? 'https_runner' : 'lightcurve_hosted_room',
            costMode: 'low_cost_testing',
            bridge: usesHttpsRunner ? 'custom_https_runner' : 'livekit',
            pronunciation: activeScenario.pronunciation ?? null,
            sandboxEnvironment: environmentType,
          },
          webrtcEndpoint: usesHttpsRunner ? agent.trim() : 'livekit://lightcurve-hosted-room',
          scenarioIds: [scenarioForRun.id],
          scenarioOverrides,
          gitSha: 'playground',
        }),
      });
      const experimentPayload = await experimentResponse.json().catch(() => null);
      if (!experimentResponse.ok) throw new Error(experimentPayload?.error ?? 'Unable to create sandbox run.');
      const run = experimentPayload?.runs?.[0];
      if (!run?.id) throw new Error('Sandbox run was not created.');

      const startResponse = await fetch(`/api/runs/${run.id}/start`, { method: 'POST' });
      const startPayload = await startResponse.json().catch(() => null);
      if (!startResponse.ok) throw new Error(startPayload?.error ?? 'Unable to start sandbox runner.');

      trackLightcurveEvent('Playground Sandbox Queued', {
        experiment_id: experimentPayload.experiment.id,
        run_id: run.id,
        provider: startPayload?.provider,
        status: startPayload?.status,
      });
      setActiveSandboxRun({
        experimentId: experimentPayload.experiment.id,
        runId: run.id,
        provider: startPayload?.provider,
        status: startPayload?.status,
        liveKit: startPayload?.liveKit,
      });
    } catch (error) {
      setCallState('idle');
      const message = error instanceof Error ? error.message : 'Unable to start sandbox call.';
      trackLightcurveEvent('Playground Sandbox Failed', {
        scenario_id: baseScenario?.id ?? activeScenario.id,
        error: message,
      });
      setRunError(message);
    }
  }

  function downloadTranscript() {
    trackLightcurveEvent('Transcript Downloaded', {
      scenario_id: activeScenario?.id,
      transcript_turns: transcript.length,
    });
    const text = transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeScenario?.name ?? 'sandbox-call'}-transcript.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      trackLightcurveEvent('Playground Value Copied', {
        value_type: value.startsWith('ey') ? 'agent_token' : value.startsWith('wss://') ? 'livekit_url' : 'room_name',
      });
    } catch {
      setRunError('Copy failed in this browser. Select the value and copy it manually.');
    }
  }

  if (!activeScenario) {
    return (
      <div className="card p-8 text-center">
        <h1 className="page-title">No scenarios loaded</h1>
        <p className="page-subtitle">Open the scenario library to load sandbox scenarios.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Playground</h1>
        <p className="page-subtitle">Run one sandbox call, test pronunciation capture, then save it into experiments.</p>
      </div>

      <div className="grid grid-cols-[0.38fr_0.62fr] gap-5">
        <aside className="card flex min-h-[620px] flex-col p-4">
          <h2 className="text-sm font-medium text-slate-950">Scenario configurator</h2>
          <div className="mt-5 space-y-4">
            <label className="block text-xs text-slate-500">
              Scenario
              <select
                className="select-field mt-1"
                value={baseScenario?.id ?? ''}
                onChange={(event) => {
                  setScenarioId(event.target.value);
                  setCallState('idle');
                  setVisibleTurns(0);
                }}
              >
                {scenarios.map((scenario, index) => (
                  <option key={`${scenario.id}-${index}`} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-950">Agent under test</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {connectionMode === 'lightcurve_room'
                      ? 'Hosted sandbox room. No endpoint needed before you start.'
                      : 'Advanced HTTPS runner connected for this Playground call.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                  onClick={() => setAgentModalOpen(true)}
                >
                  Connect
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-[#d8e0ff] bg-[#f6f8ff] px-3 py-2 text-xs leading-5 text-slate-600">
                Playground tests one customer agent at a time. Experiments are for large scenario suites.
              </div>
            </div>

            {runError && (
              <div className="rounded-lg border border-[#efcfcc] bg-[#fbf3f2] px-3 py-2 text-xs leading-5 text-[#8f3d3b]">{runError}</div>
            )}

            <label className="block text-xs text-slate-500">
              Sandbox environment
              <select
                className="select-field mt-1"
                value={environmentType}
                onChange={(event) => {
                  setEnvironmentType(event.target.value);
                  setCallState('idle');
                  setVisibleTurns(0);
                }}
              >
                {ENVIRONMENT_TYPES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-950">Pronunciation action</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Reusable capture test. v1 focuses on emails and phone numbers.</p>
                </div>
                <button
                  type="button"
                  className={pronunciationEnabled ? 'btn-primary min-h-8 px-3 py-1.5 text-xs' : 'btn-secondary min-h-8 px-3 py-1.5 text-xs'}
                  onClick={() => {
                    setPronunciationEnabled((current) => !current);
                    setCallState('idle');
                  }}
                >
                  {pronunciationEnabled ? 'On' : 'Off'}
                </button>
              </div>

              {pronunciationEnabled && (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs text-slate-500">
                      Entity
                      <select
                        className="select-field mt-1"
                        value={entityType}
                        onChange={(event) => {
                          const next = event.target.value as PronunciationEntityType;
                          setEntityType(next);
                          setTargetValue(PRONUNCIATION_PRESETS[next][0]);
                          setMode(next === 'email' ? 'spell_out' : 'grouped');
                          setCallState('idle');
                        }}
                      >
                        <option value="email">Email</option>
                        <option value="phone_number">Phone number</option>
                      </select>
                    </label>
                    <label className="block text-xs text-slate-500">
                      Mode
                      <select className="select-field mt-1" value={mode} onChange={(event) => setMode(event.target.value as PronunciationMode)}>
                        {MODES.map((item) => (
                          <option key={item} value={item}>{modeLabel(item)}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="block text-xs text-slate-500">
                    Target value
                    <input className="input-field mt-1" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    {PRONUNCIATION_PRESETS[entityType].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`rounded-md border px-2.5 py-1.5 text-xs ${preset === targetValue ? 'border-[#2f5ae0] bg-[#eef2ff] text-[#2448bb]' : 'border-slate-200 bg-white text-slate-600'}`}
                        onClick={() => selectPreset(preset)}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs text-slate-500">
                      Accent
                      <select className="select-field mt-1" value={accent} onChange={(event) => setAccent(event.target.value)}>
                        {ACCENTS.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="block text-xs text-slate-500">
                      Pace
                      <select className="select-field mt-1" value={pace} onChange={(event) => setPace(event.target.value as PronunciationPace)}>
                        {PACES.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Caller pronunciation</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{pronunciationSpec.spokenForms[0]}</p>
                    <button type="button" className="btn-secondary mt-3 min-h-8 px-3 py-1.5 text-xs" onClick={listenToPronunciation}>
                      Listen
                    </button>
                  </div>
                </div>
              )}
            </div>

            <details className="rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm text-slate-700">Advanced</summary>
              <div className="mt-4 space-y-3">
                <label className="block text-xs text-slate-500">max_turns<input className="input-field mt-1" defaultValue="8" /></label>
                <label className="block text-xs text-slate-500">caller_seed<input className="input-field mt-1" defaultValue={activeScenario.callerSeed} /></label>
                <label className="block text-xs text-slate-500">
                  noise_db
                  <input className="mt-2 w-full accent-[#2f5ae0]" type="range" min="0" max="12" defaultValue={activeScenario.persona.noise_db} />
                </label>
              </div>
            </details>
          </div>

          <button
            onClick={startOrEndCall}
            className="mt-auto flex min-h-12 items-center justify-center rounded-lg border border-[#2f5ae0] bg-[#2f5ae0] px-4 text-sm font-medium text-white hover:bg-[#2448bb]"
          >
            {callState === 'running' ? 'End Call' : 'Start Call'}
          </button>
        </aside>

        <section className="card flex min-h-[620px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-medium text-slate-950">Live call</h2>
              <p className="mt-1 text-xs text-slate-500">
                Turn {callState === 'idle' ? 0 : Math.max(visibleTurns, callState === 'complete' ? transcript.length : 0)} / {transcript.length}
              </p>
            </div>
            <span className="status-pill-running">{callState === 'idle' ? 'Ready' : callState}</span>
          </div>

          <div className="flex-1 space-y-5 bg-slate-50 p-5">
            {callState === 'idle' ? (
              <div className="flex h-full min-h-[410px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white">
                <div className="w-80">
                  <Waveform />
                </div>
                <p className="mt-5 text-sm text-slate-500">
                  {pronunciationEnabled ? 'Listen to the caller value, then start the sandbox call.' : 'Pick a scenario and start the sandbox call.'}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="mb-2 text-xs text-slate-500">Caller</p>
                    <Waveform active />
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-slate-500">Agent</p>
                    <Waveform active />
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_320px] gap-4">
                  <div className="space-y-3">
                    {activeSandboxRun?.liveKit && (
                      <div className="rounded-lg border border-[#cfd8ff] bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Agent connection</p>
                            <h3 className="mt-1 text-sm font-medium text-slate-950">Hosted sandbox room ready</h3>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              Connect your customer agent as the agent participant. Lightcurve stays in this Playground as the caller, observer, and scorer.
                            </p>
                          </div>
                          <span className="rounded-full border border-[#cfd8ff] bg-[#f6f8ff] px-2 py-0.5 text-xs text-[#2448bb]">
                            {activeSandboxRun.status ?? 'ready'}
                          </span>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Room</p>
                              <button
                                type="button"
                                className="text-xs text-[#2448bb]"
                                onClick={() => copyToClipboard(activeSandboxRun.liveKit?.roomName ?? '')}
                              >
                                Copy
                              </button>
                            </div>
                            <p className="mt-2 break-all font-mono text-xs text-slate-800">{activeSandboxRun.liveKit.roomName}</p>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">LiveKit URL</p>
                              <button
                                type="button"
                                className="text-xs text-[#2448bb]"
                                onClick={() => copyToClipboard(activeSandboxRun.liveKit?.liveKitUrl ?? '')}
                              >
                                Copy
                              </button>
                            </div>
                            <p className="mt-2 break-all font-mono text-xs text-slate-800">{activeSandboxRun.liveKit.liveKitUrl}</p>
                          </div>
                        </div>

                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Agent token</p>
                            <button
                              type="button"
                              className="text-xs text-[#2448bb]"
                              onClick={() => copyToClipboard(activeSandboxRun.liveKit?.agentToken ?? '')}
                            >
                              Copy
                            </button>
                          </div>
                          <p className="mt-2 max-h-20 overflow-auto break-all rounded-md bg-white p-2 font-mono text-[11px] text-slate-700">
                            {activeSandboxRun.liveKit.agentToken}
                          </p>
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                            <p className="text-slate-400">Provider</p>
                            <p className="mt-1 text-slate-800">{activeSandboxRun.provider ?? 'livekit'}</p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                            <p className="text-slate-400">Run ID</p>
                            <p className="mt-1 truncate font-mono text-slate-800">{activeSandboxRun.runId}</p>
                          </div>
                          <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                            <p className="text-slate-400">Next</p>
                            <p className="mt-1 text-slate-800">Join agent, then watch transcript</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {transcript.slice(0, callState === 'complete' ? transcript.length : visibleTurns).map((turn, index) => (
                      <div key={`${turn.speaker}-${index}-${turn.text}`} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs uppercase text-slate-500">{turn.speaker}</span>
                          {turn.latencyMs > 0 && <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs text-[#2448bb]">{turn.latencyMs}ms</span>}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{turn.text}</p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-4">
                    {activeSandboxRun?.liveKit && (
                      <div className="rounded-lg border border-slate-200 bg-white p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Developer controls</p>
                        <div className="mt-3 grid gap-2">
                          <button
                            type="button"
                            className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                            onClick={() => setAgentModalOpen(true)}
                          >
                            Edit connection
                          </button>
                          <button
                            type="button"
                            className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                            onClick={() => router.push(`/experiments/${activeSandboxRun.experimentId}/runs/${activeSandboxRun.runId}`)}
                          >
                            Open audit detail
                          </button>
                        </div>
                        <p className="mt-3 text-xs leading-5 text-slate-500">
                          The audit page is secondary. This panel is the live one-call workspace.
                        </p>
                      </div>
                    )}

                    <SandboxEnvironmentPanel
                      scenario={activeScenario}
                      environmentType={environmentType}
                      callState={callState}
                      visibleTurns={visibleTurns}
                    />

                    {pronunciationReport && (
                      <div className="rounded-lg border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Capture action</p>
                          <h3 className="mt-1 text-sm font-medium text-slate-950">{entityLabel(pronunciationReport.entityType)}</h3>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">{pronunciationReport.accent}</span>
                      </div>

                      <div className="mt-4 space-y-3 text-xs">
                        <div>
                          <p className="text-slate-400">Expected</p>
                          <p className="mt-1 break-all font-mono text-slate-900">{pronunciationReport.expectedValue}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Agent captured</p>
                          <p className="mt-1 break-all font-mono text-slate-900">{pronunciationReport.capturedValue ?? 'Pending until readback'}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Pacing</p>
                          <p className="mt-1 text-slate-700">
                            {pronunciationReport.pacing.driftPercent}% drift during readback
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {pronunciationReport.segments.slice(0, 5).map((segment) => (
                          <div key={segment.label}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-xs text-slate-500">{segment.label}</span>
                              <span className={`text-xs ${segment.pass ? 'text-[#2f6f5f]' : 'text-[#8f3d3b]'}`}>{segment.pass ? 'Pass' : 'Fail'}</span>
                            </div>
                            <ScoreBar value={segment.value} />
                          </div>
                        ))}
                      </div>
                      </div>
                    )}
                  </div>
                </div>

                {callState === 'complete' && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="card p-4"><p className="text-xs text-slate-500">MOS</p><div className="mt-3"><ScoreBar value={4.1} max={4.5} /></div></div>
                    <div className="card p-4"><p className="text-xs text-slate-500">Task Completion</p><div className="mt-3"><ScoreBar value={pronunciationReport?.segments.find((item) => item.label === 'Overall capture')?.value ?? 0.86} /></div></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      {pronunciationReport
                        ? 'Require exact readback before saving the captured value.'
                        : 'Confirm the next action before repeating policy or tool status.'}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {callState === 'complete' && (
            <div className="border-t border-slate-100 bg-white px-5 py-4">
              <div className="flex items-center gap-3">
                <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Play</button>
                <div className="flex-1"><Waveform /></div>
                <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={downloadTranscript}>Download</button>
                <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={startOrEndCall}>Re-run</button>
                <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => router.push(`/scenarios?fork=${baseScenario?.id ?? activeScenario.id}`)}>Fork Scenario</button>
                <button className="btn-primary min-h-8 px-3 py-1.5 text-xs" onClick={startOrEndCall}>
                  Start new real run
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {agentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-medium text-slate-950">Connect agent for this Playground call</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Keep this simple: use the hosted sandbox for a quick one-off test, or switch to a runner URL only if your team already has one.
                </p>
              </div>
              <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setAgentModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  className={`min-h-10 rounded-md px-3 text-sm ${connectionMode === 'lightcurve_room' ? 'bg-white text-[#2448bb] shadow-sm' : 'text-slate-600'}`}
                  onClick={() => {
                    setConnectionMode('lightcurve_room');
                    setRunError('');
                  }}
                >
                  Hosted sandbox
                </button>
                <button
                  type="button"
                  className={`min-h-10 rounded-md px-3 text-sm ${connectionMode === 'https_runner' ? 'bg-white text-[#2448bb] shadow-sm' : 'text-slate-600'}`}
                  onClick={() => {
                    setConnectionMode('https_runner');
                    setRunError('');
                  }}
                >
                  HTTPS runner
                </button>
              </div>

              {connectionMode === 'lightcurve_room' ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-medium text-slate-950">Recommended for Playground</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Lightcurve creates a short-lived sandbox room after you press Start Call. Your agent joins that room as the agent under test; Lightcurve joins as the synthetic caller and scores the conversation.
                  </p>
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    <p className="font-medium text-slate-800">Using Vapi?</p>
                    <p className="mt-1">
                      For one phone-call realism check, use Experiments &gt; Create Experiment &gt; Vapi. Enter your Vapi API key, your agent assistant ID, the phone number your agent answers, and the Vapi phone-number UUID used as the caller line.
                    </p>
                  </div>
                  {activeSandboxRun?.liveKit ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-[#d8e0ff] bg-[#f6f8ff] p-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Room</p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-800">{activeSandboxRun.liveKit.roomName}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">LiveKit URL</p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-800">{activeSandboxRun.liveKit.liveKitUrl}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Agent token</p>
                        <p className="mt-1 max-h-24 overflow-auto break-all rounded-md border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-700">
                          {activeSandboxRun.liveKit.agentToken}
                        </p>
                      </div>
                      <button type="button" className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setAgentModalOpen(false)}>
                        Return to live call
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                      Press Start Call to generate the room details. Nothing is billed to a provider account in this idle preview.
                    </div>
                  )}
                </div>
              ) : (
                <label className="block text-xs text-slate-500">
                  Compatible HTTPS runner URL
                  <input
                    className="input-field mt-1"
                    value={agent}
                    onChange={(event) => setAgent(event.target.value)}
                    placeholder="https://your-runner.example.com/lightcurve"
                  />
                  <span className="mt-2 block leading-5 text-slate-500">
                    Advanced path. This endpoint must implement Lightcurve's runner contract. Use hosted sandbox if you just want to test a voice agent quickly.
                  </span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
