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

const ACCENTS = ['en-US', 'en-IN', 'hi-IN', 'en-GB', 'es-ES', 'ar-SA', 'fr-FR', 'pt-BR', 'de-DE', 'pl-PL'];
const PACES: PronunciationPace[] = ['slow', 'normal', 'fast'];
const MODES: PronunciationMode[] = ['normal', 'spell_out', 'grouped', 'correction'];
const ENVIRONMENT_TYPES = ['CRM', 'Calendar'];
type PlaygroundConnectionMode = 'lightcurve_room' | 'phone_verification' | 'https_runner';
type LiveKitJoinOption = {
  id: string;
  label: string;
  summary: string;
  steps?: string[];
  code?: string;
};
type ActiveSandboxRun = {
  experimentId: string;
  runId: string;
  sandboxEnvironmentId?: string;
  provider?: string;
  status?: string;
  externalCallId?: string;
  externalStatus?: string;
  liveKit?: {
    roomName: string;
    liveKitUrl: string;
    agentToken: string;
    instructions: string;
    joinOptions?: LiveKitJoinOption[];
  };
};
type LiveTraceTurn = {
  speaker: 'caller' | 'agent';
  text: string;
  latencyMs?: number | null;
};
type SandboxFixture = {
  environmentId?: string;
  sourceId?: string | null;
  title: string;
  endpoint: string;
  status: string;
  rows: Array<{ label: string; value: string }>;
  timeline: Array<{ tool: string; detail: string; status?: 'queued' | 'calling' | '200 OK' | 'blocked' }>;
};
type SandboxSource = {
  id: string;
  type: string;
  name: string;
  sourceKind: string;
  sampleRows?: unknown;
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
  if (accent === 'ar-SA') return 'ar-SA';
  if (accent === 'fr-FR') return 'fr-FR';
  if (accent === 'pt-BR') return 'pt-BR';
  if (accent === 'de-DE') return 'de-DE';
  if (accent === 'pl-PL') return 'pl-PL';
  return 'en-US';
}

