'use client';

import { useEffect, useState } from 'react';
import { SUPPORTED_CASE_LANGUAGES } from '@/lib/constants';

type DatasetSummary = {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  sourceType?: string;
  currentVersion: number;
  caseCount: number;
  updatedAt?: string | null;
};

function audioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(audio.duration); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This audio file could not be read.')); };
    audio.src = url;
  });
}

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [uploadLanguage, setUploadLanguage] = useState('en-US');
  const [uploading, setUploading] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cases, setCases] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadDatasets() {
    setLoadingDatasets(true);
    try {
      const response = await fetch('/api/datasets', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Dataset groups could not be loaded.');
      const rows = Array.isArray(body.datasets) ? body.datasets as DatasetSummary[] : [];
      setDatasets(rows);
      setSelectedDatasetId((current) => current || rows[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dataset groups could not be loaded.');
    } finally {
      setLoadingDatasets(false);
    }
  }

  useEffect(() => {
    void loadDatasets();
  }, []);

  async function createDatasetGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);

    try {
      const caseNames = cases
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);

      if (!name.trim()) throw new Error('Give the dataset group a name.');
      if (!caseNames.length) throw new Error('Add at least one case to the group.');

      const response = await fetch('/api/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, cases: caseNames }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Dataset group could not be created.');
      if (!body.dataset?.id) throw new Error('Dataset group was created, but could not be selected.');

      const created = {
        ...body.dataset,
        caseCount: Array.isArray(body.cases) ? body.cases.length : caseNames.length,
      } as DatasetSummary;
      setDatasets((current) => [created, ...current.filter((dataset) => dataset.id !== created.id)]);
      setSelectedDatasetId(created.id);
      setName('');
      setDescription('');
      setCases('');
      setNotice('Dataset group created. You can upload a recording into it now.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dataset group could not be created.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setNotice('');
    setUploading(true);
    setUploadingFileName(file.name);

    try {
      if (!selectedDatasetId) throw new Error('Create or choose a dataset group before uploading a recording.');
      if (await audioDuration(file) > 300) throw new Error('Choose an audio file that is 5 minutes or shorter.');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('datasetId', selectedDatasetId);
      formData.append('language', uploadLanguage);

      const response = await fetch('/api/datasets/upload', {
        method: 'POST',
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Recording could not be transcribed.');

      setNotice(typeof body.warning === 'string' ? body.warning : 'Recording transcribed and added to the selected dataset group.');
      await loadDatasets();
      setSelectedDatasetId(body.dataset?.id || selectedDatasetId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recording upload failed.');
    } finally {
      setUploading(false);
      setUploadingFileName('');
      event.target.value = '';
    }
  }

  return (
    <div className="space-y-6">
      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-lg border border-slate-100 bg-white p-8 shadow-xl">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#cfd8ff] border-t-indigo-600" />
            <div className="text-center">
              <h3 className="text-lg font-semibold text-slate-900">Transcribing recording</h3>
              <p className="mt-1 text-sm text-slate-500">{uploadingFileName || 'Preparing the dataset case.'}</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <h1 className="page-title">Datasets</h1>
        <p className="page-subtitle">Create dataset groups and upload call recordings as evaluated cases.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Upload Recording</h2>
          <p className="mt-1 text-sm text-slate-500">Add a call recording to a dataset group. If transcription fails, no draft case is created.</p>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <label className="block text-sm font-medium text-slate-700">
            Dataset group
            <select
              className="input-field mt-2"
              value={selectedDatasetId}
              onChange={(event) => setSelectedDatasetId(event.target.value)}
              disabled={loadingDatasets || uploading || !datasets.length}
            >
              {datasets.length ? datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>{dataset.name} - {dataset.caseCount} {dataset.caseCount === 1 ? 'case' : 'cases'}</option>
              )) : <option value="">Create a group first</option>}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Language
            <select className="input-field mt-2 min-w-48" value={uploadLanguage} onChange={(event) => setUploadLanguage(event.target.value)} disabled={uploading}>
              {SUPPORTED_CASE_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
            </select>
          </label>

          <label className={`btn-secondary inline-flex cursor-pointer items-center justify-center gap-2 ${!selectedDatasetId ? 'opacity-60' : ''}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Choose recording
            <input type="file" className="hidden" accept=".wav,.mp3,audio/wav,audio/mpeg" onChange={handleFileUpload} disabled={uploading || !selectedDatasetId} />
          </label>
        </div>
      </section>

      <form onSubmit={createDatasetGroup} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Create Dataset Group</h2>
          <p className="mt-1 text-sm text-slate-500">Group related evaluation cases together so every run has the right scope.</p>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="block text-sm font-medium text-slate-700">
            Group name
            <input className="input-field mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Billing escalation checks" disabled={saving} />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Description
            <textarea className="input-field mt-2 min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this group should validate" disabled={saving} />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Cases
            <textarea
              className="input-field mt-2 min-h-40"
              value={cases}
              onChange={(event) => setCases(event.target.value)}
              placeholder={'Customer asks for a refund outside policy\nCaller gives the wrong account number\nAgent needs to escalate a billing dispute'}
              disabled={saving}
            />
            <span className="mt-2 block text-xs text-slate-500">Add one case per line.</span>
          </label>
        </div>

        <button type="submit" disabled={saving} className="btn-primary mt-5">
          {saving ? 'Creating group...' : 'Create group'}
        </button>
      </form>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
    </div>
  );
}
