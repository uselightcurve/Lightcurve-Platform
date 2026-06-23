'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Dataset = { id: string; name: string; caseCount: number; currentVersion: number };
type Runtime = { id: string; name: string; version?: string | null; status: string };
type Preset = 'quick' | 'release' | 'stress';

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
  const [datasetId, setDatasetId] = useState('');
  const [runtimeId, setRuntimeId] = useState('');
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<Preset>('release');
  const [replayCount, setReplayCount] = useState(100);
  const [maxConcurrency, setMaxConcurrency] = useState(20);
  const [seed, setSeed] = useState(20260620);
  const [judgePolicy, setJudgePolicy] = useState<'flash-pro-review' | 'flash' | 'pro'>('flash-pro-review');
  const [environmentMix, setEnvironmentMix] = useState<Record<string, number>>(defaultEnvironmentMix);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/datasets', { cache: 'no-store' }).then((response) => response.json()),
      fetch('/api/runtimes', { cache: 'no-store' }).then((response) => response.json()),
    ]).then(([datasetBody, runtimeBody]) => {
      const loadedDatasets = Array.isArray(datasetBody.datasets) ? datasetBody.datasets : [];
      const loadedRuntimes = Array.isArray(runtimeBody.runtimes) ? runtimeBody.runtimes : [];
      setDatasets(loadedDatasets);
      setRuntimes(loadedRuntimes);
      const requestedDataset = new URLSearchParams(window.location.search).get('dataset');
      setDatasetId((current) => current || (requestedDataset && loadedDatasets.some((item: Dataset) => item.id === requestedDataset) ? requestedDataset : loadedDatasets[0]?.id) || '');
      setRuntimeId(loadedRuntimes.find((item: Runtime) => item.status === 'online')?.id || loadedRuntimes[0]?.id || '');
    }).catch(() => setError('Datasets and runtimes could not be loaded.'));
  }, []);

  function choosePreset(value: Preset) {
    setPreset(value);
    setReplayCount(presets[value].calls);
    setMaxConcurrency(presets[value].concurrency);
  }

  async function createExperiment() {
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
        <p className="page-subtitle">Compile human-derived Cases into reproducible, meaningfully different end-to-end calls.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
        <label className="block text-sm text-slate-600">Run name<input className="input-field mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Release candidate evaluation" /></label>
        <label className="block text-sm text-slate-600">Dataset<select className="input-field mt-2" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.caseCount} Cases · v{dataset.currentVersion}</option>)}</select></label>
        <label className="block text-sm text-slate-600">Connected agent runtime<select className="input-field mt-2" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}{runtime.version ? ` · ${runtime.version}` : ''} · {runtime.status}</option>)}</select></label>

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
          </div>
        )}

        <button type="button" className="btn-primary w-full" disabled={saving || !datasetId || !runtimeId} onClick={() => void createExperiment()}>{saving ? 'Compiling voice graph…' : `Run ${replayCount} calls`}</button>
      </div>
    </div>
  );
}
