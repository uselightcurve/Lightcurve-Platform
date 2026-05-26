'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEMO_TRANSCRIPT } from '@/lib/demoData';
import { ScoreBar } from '@/components/PageActions';
import { REAL_SCENARIO_LIBRARY } from '@/lib/realScenarioLibrary';
import { createPlaygroundExperiment, getAgent, getScenarios, type StoredScenario } from '@/lib/workspaceStore';

function Waveform({ active = false }: { active?: boolean }) {
  return (
    <div className="flex h-16 items-center gap-1 rounded-lg border border-slate-200 bg-white px-4">
      {Array.from({ length: 34 }).map((_, index) => (
        <span
          key={index}
          className={`w-1 rounded-full ${active ? 'bg-[#2f5ae0]' : 'bg-slate-300'}`}
          style={{ height: `${12 + ((index * 7) % 34)}px`, opacity: active ? 0.75 + ((index % 4) * 0.06) : 0.55 }}
        />
      ))}
    </div>
  );
}

export default function PlaygroundPage() {
  const router = useRouter();
  const [callState, setCallState] = useState<'idle' | 'running' | 'complete'>('idle');
  const [scenarioId, setScenarioId] = useState(REAL_SCENARIO_LIBRARY[0]?.id ?? '');
  const [agent, setAgent] = useState('sandbox-stub-agent');
  const [scenarios, setScenarios] = useState<StoredScenario[]>(REAL_SCENARIO_LIBRARY as StoredScenario[]);
  const [visibleTurns, setVisibleTurns] = useState(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setScenarios(getScenarios());
    const savedAgent = getAgent();
    if (savedAgent?.locator) setAgent(savedAgent.locator);
  }, []);

  const selectedScenario = useMemo(() => {
    return scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0];
  }, [scenarioId, scenarios]);

  const transcript = useMemo(() => {
    if (!selectedScenario) return DEMO_TRANSCRIPT;
    return [
      {
        speaker: 'caller',
        text: selectedScenario.persona.opening_line,
        latencyMs: 0,
      },
      {
        speaker: 'agent',
        text: `I can help with that. I will work on: ${selectedScenario.persona.goal}`,
        latencyMs: 880,
      },
      {
        speaker: 'caller',
        text: selectedScenario.persona.interrupts ? 'Please do not put me through another loop.' : 'Please confirm the next step clearly.',
        latencyMs: 0,
      },
      {
        speaker: 'agent',
        text: selectedScenario.persona.emotional_state === 'neutral'
          ? 'Here is the shortest path: I will confirm pricing, complete the change, and summarize it.'
          : 'I understand the urgency. I will give you a clear next step and avoid guessing.',
        latencyMs: 1020,
      },
    ];
  }, [selectedScenario]);

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

  function startOrEndCall() {
    setSaved(false);
    if (callState === 'running') {
      setVisibleTurns(transcript.length);
      setCallState('complete');
      return;
    }
    setVisibleTurns(0);
    setCallState('running');
  }

  function saveToExperiments() {
    if (!selectedScenario) return;
    const result = createPlaygroundExperiment({
      scenarioId: selectedScenario.id,
      agent,
    });
    setSaved(true);
    router.push(`/experiments/${result.experiment.id}`);
  }

  function downloadTranscript() {
    const text = transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedScenario?.name ?? 'sandbox-call'}-transcript.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Playground</h1>
        <p className="page-subtitle">Run one simulated phone call, watch the transcript stream, then save it into experiments.</p>
      </div>

      <div className="grid grid-cols-[0.4fr_0.6fr] gap-5">
        <aside className="card flex min-h-[560px] flex-col p-4">
          <h2 className="text-sm font-medium text-slate-950">Scenario configurator</h2>
          <div className="mt-5 space-y-4">
            <label className="block text-xs text-slate-500">
              Scenario
              <select
                className="select-field mt-1"
                value={selectedScenario.id}
                onChange={(event) => {
                  setScenarioId(event.target.value);
                  setCallState('idle');
                  setVisibleTurns(0);
                  setSaved(false);
                }}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-500">
              Agent
              <input className="input-field mt-1" value={agent} onChange={(event) => setAgent(event.target.value)} />
            </label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-950">{selectedScenario.persona.name}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{selectedScenario.persona.goal}</p>
            </div>
            <details className="rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-sm text-slate-700">Advanced</summary>
              <div className="mt-4 space-y-3">
                <label className="block text-xs text-slate-500">max_turns<input className="input-field mt-1" defaultValue="8" /></label>
                <label className="block text-xs text-slate-500">caller_seed<input className="input-field mt-1" defaultValue={selectedScenario.callerSeed} /></label>
                <label className="block text-xs text-slate-500">
                  noise_db
                  <input className="mt-2 w-full accent-[#2f5ae0]" type="range" min="0" max="12" defaultValue={selectedScenario.persona.noise_db} />
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

        <section className="card flex min-h-[560px] flex-col overflow-hidden">
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
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white">
                <div className="w-80">
                  <Waveform />
                </div>
                <p className="mt-5 text-sm text-slate-500">Pick a scenario and start the simulated phone call.</p>
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

                <div className="space-y-3">
                  {transcript.slice(0, callState === 'complete' ? transcript.length : visibleTurns).map((turn) => (
                    <div key={`${turn.speaker}-${turn.text}`} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase text-slate-500">{turn.speaker}</span>
                        {turn.latencyMs > 0 && <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-xs text-[#2448bb]">{turn.latencyMs}ms</span>}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{turn.text}</p>
                    </div>
                  ))}
                </div>

                {callState === 'complete' && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="card p-4"><p className="text-xs text-slate-500">MOS</p><div className="mt-3"><ScoreBar value={4.1} max={4.5} /></div></div>
                    <div className="card p-4"><p className="text-xs text-slate-500">Task Completion</p><div className="mt-3"><ScoreBar value={0.86} /></div></div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      {selectedScenario.persona.code_switching
                        ? 'Mirror code-switching and confirm price before benefits.'
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
                <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={() => router.push(`/scenarios?fork=${selectedScenario.id}`)}>Fork Scenario</button>
                <button className="btn-primary min-h-8 px-3 py-1.5 text-xs" onClick={saveToExperiments}>
                  {saved ? 'Saved' : 'Save to Experiments'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