function speechRate(pace: PronunciationPace) {
  if (pace === 'slow') return 0.72;
  if (pace === 'fast') return 1.18;
  return 0.92;
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function looksLikePhoneNumber(value: string) {
  return /^\+\d{8,15}$/.test(value.trim().replace(/[\s().-]/g, ''));
}

function looksLikePhoneOrSip(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('sip:') || looksLikePhoneNumber(trimmed);
}

function normalizePhone(value: string) {
  return value.trim().replace(/[\s().-]/g, '');
}

function normalizePhoneOrSip(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith('sip:') ? trimmed : normalizePhone(trimmed);
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

function parseDelimitedLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseSandboxRows(input: string) {
  const text = input.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('JSON must be an array of records.');
    return parsed.filter((row) => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown>[];
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one record.');
  const headers = parseDelimitedLine(lines[0]).map((header) => header.trim()).filter(Boolean);
  return lines.slice(1).map((line) => {
    const cells = parseDelimitedLine(line);
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = cells[index] ?? '';
      return record;
    }, {});
  });
}

function sandboxTemplate(type: string) {
  if (type === 'Calendar') {
    return [
      'date,slot,timezone,availability,booking_status,customer_name,notes',
      '2026-06-03,09:30,America/New_York,available,open,Jordan,Initial appointment',
      '2026-06-03,10:00,America/New_York,conflict,held_by_another_customer,Maya,Conflict guard',
    ].join('\n');
  }
  return [
    'customer_name,email,phone,account_status,order_status,record_status,pending_value',
    'Jordan,john.smith@gmail.com,+12164748341,active,refund_review_required,single_match,',
    'Jordan,duplicate.customer@example.com,+18005550007,active,duplicate_record,duplicate_match,',
  ].join('\n');
}

function SandboxEnvironmentPanel({
  scenario,
  environmentType,
  environmentId,
  callState,
  visibleTurns,
}: {
  scenario: StoredScenario;
  environmentType: string;
  environmentId?: string;
  callState: 'idle' | 'running' | 'complete';
  visibleTurns: number;
}) {
  const [environment, setEnvironment] = useState<SandboxFixture | null>(null);
  const [toolError, setToolError] = useState('');
  const [executedActions, setExecutedActions] = useState<string[]>([]);
  const tool = environmentType === 'Calendar' ? 'calendar' : 'crm';
  const actionPlan = useMemo(
    () => tool === 'calendar'
      ? ['find_slots', 'detect_conflict', 'hold_slot', 'confirm_booking']
      : ['customer', 'validate_field', 'save_pending', 'confirm_save'],
    [tool],
  );
  const phase = callState === 'complete'
    ? actionPlan.length
    : Math.max(0, Math.min(visibleTurns - 1, actionPlan.length - 1));

  useEffect(() => {
    let cancelled = false;
    async function loadEnvironment() {
      if (!environmentId) {
        setEnvironment(null);
        setExecutedActions([]);
        return;
      }
      setToolError('');
      setExecutedActions([]);
      try {
        const response = await fetch(`/api/sandbox/environments/${environmentId}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? 'Sandbox data unavailable.');
        if (!cancelled) setEnvironment(payload.environment as SandboxFixture);
      } catch (error) {
        if (!cancelled) setToolError(error instanceof Error ? error.message : 'Sandbox data unavailable.');
      }
    }

    void loadEnvironment();
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  useEffect(() => {
    if (!environmentId || callState === 'idle') return;
    const action = actionPlan[Math.max(0, Math.min(visibleTurns - 1, actionPlan.length - 1))];
    if (!action || executedActions.includes(action)) return;
    let cancelled = false;

    async function runAction() {
      setToolError('');
      try {
        const response = await fetch(`/api/sandbox/${tool}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            environmentId,
            domain: scenario.domain,
            language: scenario.language,
            personaName: scenario.persona.name,
            goal: scenario.persona.goal,
            interrupts: scenario.persona.interrupts,
            callerSeed: scenario.callerSeed,
            entityType: scenario.pronunciation?.entityType,
            targetValue: scenario.pronunciation?.targetValue,
            value: scenario.pronunciation?.targetValue,
          }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? 'Sandbox tool failed.');
        if (!cancelled) {
          setEnvironment(payload.environment as SandboxFixture);
          setExecutedActions((current) => current.includes(action) ? current : [...current, action]);
        }
      } catch (error) {
        if (!cancelled) setToolError(error instanceof Error ? error.message : 'Sandbox tool failed.');
      }
    }

    void runAction();
    return () => {
      cancelled = true;
    };
  }, [actionPlan, callState, environmentId, executedActions, scenario, tool, visibleTurns]);

  if (!environmentId) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">
        A fresh {environmentType} copy appears when the call starts. Source data is never mutated.
      </div>
    );
  }

  if (!environment) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">
        Preparing isolated {environmentType} data...
        {toolError && <div className="mt-2 rounded-md border border-[#e3c3c1] bg-[#fbf3f2] px-3 py-2 text-[#8f3d3b]">{toolError}</div>}
      </div>
    );
  }

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

        {toolError && (
          <div className="mt-3 rounded-md border border-[#e3c3c1] bg-[#fbf3f2] px-3 py-2 text-xs text-[#8f3d3b]">
            {toolError}
          </div>
        )}

        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Tool timeline</p>
          {environment.timeline.map((item, index) => {
            const active = callState === 'running' && phase === index;
            const complete = callState === 'complete' || phase > index;
            const visibleStatus = complete ? (item.status ?? '200 OK') : active ? 'calling' : 'queued';
            return (
              <div
                key={`${item.tool}-${index}`}
                className={`rounded-md border px-3 py-2 ${active ? 'border-[#cfd8ff] bg-[#f5f7ff]' : visibleStatus === 'blocked' ? 'border-[#e3c3c1] bg-[#fbf3f2]' : 'border-slate-100 bg-slate-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-[11px] text-slate-800">{item.tool}</code>
                  <span className={`shrink-0 text-[11px] ${visibleStatus === 'blocked' ? 'text-[#8f3d3b]' : complete ? 'text-[#2f6f5f]' : active ? 'text-[#2448bb]' : 'text-slate-400'}`}>
                    {visibleStatus}
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
  const [vapiAgentNumber, setVapiAgentNumber] = useState('');
  const [providerTurns, setProviderTurns] = useState<LiveTraceTurn[]>([]);
  const [providerScores, setProviderScores] = useState<Array<{ metricName: string; value: number }>>([]);
  const [pollingRun, setPollingRun] = useState(false);
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
  const [copiedJoinValue, setCopiedJoinValue] = useState('');
  const [sandboxSources, setSandboxSources] = useState<SandboxSource[]>([]);
  const [sandboxSourceId, setSandboxSourceId] = useState('');
  const [sandboxSetupOpen, setSandboxSetupOpen] = useState(false);
  const [sandboxUploadText, setSandboxUploadText] = useState('');
  const [sandboxPreviewRows, setSandboxPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [sandboxSetupName, setSandboxSetupName] = useState('');
  const [sandboxSetupError, setSandboxSetupError] = useState('');
  const [sandboxSaving, setSandboxSaving] = useState(false);

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

  useEffect(() => {
    let cancelled = false;

    async function loadSandboxSources() {
      try {
        const response = await fetch(`/api/sandbox/sources?type=${environmentType.toLowerCase()}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? 'Sandbox sources unavailable.');
        const sources = (Array.isArray(payload?.sources) ? payload.sources : []) as SandboxSource[];
        if (!cancelled) {
          setSandboxSources(sources);
          setSandboxSourceId((current) => {
            if (current && sources.some((source) => source.id === current)) return current;
            return sources[0]?.id ?? '';
          });
        }
      } catch (error) {
        if (!cancelled) {
          setSandboxSources([]);
          setSandboxSourceId('');
          setRunError(error instanceof Error ? error.message : 'Sandbox sources unavailable.');
        }
      }
    }

    void loadSandboxSources();
    return () => {
      cancelled = true;
    };
  }, [environmentType]);

  const baseScenario = useMemo(() => {
    return scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0];
  }, [scenarioId, scenarios]);

  const selectedSandboxSource = useMemo(() => {
    return sandboxSources.find((source) => source.id === sandboxSourceId) ?? null;
  }, [sandboxSourceId, sandboxSources]);

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

  const providerBackedLiveCall = activeSandboxRun?.provider === 'vapi';
  const displayedTranscript = providerBackedLiveCall ? providerTurns : transcript.slice(0, callState === 'complete' ? transcript.length : visibleTurns);
  const liveMosScore = providerScores.find((score) => score.metricName === 'mos')?.value ?? 4.1;
  const liveTaskScore =
    providerScores.find((score) => score.metricName === 'task_completed')?.value
    ?? pronunciationReport?.segments.find((item) => item.label === 'Overall capture')?.value
    ?? 0.86;

  useEffect(() => {
    if (callState !== 'running' || providerBackedLiveCall) return;
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
  }, [callState, providerBackedLiveCall, transcript.length]);

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

  function openSandboxSetup() {
    const template = sandboxTemplate(environmentType);
    setSandboxUploadText((current) => current || template);
    setSandboxPreviewRows(parseSandboxRows(template).slice(0, 6));
    setSandboxSetupName((current) => current || `${environmentType} sandbox data`);
    setSandboxSetupError('');
    setSandboxSetupOpen(true);
  }

  function previewSandboxUpload() {
    try {
      const rows = parseSandboxRows(sandboxUploadText);
      if (!rows.length) throw new Error('Add at least one row.');
      setSandboxPreviewRows(rows.slice(0, 6));
      setSandboxSetupError('');
    } catch (error) {
      setSandboxPreviewRows([]);
      setSandboxSetupError(error instanceof Error ? error.message : 'Unable to read this data.');
    }
  }

  async function saveSandboxSource() {
    let rows: Record<string, unknown>[] = [];
    try {
      rows = parseSandboxRows(sandboxUploadText);
      if (!rows.length) throw new Error('Add at least one row.');
    } catch (error) {
      setSandboxSetupError(error instanceof Error ? error.message : 'Unable to read this data.');
      return;
    }

    setSandboxSaving(true);
    setSandboxSetupError('');
    try {
      const response = await fetch('/api/sandbox/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: environmentType,
          name: sandboxSetupName || `${environmentType} sandbox data`,
          rows,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? 'Sandbox source could not be saved.');
      const source = payload.source as SandboxSource;
      setSandboxSources((current) => [source, ...current.filter((item) => item.id !== source.id)]);
      setSandboxSourceId(source.id);
      setSandboxPreviewRows(rows.slice(0, 6));
      setSandboxSetupOpen(false);
      trackLightcurveEvent('Sandbox Source Saved', {
        environment_type: environmentType,
        row_count: rows.length,
      });
    } catch (error) {
      setSandboxSetupError(error instanceof Error ? error.message : 'Sandbox source could not be saved.');
    } finally {
      setSandboxSaving(false);
    }
  }

  async function pollActiveRun(runOverride?: ActiveSandboxRun) {
    const targetRun = runOverride ?? activeSandboxRun;
    if (!targetRun?.runId || pollingRun) return;
    setPollingRun(true);
    try {
      const response = await fetch(`/api/runs/${targetRun.runId}/poll`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? 'Unable to refresh provider call.');
      const turns = Array.isArray(payload?.traces)
        ? payload.traces.map((trace: Record<string, unknown>) => ({
            speaker: trace.speaker === 'agent' ? 'agent' : 'caller',
            text: String(trace.text ?? ''),
            latencyMs: typeof trace.totalLatencyMs === 'number' ? trace.totalLatencyMs : null,
          })).filter((turn: LiveTraceTurn) => turn.text)
        : [];
      const scores = Array.isArray(payload?.scores)
        ? payload.scores.map((score: Record<string, unknown>) => ({
            metricName: String(score.metricName ?? ''),
            value: Number(score.value ?? 0),
          })).filter((score: { metricName: string; value: number }) => score.metricName)
        : [];
      setProviderTurns(turns);
      setProviderScores(scores);
      setActiveSandboxRun((current) => current ? {
        ...current,
        status: payload?.run?.status ?? current.status,
        externalStatus: payload?.run?.externalStatus ?? payload?.externalStatus ?? current.externalStatus,
      } : current);
      if (payload?.run?.status === 'complete' || payload?.run?.status === 'failed') {
        setCallState('complete');
      }
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Unable to refresh provider call.');
    } finally {
      setPollingRun(false);
    }
  }

  async function startOrEndCall(modeOverride?: PlaygroundConnectionMode) {
    if (callState === 'running') {
      if (providerBackedLiveCall) {
        await pollActiveRun();
        return;
      }
      setVisibleTurns(transcript.length);
      setCallState('complete');
      trackLightcurveEvent('Playground Call Ended', {
        scenario_id: activeScenario?.id,
        transcript_turns: transcript.length,
      });
      return;
    }
    if (!activeScenario) return;
    const selectedConnectionMode = modeOverride ?? connectionMode;
    const usesHttpsRunner = selectedConnectionMode === 'https_runner';
    const usesPhoneVerification = selectedConnectionMode === 'phone_verification';
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
    if (usesPhoneVerification) {
      if (!looksLikePhoneOrSip(vapiAgentNumber)) {
        setRunError('Enter the phone number or SIP URI your agent answers, for example +12164748341 or sip:agent@example.com.');
        return;
      }
    }
    setRunError('');
    setVisibleTurns(0);
    setProviderTurns([]);
    setProviderScores([]);
    setActiveSandboxRun(null);
    setCallState('running');
    trackLightcurveEvent('Playground Sandbox Started', {
      scenario_id: baseScenario?.id ?? activeScenario.id,
      environment_type: environmentType,
      pronunciation_enabled: pronunciationEnabled,
      entity_type: pronunciationEnabled ? entityType : undefined,
      connection_mode: selectedConnectionMode,
    });
    try {
      const connection = usesHttpsRunner ? await createPlaygroundConnection(agent.trim()) : null;
      const scenarioForRun = activeScenario.pronunciation ? activeScenario : baseScenario ?? activeScenario;
      const scenarioOverrides = activeScenario.pronunciation ? [activeScenario] : [];
      const phoneTarget = normalizePhoneOrSip(vapiAgentNumber);
      const agentType = usesPhoneVerification ? 'vapi' : usesHttpsRunner ? 'custom_webrtc' : 'livekit';
      const agentConfig = usesPhoneVerification
        ? {
            mode: 'vobiz_phone_verification',
            bridge: 'vobiz_phone',
            targetAgentNumber: phoneTarget,
            endpointType: phoneTarget.startsWith('sip:') ? 'sip' : 'phone',
            declaredProvider: 'playground_phone',
            costMode: 'phone_realism',
            pronunciation: activeScenario.pronunciation ?? null,
            sandboxEnvironment: environmentType,
            sandboxSourceId: sandboxSourceId || undefined,
          }
        : {
            endpointType: usesHttpsRunner ? 'webrtc' : 'lightcurve_room',
            endpoint: usesHttpsRunner ? agent.trim() : 'lightcurve://hosted-room',
            mode: usesHttpsRunner ? 'https_runner' : 'lightcurve_hosted_room',
            costMode: 'low_cost_testing',
            bridge: usesHttpsRunner ? 'custom_https_runner' : 'lightcurve_room',
            pronunciation: activeScenario.pronunciation ?? null,
            sandboxEnvironment: environmentType,
            sandboxSourceId: sandboxSourceId || undefined,
          };
      const experimentResponse = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${activeScenario.name} playground check`,
          agentType,
          agentConnectionId: connection?.id ?? null,
          agentConfig,
          webrtcEndpoint: usesPhoneVerification ? `phone:${phoneTarget}` : usesHttpsRunner ? agent.trim() : 'lightcurve://hosted-room',
          scenarioIds: [scenarioForRun.id],
          scenarioOverrides,
          gitSha: 'playground',
        }),
      });
      const experimentPayload = await experimentResponse.json().catch(() => null);
      if (!experimentResponse.ok) throw new Error(experimentPayload?.error ?? 'Unable to create sandbox run.');
      const run = experimentPayload?.runs?.[0];
      if (!run?.id) throw new Error('Sandbox run was not created.');

      const environmentResponse = await fetch('/api/sandbox/environments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: environmentType,
          sourceId: sandboxSourceId || undefined,
          runId: run.id,
          scenario: activeScenario,
        }),
      });
      const environmentPayload = await environmentResponse.json().catch(() => null);
      if (!environmentResponse.ok) throw new Error(environmentPayload?.error ?? 'Sandbox data copy could not be created.');

      const startResponse = await fetch(`/api/runs/${run.id}/start`, { method: 'POST' });
      const startPayload = await startResponse.json().catch(() => null);
      if (!startResponse.ok) throw new Error(startPayload?.error ?? 'Unable to start sandbox runner.');

      trackLightcurveEvent('Playground Sandbox Queued', {
        experiment_id: experimentPayload.experiment.id,
        run_id: run.id,
        provider: startPayload?.provider,
        status: startPayload?.status,
      });
      let liveKitSession = startPayload?.liveKit;
      if (!usesPhoneVerification && liveKitSession) {
        try {
          const sessionResponse = await fetch(`/api/runs/${run.id}/livekit-session`, { cache: 'no-store' });
          const sessionPayload = await sessionResponse.json().catch(() => null);
          if (sessionResponse.ok && sessionPayload?.agentToken) {
            liveKitSession = sessionPayload;
          }
        } catch {
          // The inline room fields from startPayload are still enough for the user to connect.
        }
      }

      const nextRun: ActiveSandboxRun = {
        experimentId: experimentPayload.experiment.id,
        runId: run.id,
        provider: startPayload?.provider,
        status: startPayload?.status,
        externalCallId: startPayload?.externalCallId,
        externalStatus: startPayload?.externalStatus,
        liveKit: liveKitSession,
        sandboxEnvironmentId: environmentPayload?.environment?.environmentId,
      };
      setActiveSandboxRun(nextRun);
      if (usesPhoneVerification) {
        window.setTimeout(() => {
          void pollActiveRun(nextRun);
        }, 2500);
      }
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

  async function openLightcurveRoomDetails() {
    setRunError('');
    setConnectionMode('lightcurve_room');
    setAgentModalOpen(true);
    if (callState === 'idle' && !activeSandboxRun?.liveKit) {
      await startOrEndCall('lightcurve_room');
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

  async function copyToClipboard(value: string, copiedKey?: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const key = copiedKey ?? (value.startsWith('ey') ? 'agent-token' : value.startsWith('wss://') ? 'room-url' : 'room-name');
      setCopiedJoinValue(key);
      window.setTimeout(() => setCopiedJoinValue((current) => (current === key ? '' : current)), 1500);
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
                      ? 'Connect your agent to a Lightcurve room for a low-friction one-call test.'
                      : connectionMode === 'phone_verification'
                        ? 'Call the phone or SIP endpoint your agent answers for a real verification check.'
                        : 'Advanced HTTPS runner connected for this Playground call.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                  onClick={() => void openLightcurveRoomDetails()}
                >
                  Connect
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-[#d8e0ff] bg-[#f6f8ff] px-3 py-2 text-xs leading-5 text-slate-600">
                Playground tests one customer agent at a time. Experiments are for broad suites and promotion checks.
              </div>
            </div>

            {runError && (
              <div className="rounded-lg border border-[#efcfcc] bg-[#fbf3f2] px-3 py-2 text-xs leading-5 text-[#8f3d3b]">{runError}</div>
            )}

            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-950">Sandbox data</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Each run gets a private copy. Your source file stays unchanged.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                  onClick={openSandboxSetup}
                >
                  Setup
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block text-xs text-slate-500">
                  Environment
                  <select
                    className="select-field mt-1"
                    value={environmentType}
                    onChange={(event) => {
                      setEnvironmentType(event.target.value);
                      setSandboxSourceId('');
                      setCallState('idle');
                      setVisibleTurns(0);
                    }}
                  >
                    {ENVIRONMENT_TYPES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-500">
                  Source
                  <select
                    className="select-field mt-1"
                    value={sandboxSourceId}
                    onChange={(event) => {
                      setSandboxSourceId(event.target.value);
                      setCallState('idle');
                      setVisibleTurns(0);
                    }}
                  >
                    <option value="">Starter data</option>
                    {sandboxSources.map((source) => (
                      <option key={source.id} value={source.id}>{source.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {selectedSandboxSource
                  ? `${selectedSandboxSource.name} will be copied into this call.`
                  : 'No upload required. Lightcurve will create safe starter data from the selected scenario.'}
              </p>
            </div>

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
            onClick={() => void startOrEndCall()}
            className="mt-auto flex min-h-12 items-center justify-center rounded-lg border border-[#2f5ae0] bg-[#2f5ae0] px-4 text-sm font-medium text-white hover:bg-[#2448bb]"
          >
            {callState === 'running' && providerBackedLiveCall ? 'Refresh status' : callState === 'running' ? 'End Call' : 'Start Call'}
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

                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-3">
                    {activeSandboxRun && (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#cfd8ff] bg-white px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-[#2f5ae0]" />
                            <h3 className="text-sm font-medium text-slate-950">
                              {activeSandboxRun.provider === 'vobiz' ? 'Managed phone verification' : 'Lightcurve room'}
                            </h3>
                            <span className="rounded-full border border-[#cfd8ff] bg-[#f6f8ff] px-2 py-0.5 text-[11px] text-[#2448bb]">
                              {activeSandboxRun.status ?? 'ready'}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {activeSandboxRun.liveKit?.roomName ?? activeSandboxRun.externalCallId ?? activeSandboxRun.runId}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                            onClick={() => setAgentModalOpen(true)}
                          >
                            Connection
                          </button>
                          {(activeSandboxRun.provider === 'vobiz' || activeSandboxRun.externalCallId) && (
                            <button
                              type="button"
                              className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                              onClick={() => void pollActiveRun()}
                              disabled={pollingRun}
                            >
                              {pollingRun ? 'Refreshing...' : 'Refresh'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                            onClick={() => router.push(`/experiments/${activeSandboxRun.experimentId}/runs/${activeSandboxRun.runId}`)}
                          >
                            Audit detail
                          </button>
                        </div>
                      </div>
                    )}

                    {displayedTranscript.map((turn, index) => (
                      <div key={`${turn.speaker}-${index}-${turn.text}`} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs uppercase text-slate-500">{turn.speaker}</span>
                          {(turn.latencyMs ?? 0) > 0 && <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs text-[#2448bb]">{turn.latencyMs}ms</span>}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{turn.text}</p>
                      </div>
                    ))}
                    {providerBackedLiveCall && displayedTranscript.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-center text-sm leading-6 text-slate-500">
                        Waiting for provider transcript. Refresh after the call ends, or open the audit detail if you need raw provider status.
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <details open className="rounded-lg border border-slate-200 bg-white p-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-900">
                        Sandbox tools
                        <span className="ml-2 text-xs font-normal text-slate-400">{environmentType}</span>
                      </summary>
                      <div className="mt-3">
                        <SandboxEnvironmentPanel
                          scenario={activeScenario}
                          environmentType={environmentType}
                          environmentId={activeSandboxRun?.sandboxEnvironmentId}
                          callState={callState}
                          visibleTurns={visibleTurns}
                        />
                      </div>
                    </details>
                  </div>
                </div>

                {callState === 'complete' && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="card p-4"><p className="text-xs text-slate-500">MOS</p><div className="mt-3"><ScoreBar value={liveMosScore} max={4.5} /></div></div>
                    <div className="card p-4"><p className="text-xs text-slate-500">Task Completion</p><div className="mt-3"><ScoreBar value={liveTaskScore} /></div></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      {pronunciationReport ? (
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500">Capture report</p>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500">
                              {entityLabel(pronunciationReport.entityType)}
                            </span>
                          </div>
                          <p className="mt-3 break-all font-mono text-xs text-slate-900">{pronunciationReport.expectedValue}</p>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-slate-400">Exact</p>
                              <p className={pronunciationReport.segments[0]?.pass ? 'text-[#2f6f5f]' : 'text-[#8f3d3b]'}>
                                {pronunciationReport.segments[0]?.pass ? 'Pass' : 'Fail'}
                              </p>
                            </div>
                            <div>
                              <p className="text-slate-400">Readback</p>
                              <p className={pronunciationReport.segments[1]?.pass ? 'text-[#2f6f5f]' : 'text-[#8f3d3b]'}>
                                {pronunciationReport.segments[1]?.pass ? 'Pass' : 'Fail'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        'Confirm the next action before repeating policy or tool status.'
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {callState === 'complete' && (
            <div className="border-t border-slate-100 bg-white px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-secondary min-h-8 shrink-0 px-3 py-1.5 text-xs">Play</button>
                <div className="min-w-52 flex-1"><Waveform /></div>
                <button className="btn-secondary min-h-8 shrink-0 px-3 py-1.5 text-xs" onClick={downloadTranscript}>Download</button>
                <button className="btn-secondary min-h-8 shrink-0 px-3 py-1.5 text-xs" onClick={() => void startOrEndCall()}>Re-run</button>
                <button className="btn-secondary min-h-8 shrink-0 px-3 py-1.5 text-xs" onClick={() => router.push(`/scenarios?fork=${baseScenario?.id ?? activeScenario.id}`)}>Fork Scenario</button>
                <button className="btn-primary min-h-8 shrink-0 px-3 py-1.5 text-xs" onClick={() => void startOrEndCall()}>
                  Start new call
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {sandboxSetupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-medium text-slate-950">Sandbox data</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Upload {environmentType} data once. Each call gets an isolated copy.
                </p>
              </div>
              <button type="button" className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setSandboxSetupOpen(false)}>
                Close
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label className="block text-xs text-slate-500">
                  Source name
                  <input
                    className="input-field mt-1"
                    value={sandboxSetupName}
                    onChange={(event) => setSandboxSetupName(event.target.value)}
                    placeholder={`${environmentType} sandbox data`}
                  />
                </label>
                <button type="button" className="btn-secondary mt-5 min-h-10 px-3 text-xs" onClick={() => {
                  const template = sandboxTemplate(environmentType);
                  setSandboxUploadText(template);
                  setSandboxPreviewRows(parseSandboxRows(template).slice(0, 6));
                  setSandboxSetupError('');
                }}>
                  Use template
                </button>
              </div>

              <label className="block text-xs text-slate-500">
                Paste CSV or JSON array
                <textarea
                  className="input-field mt-1 min-h-36 font-mono text-xs leading-5"
                  value={sandboxUploadText}
                  onChange={(event) => setSandboxUploadText(event.target.value)}
                  placeholder={sandboxTemplate(environmentType)}
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-5 text-slate-500">
                  Required fields are flexible. Lightcurve keeps every column and uses known names like email, phone, date, slot, timezone, and status.
                </p>
                <button type="button" className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={previewSandboxUpload}>
                  Preview
                </button>
              </div>

              {sandboxSetupError && (
                <div className="rounded-lg border border-[#efcfcc] bg-[#fbf3f2] px-3 py-2 text-xs leading-5 text-[#8f3d3b]">
                  {sandboxSetupError}
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">Preview</p>
                  <span className="text-xs text-slate-400">{sandboxPreviewRows.length ? `${sandboxPreviewRows.length} rows shown` : 'No preview yet'}</span>
                </div>
                {sandboxPreviewRows.length ? (
                  <div className="max-h-44 overflow-auto rounded-md border border-slate-200 bg-white">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          {Object.keys(sandboxPreviewRows[0] ?? {}).slice(0, 5).map((key) => (
                            <th key={key} className="px-3 py-2 font-medium">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sandboxPreviewRows.map((row, rowIndex) => (
                          <tr key={`preview-${rowIndex}`} className="border-t border-slate-100">
                            {Object.keys(sandboxPreviewRows[0] ?? {}).slice(0, 5).map((key) => (
                              <td key={`${rowIndex}-${key}`} className="max-w-44 truncate px-3 py-2 text-slate-700">{String(row[key] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
                    Paste data and preview it before saving.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" className="btn-secondary min-h-9 px-3 py-1.5 text-xs" onClick={() => setSandboxSetupOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="btn-primary min-h-9 px-3 py-1.5 text-xs" onClick={() => void saveSandboxSource()} disabled={sandboxSaving}>
                  {sandboxSaving ? 'Saving...' : 'Save sandbox source'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {agentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/30 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-4 py-3">
              <div>
                <h2 className="text-base font-medium text-slate-950">Connect your agent</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Use the Lightcurve room details below to join the agent you want to test.
                </p>
              </div>
              <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setAgentModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="max-h-[calc(100vh-150px)] space-y-3 overflow-y-auto p-4">
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  className={`min-h-9 rounded-md px-3 text-xs ${connectionMode === 'lightcurve_room' ? 'bg-white text-[#2448bb] shadow-sm' : 'text-slate-600'}`}
                  onClick={() => {
                    setConnectionMode('lightcurve_room');
                    setRunError('');
                  }}
                >
                  Lightcurve room
                </button>
                <button
                  type="button"
                  className={`min-h-9 rounded-md px-3 text-xs ${connectionMode === 'phone_verification' ? 'bg-white text-[#2448bb] shadow-sm' : 'text-slate-600'}`}
                  onClick={() => {
                    setConnectionMode('phone_verification');
                    setRunError('');
                  }}
                >
                  Real phone
                </button>
                <button
                  type="button"
                  className={`min-h-9 rounded-md px-3 text-xs ${connectionMode === 'https_runner' ? 'bg-white text-[#2448bb] shadow-sm' : 'text-slate-600'}`}
                  onClick={() => {
                    setConnectionMode('https_runner');
                    setRunError('');
                  }}
                >
                  HTTPS runner
                </button>
              </div>

              {connectionMode === 'lightcurve_room' ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  {activeSandboxRun?.liveKit ? (
                    <div className="space-y-3 rounded-lg border border-[#d8e0ff] bg-[#f6f8ff] p-3">
                      <div>
                        <p className="text-sm font-medium text-slate-950">Lightcurve room details</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Paste these one-time values into your agent runtime. Lightcurve joins this room as the synthetic caller and judge.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Room URL</p>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(activeSandboxRun.liveKit?.liveKitUrl ?? '', 'modal-room-url')}
                              className="text-xs text-[#2448bb]"
                            >
                              {copiedJoinValue === 'modal-room-url' ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <p className="mt-1.5 break-all font-mono text-[11px] leading-5 text-slate-800">{activeSandboxRun.liveKit.liveKitUrl}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Room</p>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(activeSandboxRun.liveKit?.roomName ?? '', 'modal-room-name')}
                              className="text-xs text-[#2448bb]"
                            >
                              {copiedJoinValue === 'modal-room-name' ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <p className="mt-1.5 break-all font-mono text-[11px] leading-5 text-slate-800">{activeSandboxRun.liveKit.roomName}</p>
                        </div>
                      </div>
                      <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <label className="block text-xs font-medium text-slate-600">Agent join token</label>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(activeSandboxRun.liveKit?.agentToken ?? '', 'modal-agent-token')}
                            className="text-xs text-[#2448bb]"
                          >
                            {copiedJoinValue === 'modal-agent-token' ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <textarea className="input-field max-h-24 min-h-16 font-mono text-[11px] leading-5" readOnly value={activeSandboxRun.liveKit.agentToken} />
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                          Token is short-lived and scoped to this room. Start the agent soon after creating the Playground call.
                        </p>
                      </div>

                      <div className="rounded-lg border border-[#cfd8ff] bg-white p-2.5 text-xs leading-relaxed text-[#526894]">
                        {activeSandboxRun.liveKit.instructions}
                      </div>

                      {Array.isArray(activeSandboxRun.liveKit.joinOptions) && (
                        <div className="space-y-3">
                          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Agent runtime</h3>
                          {activeSandboxRun.liveKit.joinOptions.map((option) => (
                            <details key={option.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                              <summary className="cursor-pointer text-sm font-medium text-slate-900">
                                {option.label}
                                <span className="ml-2 text-xs font-normal text-slate-400">{option.summary}</span>
                              </summary>
                              <div className="mt-3 grid gap-3">
                                <div className="grid gap-1.5 text-xs leading-relaxed text-slate-500">
                                  {(option.steps ?? []).map((stepText, index) => (
                                    <p key={`${option.id}-${index}`}>{stepText}</p>
                                  ))}
                                </div>
                                {option.code && (
                                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <span className="text-xs font-medium text-slate-500">Copy-ready setup</span>
                                      <button
                                        type="button"
                                        onClick={() => copyToClipboard(option.code ?? '', `modal-${option.id}`)}
                                        className="text-xs text-[#2448bb]"
                                      >
                                        {copiedJoinValue === `modal-${option.id}` ? 'Copied' : 'Copy'}
                                      </button>
                                    </div>
                                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-800">
                                      {option.code}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      )}

                      <button type="button" className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => setAgentModalOpen(false)}>
                        Return to live call
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-[#d8e0ff] bg-[#f6f8ff] p-4">
                      <div>
                        <p className="text-sm font-medium text-slate-950">Creating Lightcurve room...</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          Room URL, room name, and join token will appear here. No provider API key is needed for this path.
                        </p>
                      </div>
                      {runError ? (
                        <div className="rounded-lg border border-[#efcfcc] bg-[#fbf3f2] px-3 py-2 text-xs leading-5 text-[#8f3d3b]">
                          {runError}
                        </div>
                      ) : (
                        <div className="h-2 overflow-hidden rounded-full bg-white">
                          <div className="h-full w-1/2 animate-pulse rounded-full bg-[#2f5ae0]" />
                        </div>
                      )}
                      {callState === 'idle' && (
                        <button
                          type="button"
                          className="btn-primary min-h-9 px-3 py-1.5 text-xs"
                          onClick={() => void startOrEndCall('lightcurve_room')}
                        >
                          Create room details
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : connectionMode === 'phone_verification' ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-medium text-slate-950">Managed phone verification</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Lightcurve calls the phone number or SIP URI your agent answers. No provider API key or provider phone UUID is needed for this path.
                  </p>
                  <div className="mt-4 grid gap-3">
                    <label className="block text-xs text-slate-500">
                      Agent phone number or SIP URI
                      <input
                        className="input-field mt-1"
                        value={vapiAgentNumber}
                        onChange={(event) => setVapiAgentNumber(event.target.value)}
                        placeholder="+12164748341 or sip:agent@example.com"
                      />
                      <span className="mt-1 block leading-5 text-slate-500">
                        Put the endpoint your customer-facing voice agent answers. Lightcurve uses its managed caller line under the hood.
                      </span>
                    </label>
                  </div>
                  <div className="mt-4 rounded-lg border border-[#cfd8ff] bg-[#f6f8ff] px-3 py-2 text-xs leading-5 text-[#526894]">
                    This is for a small real-call verification after low-cost sandbox checks. Broad suites should use the Lightcurve room or Agent Replica path first.
                  </div>
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
                    Advanced path. Use only if your team already hosts a Lightcurve-compatible runner.
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
