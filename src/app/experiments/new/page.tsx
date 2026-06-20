'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Dataset = { id: string; name: string; caseCount: number; currentVersion: number };
type Runtime = { id: string; name: string; version?: string | null; status: string };

export default function NewExperimentPage() {
  const router = useRouter();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [datasetId, setDatasetId] = useState('');
  const [runtimeId, setRuntimeId] = useState('');
  const [name, setName] = useState('');
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

  async function createExperiment() {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId, runtimeId, name }),
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
    <div className="mx-auto max-w-2xl space-y-6">
      <div><h1 className="page-title">Run a dataset</h1><p className="page-subtitle">Replay human-derived cases against a registered agent version.</p></div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
        <label className="block text-sm text-slate-600">Run name<input className="input-field mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Release candidate evaluation" /></label>
        <label className="block text-sm text-slate-600">Dataset<select className="input-field mt-2" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.caseCount} cases · v{dataset.currentVersion}</option>)}</select></label>
        <label className="block text-sm text-slate-600">Agent version<select className="input-field mt-2" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}{runtime.version ? ` · ${runtime.version}` : ''} · {runtime.status}</option>)}</select></label>
        <button type="button" className="btn-primary w-full" disabled={saving || !datasetId || !runtimeId} onClick={() => void createExperiment()}>{saving ? 'Creating evaluation…' : 'Run dataset'}</button>
      </div>
    </div>
  );
}
