'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Dataset = { id: string; name: string; caseCount: number; currentVersion: number };
type Runtime = { id: string; name: string; version?: string | null; status: string };
type Playbook = { id: string; name: string };
type Guardrail = { id: string; name: string };
type Scenario = { id: string; name: string; type: string };
type Preset = 'quick' | 'release' | 'stress';

const presets: Record<Preset, { label: string; calls: number; concurrency: number; description: string }> = {
  quick: { label: 'Quick', calls: 3, concurrency: 1, description: 'Three variants of each production call.' },
  release: { label: 'Release', calls: 10, concurrency: 3, description: 'Ten production-call variants.' },
  stress: { label: 'Stress', calls: 25, concurrency: 5, description: 'Twenty-five broader variants.' },
};

const defaultEnvironmentMix = {
  clean: 100,
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
  const [preset, setPreset] = useState<Preset>('quick');
  const [replayCount, setReplayCount] = useState(3);
  const [maxConcurrency, setMaxConcurrency] = useState(1);
  const [seed, setSeed] = useState(20260620);
  const [judgePolicy, setJudgePolicy] = useState<'flash-pro-review' | 'flash' | 'pro'>('flash-pro-review');
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
    setReplayCount(presets[value].calls);
    setMaxConcurrency(presets[value].concurrency);
  }

  async function createExperiment(e: React.FormEvent) {
    e.preventDefault();
    if (!datasetId) return setError('Please select a dataset to test against.');
    if (!runtimeId) return setError('Please select an agent runtime to test.');
    
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
          environmentMix: defaultEnvironmentMix,
          playbookId,
          guardrailIds,
          scenarioIds,
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
        <h1 className="page-title">Run a Voice Test</h1>
        <p className="page-subtitle">Replay captured production calls against your selected agent and scenarios.</p>
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

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Each run starts from the captured production call. Lightcurve varies caller phrasing, timing, and voice; only scenarios selected above add special behavior.
        </div>

        <button type="button" className="text-left text-sm font-medium text-[#2f5ae0]" onClick={() => setAdvanced((value) => !value)}>{advanced ? 'Hide advanced settings' : 'Advanced settings'}</button>
        {advanced && (
          <div className="grid grid-cols-3 gap-4 rounded-xl border border-slate-200 p-4">
            <label className="text-sm text-slate-600">Replay calls<input type="number" min={1} max={5000} className="input-field mt-2" value={replayCount} onChange={(event) => setReplayCount(Number(event.target.value))} /></label>
            <label className="text-sm text-slate-600">Max concurrency<input type="number" min={1} max={200} className="input-field mt-2" value={maxConcurrency} onChange={(event) => setMaxConcurrency(Number(event.target.value))} /></label>
            <label className="text-sm text-slate-600">Seed<input type="number" min={1} className="input-field mt-2" value={seed} onChange={(event) => setSeed(Number(event.target.value))} /></label>
            <label className="col-span-3 text-sm text-slate-600">Judge mode<select className="input-field mt-2" value={judgePolicy} onChange={(event) => setJudgePolicy(event.target.value as typeof judgePolicy)}><option value="flash-pro-review">Flash + automatic Pro review</option><option value="flash">Flash only</option><option value="pro">Flash + Pro on every call</option></select></label>
            <p className="col-span-3 text-xs text-slate-500">All calls use clean baseline audio. Flash reasons over every call; Pro review follows the selected policy.</p>
          </div>
        )}

        <button type="submit" disabled={saving || !datasetId || !runtimeId} className="btn-primary w-full justify-center">{saving ? 'Starting experiment...' : 'Run experiment'}</button>
      </form>
    </div>
  );
}
