'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ProviderLogo } from '@/components/ProviderLogo';
import { DEMO_SCENARIOS } from '@/lib/demoData';
import { providerDefinitions, type ProviderId } from '@/lib/integrations';
import { createExperiment, getAgent, getScenarios, type StoredScenario } from '@/lib/workspaceStore';

const AGENT_TYPES = providerDefinitions.map((provider) => ({
  id: provider.id,
  label: provider.name,
  detail: provider.tagline,
  placeholder: provider.locatorPlaceholder,
  locatorLabel: provider.locatorLabel,
}));

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
  const [agentType, setAgentType] = useState('custom_webrtc');
  const [apiKey, setApiKey] = useState('');
  const [agentLocator, setAgentLocator] = useState('');
  const [expName, setExpName] = useState('pre-production voice preflight');
  const [scenarios, setScenarios] = useState<StoredScenario[]>(DEMO_SCENARIOS as StoredScenario[]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setScenarios(getScenarios());
    const savedAgent = getAgent();
    if (savedAgent) {
      setAgentType(savedAgent.agentType);
      setAgentLocator(savedAgent.locator);
      setApiKey(savedAgent.apiKey ?? '');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scenarioId = params.get('scenario');
    const scenarioIds = params.get('scenarios')?.split(',').filter(Boolean) ?? [];
    if (scenarioId && scenarios.some((scenario) => scenario.id === scenarioId)) {
      setSelectedIds((current) => (current.includes(scenarioId) ? current : [scenarioId]));
      setStep(2);
    }
    if (scenarioIds.length) {
      const validIds = scenarioIds.filter((id) => scenarios.some((scenario) => scenario.id === id));
      if (validIds.length) {
        setSelectedIds(validIds);
        setStep(2);
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

  const toggleScenario = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const useMockAgent = () => {
    setAgentType('custom_webrtc');
    setAgentLocator('wss://sandbox.lightcurve.local/mock-agent');
  };

  const handleRun = async () => {
    if (!expName.trim() || !agentLocator.trim() || selectedIds.length === 0) return;

    setLoading(true);
    setError('');

    try {
      const agentConfig: Record<string, string> =
        agentType === 'custom_webrtc'
          ? { endpoint: agentLocator }
          : agentType === 'vapi'
            ? { assistantId: agentLocator, apiKey }
            : agentType === 'livekit'
              ? { roomOrAgent: agentLocator, apiKey }
              : agentType === 'pipecat'
                ? { agentUrl: agentLocator, apiKey }
                : { agentId: agentLocator, apiKey };

      const data = createExperiment({
        name: expName,
        agentType: agentType as ProviderId,
        agentConfig,
        scenarioIds: selectedIds,
        gitSha: 'local-mvp',
      });

      router.push(`/experiments/${data.experiment.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Experiment could not be created');
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
            Connect an agent, choose synthetic phone callers, then run a release gate for MOS, task completion,
            hallucination risk, and latency.
          </p>
        </div>
        <Stepper step={step} setStep={setStep} />
      </div>

      {step === 1 && (
        <div className="grid grid-cols-[1fr_360px] gap-5">
          <section className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-medium text-slate-950">Connect your voice agent</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Lightcurve will call this endpoint as a simulated customer, not as a text-only prompt.
                </p>
              </div>
              <button type="button" onClick={useMockAgent} className="btn-secondary text-xs">
                Use sandbox stub
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              {AGENT_TYPES.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setAgentType(agent.id)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    agentType === agent.id
                      ? 'border-slate-300 bg-slate-50 ring-1 ring-slate-200'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ProviderLogo provider={agent.id} />
                    <p className="text-sm font-medium text-slate-950">{agent.label}</p>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">{agent.detail}</p>
                </button>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  {activeAgent.locatorLabel}
                </label>
                <input
                  className="input-field"
                  value={agentLocator}
                  onChange={(event) => setAgentLocator(event.target.value)}
                  placeholder={activeAgent.placeholder}
                />
              </div>
              {agentType !== 'custom_webrtc' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">API key override</label>
                  <input
                    type="password"
                    className="input-field"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="Optional. Prefer server env."
                  />
                </div>
              )}
            </div>

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-3 gap-3">
                <MiniMetric label="Input" value="Phone audio" />
                <MiniMetric label="Caller" value="Synthetic" />
                <MiniMetric label="Output" value="MOS + CI" />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setStep(2)} disabled={!agentLocator.trim()}>
                Pick callers
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </section>

          <aside className="card p-5">
            <p className="section-label">What gets tested</p>
            <h2 className="mt-2 text-base font-medium text-slate-950">A real phone-call loop</h2>
            <div className="mt-5 space-y-4">
              {[
                ['Caller behavior', 'Anger, interruptions, accents, code switching, background noise.'],
                ['Agent outcome', 'Task completion, safety, policy accuracy, escalation handling.'],
                ['Speech quality', 'MOS score from the recorded call, plus latency per turn.'],
                ['Release signal', 'Pass or block output for CI/CD and pull-request review.'],
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
                <h2 className="text-base font-medium text-slate-950">Choose simulated callers</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Select the calls that should run before this voice-agent release ships.
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => setSelectedIds(highPressureIds)}>
                  High-pressure set
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() =>
                    selectedIds.length === scenarios.length
                      ? setSelectedIds([])
                      : setSelectedIds(scenarios.map((scenario) => scenario.id))
                  }
                >
                  {selectedIds.length === scenarios.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
            </div>
          </div>

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
            <button type="button" className="btn-primary" onClick={() => setStep(3)} disabled={selectedIds.length === 0}>
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
              This creates the sandbox run and prepares the output that developers can attach to CI/CD.
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
                disabled={!expName.trim() || !agentLocator.trim() || selectedIds.length === 0 || loading}
              >
                {loading ? 'Creating sandbox...' : 'Run simulated phone calls'}
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
