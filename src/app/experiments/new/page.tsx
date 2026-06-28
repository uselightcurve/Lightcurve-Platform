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
  const [replayCount, setReplayCount] = useState(100);
  const [maxConcurrency, setMaxConcurrency] = useState(20);
  const [seed, setSeed] = useState(20260620);
  const [judgePolicy, setJudgePolicy] = useState<'flash-pro-review' | 'flash' | 'pro'>('flash-pro-review');
  const [environmentMix, setEnvironmentMix] = useState<Record<string, number>>(defaultEnvironmentMix);
  const [agentConfigs, setAgentConfigs] = useState<AgentConfigInput[]>([{ id: 'config-1', name: 'Baseline (GPT-4o)', stt: 'Deepgram', llm: 'GPT-4o', tts: 'ElevenLabs' }]);
  const [advanced, setAdvanced] = useState(false);
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
        <h1 className="page-title">Run a voice graph</h1>
        <p className="page-subtitle">Run automated tests using your saved datasets and scenarios.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <form onSubmit={createExperiment} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
        <label className="block text-sm text-slate-600">Run name<input className="input-field mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Release candidate evaluation" /></label>
        
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-600">Dataset<select className="input-field mt-2" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.caseCount} Cases · v{dataset.currentVersion}</option>)}</select></label>
          <label className="block text-sm text-slate-600">Connected agent runtime<select className="input-field mt-2" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}{runtime.version ? ` · ${runtime.version}` : ''} · {runtime.status}</option>)}</select></label>
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
          <legend className="text-sm font-medium text-slate-800">Coverage preset</legend>
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

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <strong className="text-slate-800">Release mix:</strong> 20% clean, 20% office/café, 15% car/street, 15% latency/jitter, and 30% packet loss, bandwidth, and compound stress.
        </div>

        <button type="button" className="text-left text-sm font-medium text-[#2f5ae0]" onClick={() => setAdvanced((value) => !value)}>{advanced ? 'Hide advanced settings' : 'Advanced settings'}</button>
        {advanced && (
          <div className="grid grid-cols-3 gap-4 rounded-xl border border-slate-200 p-4">
            <label className="text-sm text-slate-600">Replay calls<input type="number" min={1} max={5000} className="input-field mt-2" value={replayCount} onChange={(event) => setReplayCount(Number(event.target.value))} /></label>
            <label className="text-sm text-slate-600">Max concurrency<input type="number" min={1} max={200} className="input-field mt-2" value={maxConcurrency} onChange={(event) => setMaxConcurrency(Number(event.target.value))} /></label>
            <label className="text-sm text-slate-600">Seed<input type="number" min={1} className="input-field mt-2" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
            <label className="col-span-3 text-sm text-slate-600">Judge mode<select className="input-field mt-2" value={judgePolicy} onChange={(event) => setJudgePolicy(event.target.value as typeof judgePolicy)}><option value="flash-pro-review">Flash + automatic Pro review</option><option value="flash">Flash only</option><option value="pro">Flash + Pro on every call</option></select></label>
            <div className="col-span-3"><p className="text-sm font-medium text-slate-700">Environment weights</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(environmentMix).map(([profile, weight]) => <label key={profile} className="text-xs text-slate-500">{profile.replaceAll('_', ' ')}<input type="number" min={0} max={100} className="input-field mt-1" value={weight} onChange={(event) => setEnvironmentMix((current) => ({ ...current, [profile]: Math.max(0, Number(event.target.value)) }))} /></label>)}</div></div>
            <p className="col-span-3 text-xs text-slate-500">Weights are normalized automatically. Flash reasons over every call; Pro review follows the selected policy.</p>

            <div className="col-span-3 mt-4 pt-4 border-t border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-slate-700">Compare Models (Agent Configurations)</p>
                <button type="button" onClick={() => setAgentConfigs(prev => [...prev, { id: `config-${Date.now()}`, name: `Config ${prev.length + 1}`, stt: 'Deepgram', llm: 'Claude 3.5 Sonnet', tts: 'Cartesia' }])} className="text-xs font-medium text-[#2f5ae0] hover:text-[#2040a0]">+ Add Configuration</button>
              </div>
              <div className="space-y-3">
                {agentConfigs.map((config, index) => (
                  <div key={config.id} className="flex flex-col sm:flex-row gap-3 p-3 rounded-lg border border-slate-200 bg-white items-start sm:items-center">
                    <input className="input-field flex-1 text-sm font-medium" value={config.name} onChange={(e) => { const newConfigs = [...agentConfigs]; newConfigs[index].name = e.target.value; setAgentConfigs(newConfigs); }} placeholder="Config Name" />
                    <div className="flex gap-2 w-full sm:w-auto">
                      <select className="input-field text-xs flex-1" value={config.stt} onChange={(e) => { const newConfigs = [...agentConfigs]; newConfigs[index].stt = e.target.value; setAgentConfigs(newConfigs); }}>
                        <option value="Deepgram">Deepgram</option>
                        <option value="Gladia">Gladia</option>
                        <option value="Whisper">Whisper</option>
                      </select>
                      <select className="input-field text-xs flex-1" value={config.llm} onChange={(e) => { const newConfigs = [...agentConfigs]; newConfigs[index].llm = e.target.value; setAgentConfigs(newConfigs); }}>
                        <option value="GPT-4o">GPT-4o</option>
                        <option value="GPT-4o-mini">GPT-4o-mini</option>
                        <option value="Claude 3.5 Sonnet">Claude 3.5 Sonnet</option>
                        <option value="Claude 3 Haiku">Claude 3 Haiku</option>
                        <option value="Gemini 1.5 Pro">Gemini 1.5 Pro</option>
                        <option value="Llama 3 70B">Llama 3 70B</option>
                      </select>
                      <select className="input-field text-xs flex-1" value={config.tts} onChange={(e) => { const newConfigs = [...agentConfigs]; newConfigs[index].tts = e.target.value; setAgentConfigs(newConfigs); }}>
                        <option value="ElevenLabs">ElevenLabs</option>
                        <option value="Cartesia">Cartesia</option>
                        <option value="PlayHT">PlayHT</option>
                        <option value="OpenAI TTS">OpenAI TTS</option>
                      </select>
                      {agentConfigs.length > 1 && (
                        <button type="button" onClick={() => setAgentConfigs(prev => prev.filter(c => c.id !== config.id))} className="p-2 text-slate-400 hover:text-red-600 rounded-md border border-slate-200 hover:border-red-200">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">Adding multiple configurations will run the dataset against each variant so you can compare their performance side-by-side.</p>
            </div>
          </div>
        )}


        <button type="submit" disabled={saving || !datasetId || !runtimeId} className="btn-primary w-full justify-center">{saving ? 'Starting test...' : 'Start automated evaluation'}</button>
      </form>
    </div>
  );
}
