'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Dataset = { id: string; name: string; caseCount: number; currentVersion: number };
type Runtime = { id: string; name: string; version?: string | null; status: string };
type Playbook = { id: string; name: string };
type Guardrail = { id: string; name: string };
type Scenario = { id: string; name: string; type: string };
type Preset = 'quick' | 'release' | 'stress';
type AgentConfigInput = { id: string; name: string; stt: string; llm: string; tts: string };

const presets: Record<Preset, { label: string; calls: number; concurrency: number; description: string }> = {
  quick: { label: 'Quick', calls: 10, concurrency: 3, description: 'Fast check before a small change.' },
  release: { label: 'Release', calls: 100, concurrency: 20, description: 'Risk-weighted production readiness.' },
  stress: { label: 'Stress', calls: 500, concurrency: 50, description: 'Broad compound coverage at scale.' },
};

const defaultEnvironmentMix = {
  clean: 20,
  office_cafe: 20,
  car_street: 15,
  latency_jitter: 15,
  packet_loss: 10,
  codec_bandwidth: 10,
  compound_stress: 10,
};

export default function NewExperimentPage() {
  const router = useRouter();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const [datasetId, setDatasetId] = useState('');
  const [runtimeId, setRuntimeId] = useState('');
  const [playbookId, setPlaybookId] = useState('');
  const [guardrailIds, setGuardrailIds] = useState<string[]>([]);
  const [scenarioIds, setScenarioIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<Preset>('release');
  const seed = 20260620;
  const judgePolicy = 'flash-pro-review';
  const environmentMix = defaultEnvironmentMix;
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigInput[]>([
    { id: 'config-1', name: 'Baseline (GPT-4o)', stt: 'Deepgram', llm: 'GPT-4o', tts: 'ElevenLabs' },
  ]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/datasets', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/runtimes', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/playbooks', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/guardrails', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/scenarios', { cache: 'no-store' }).then((response) => response.json()),
    ]).then(([datasetBody, runtimeBody, playbookBody, guardrailBody, scenarioBody]) => {
      const loadedDatasets = Array.isArray(datasetBody.datasets) ? datasetBody.datasets : [];
      const loadedRuntimes = Array.isArray(runtimeBody.runtimes) ? runtimeBody.runtimes : [];
      setDatasets(loadedDatasets);
      setRuntimes(loadedRuntimes);
      setPlaybooks(Array.isArray(playbookBody.playbooks) ? playbookBody.playbooks : []);
      setGuardrails(Array.isArray(guardrailBody.guardrails) ? guardrailBody.guardrails : []);
      setScenarios(Array.isArray(scenarioBody.scenarios) ? scenarioBody.scenarios : []);
      const requestedDataset = new URLSearchParams(window.location.search).get('dataset');
      setDatasetId((current) => current || (requestedDataset && loadedDatasets.some((item: Dataset) => item.id === requestedDataset) ? requestedDataset : loadedDatasets[0]?.id) || '');
      setRuntimeId(loadedRuntimes.find((item: Runtime) => item.status === 'online')?.id || loadedRuntimes[0]?.id || '');
    }).catch(() => setError('Failed to load resources.'));
  }, []);

  function choosePreset(value: Preset) {
    setPreset(value);
  }

  async function createExperiment(e: React.FormEvent) {
    e.preventDefault();
    if (!datasetId) return setError('Please select a dataset to test against.');
    if (!runtimeId) return setError('Please select an agent runtime to test.');
    
    const { calls: replayCount, concurrency: maxConcurrency } = presets[preset];

    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId,
          runtimeId,
          name,
          preset,
          replayCount,
          maxConcurrency,
          seed,
          judgePolicy,
          environmentMix,
          playbookId,
          guardrailIds,
          scenarioIds,
          agentConfigs,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Dataset evaluation could not be created.');
      router.push(`/experiments/${body.experiment.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dataset evaluation could not be created.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="page-title">Run experiment</h1>
        <p className="page-subtitle">Test your agent against saved datasets and edge cases.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <form onSubmit={createExperiment} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
        <label className="block text-sm text-slate-600">Experiment name<input className="input-field mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Release candidate evaluation" /></label>
        
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-600">Dataset<select className="input-field mt-2" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.caseCount} Cases · v{dataset.currentVersion}</option>)}</select></label>
          <label className="block text-sm text-slate-600">Agent Configuration<select className="input-field mt-2" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}{runtime.version ? ` · ${runtime.version}` : ''} · {runtime.status}</option>)}</select></label>
        </div>

        <div className="grid gap-6 sm:grid-cols-[1fr_2fr] pt-4 border-t border-slate-100">
          <div>
            <label className="block text-sm text-slate-600 mb-2">Playbook</label>
            <select className="input-field w-full" value={playbookId} onChange={(event) => setPlaybookId(event.target.value)}>
              <option value="">None (Default Agent Instructions)</option>
              {playbooks.map(pb => <option key={pb.id} value={pb.id}>{pb.name}</option>)}
            </select>
          </div>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm text-slate-600 mb-2">Guardrails</p>
              <div className="flex flex-wrap gap-2">
                {guardrails.map(g => (
                  <button key={g.id} type="button" onClick={() => setGuardrailIds(prev => prev.includes(g.id) ? prev.filter(id => id !== g.id) : [...prev, g.id])} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${guardrailIds.includes(g.id) ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-600 border-slate-200'} border`}>
                    {guardrailIds.includes(g.id) ? '✓ ' : ''}{g.name}
                  </button>
                ))}
                {guardrails.length === 0 && <span className="text-xs text-slate-400">No guardrails defined.</span>}
              </div>
            </div>

            <div>
              <p className="text-sm text-slate-600 mb-2">Custom Scenarios & Jailbreaks</p>
              <div className="flex flex-wrap gap-2">
                {scenarios.map(s => (
                  <button key={s.id} type="button" onClick={() => setScenarioIds(prev => prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id])} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${scenarioIds.includes(s.id) ? (s.type === 'jailbreak' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-indigo-100 text-indigo-700 border-indigo-200') : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                    {scenarioIds.includes(s.id) ? '✓ ' : ''}{s.name}
                  </button>
                ))}
                {scenarios.length === 0 && <span className="text-xs text-slate-400">No scenarios defined.</span>}
              </div>
            </div>
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Test Size</legend>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(Object.keys(presets) as Preset[]).map((key) => (
              <button key={key} type="button" onClick={() => choosePreset(key)} className={`rounded-xl border p-4 text-left ${preset === key ? 'border-[#2f5ae0] bg-[#f6f8ff] ring-1 ring-[#2f5ae0]' : 'border-slate-200 hover:bg-slate-50'}`}>
                <span className="font-semibold text-slate-900">{presets[key].label}</span>
                <span className="mt-1 block text-2xl font-semibold text-slate-950">{presets[key].calls}</span>
                <span className="mt-1 block text-xs text-slate-500">{presets[key].description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <section className="space-y-3 border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Compare models</h2>
              <p className="mt-1 text-xs text-slate-500">Run the same cases against multiple voice-agent configurations.</p>
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => setAgentConfigs((current) => [
                ...current,
                {
                  id: `config-${Date.now()}`,
                  name: `Configuration ${current.length + 1}`,
                  stt: 'Whisper',
                  llm: 'Claude 3.5 Sonnet',
                  tts: 'Cartesia',
                },
              ])}
            >
              Add model
            </button>
          </div>

          <div className="space-y-3">
            {agentConfigs.map((config, index) => (
              <div key={config.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(150px,1.3fr)_1fr_1fr_1fr_auto]">
                <input
                  className="input-field"
                  aria-label={`Configuration ${index + 1} name`}
                  value={config.name}
                  onChange={(event) => setAgentConfigs((current) => current.map((item) => item.id === config.id ? { ...item, name: event.target.value } : item))}
                />
                <select className="input-field" aria-label={`Configuration ${index + 1} speech model`} value={config.stt} onChange={(event) => setAgentConfigs((current) => current.map((item) => item.id === config.id ? { ...item, stt: event.target.value } : item))}>
                  <option>Deepgram</option>
                  <option>Gladia</option>
                  <option>Whisper</option>
                </select>
                <select className="input-field" aria-label={`Configuration ${index + 1} language model`} value={config.llm} onChange={(event) => setAgentConfigs((current) => current.map((item) => item.id === config.id ? { ...item, llm: event.target.value } : item))}>
                  <option>GPT-4o</option>
                  <option>GPT-4o-mini</option>
                  <option>Claude 3.5 Sonnet</option>
                  <option>Claude 3 Haiku</option>
                  <option>Gemini 1.5 Pro</option>
                  <option>Llama 3 70B</option>
                </select>
                <select className="input-field" aria-label={`Configuration ${index + 1} voice model`} value={config.tts} onChange={(event) => setAgentConfigs((current) => current.map((item) => item.id === config.id ? { ...item, tts: event.target.value } : item))}>
                  <option>ElevenLabs</option>
                  <option>Cartesia</option>
                  <option>PlayHT</option>
                  <option>OpenAI TTS</option>
                </select>
                <button
                  type="button"
                  aria-label={`Remove ${config.name}`}
                  title="Remove model"
                  disabled={agentConfigs.length === 1}
                  className="h-10 w-10 rounded-md border border-slate-200 text-lg text-slate-500 hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setAgentConfigs((current) => current.filter((item) => item.id !== config.id))}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </section>

        <button type="submit" disabled={saving || !datasetId || !runtimeId} className="btn-primary w-full justify-center">{saving ? 'Starting experiment...' : 'Run experiment'}</button>
      </form>
    </div>
  );
}
