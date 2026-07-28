'use client';

import { useEffect, useRef, useState } from 'react';

type TranscriptTurn = {
  speaker?: string;
  text?: string;
};

type DatasetCase = {
  id: string;
  datasetId: string;
  name: string;
  language: string;
  status: string;
  provenance?: Record<string, unknown>;
  behaviorGraph?: Record<string, unknown>;
  createdAt?: string | null;
};

type DatasetSummary = {
  id: string;
  name: string;
  description?: string | null;
  currentVersion: number;
  caseCount: number;
  cases: DatasetCase[];
};

function UploadIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="m18 6-12 12M6 6l12 12" />
    </svg>
  );
}

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

function transcriptFor(datasetCase: DatasetCase) {
  const provenance = datasetCase.provenance ?? {};
  const transcript = Array.isArray(provenance.transcript) ? provenance.transcript as TranscriptTurn[] : [];
  const turns = transcript
    .map((turn) => ({ speaker: turn.speaker === 'agent' ? 'Agent' : 'Caller', text: typeof turn.text === 'string' ? turn.text.trim() : '' }))
    .filter((turn) => turn.text);
  if (turns.length) return turns;

  const graph = datasetCase.behaviorGraph ?? {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as Array<Record<string, unknown>> : [];
  const authored = nodes.flatMap((node) => typeof node.observedText === 'string' && node.observedText.trim()
    ? [{ speaker: node.speaker === 'agent' ? 'Agent' : 'Caller', text: node.observedText.trim() }]
    : []);
  return authored.length ? authored : [{ speaker: 'Caller', text: datasetCase.name }];
}

function sourceFor(datasetCase: DatasetCase) {
  return datasetCase.provenance?.source === 'imported_audio' ? 'Recording' : 'Test case';
}

function formatDate(value?: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedCaseId, setExpandedCaseId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cases, setCases] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadDatasets() {
    setLoadingDatasets(true);
    try {
      const response = await fetch('/api/datasets', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Dataset library could not be loaded.');
      const rows = Array.isArray(body.datasets) ? body.datasets as DatasetSummary[] : [];
      setDatasets(rows.map((dataset) => ({ ...dataset, cases: Array.isArray(dataset.cases) ? dataset.cases : [] })));
      setSelectedDatasetId((current) => current || rows[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dataset library could not be loaded.');
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
      const caseNames = cases.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      if (!name.trim()) throw new Error('Give the dataset group a name.');
      if (!caseNames.length) throw new Error('Add at least one test case.');
      const response = await fetch('/api/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, cases: caseNames }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Dataset group could not be created.');
      setName('');
      setDescription('');
      setCases('');
      setCreateOpen(false);
      setSelectedDatasetId(body.dataset?.id || '');
      setNotice('Dataset group created.');
      await loadDatasets();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dataset group could not be created.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadRecording() {
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }
    setError('');
    setNotice('');
    setUploading(true);
    try {
      if (!selectedDatasetId) throw new Error('Choose a dataset group for this recording.');
      if (await audioDuration(selectedFile) > 300) throw new Error('Choose an audio file that is 5 minutes or shorter.');
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('datasetId', selectedDatasetId);
      const response = await fetch('/api/datasets/upload', { method: 'POST', body: formData });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Recording could not be transcribed.');
      setUploadOpen(false);
      setSelectedFile(null);
      setNotice(typeof body.warning === 'string' ? body.warning : 'Recording transcribed and added to the library.');
      await loadDatasets();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recording upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function closeUpload() {
    if (uploading) return;
    setUploadOpen(false);
    setSelectedFile(null);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Dataset library</h1>
          <p className="page-subtitle">Call recordings and authored test cases, organized by dataset.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setCreateOpen(true)}>
            <PlusIcon /> New group
          </button>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setUploadOpen(true)}>
            <UploadIcon /> Upload recording
          </button>
        </div>
      </header>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

      {loadingDatasets ? (
        <div className="flex min-h-52 items-center justify-center text-sm text-slate-500">Loading library...</div>
      ) : datasets.length ? (
        <div className="space-y-5">
          {datasets.map((dataset) => (
            <section key={dataset.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold text-slate-950">{dataset.name}</h2>
                  {dataset.description && <p className="mt-1 text-sm text-slate-500">{dataset.description}</p>}
                </div>
                <span className="text-xs font-medium text-slate-500">{dataset.caseCount} {dataset.caseCount === 1 ? 'case' : 'cases'}</span>
              </div>

              {dataset.cases.length ? (
                <div className="divide-y divide-slate-200">
                  {dataset.cases.map((datasetCase) => {
                    const transcript = transcriptFor(datasetCase);
                    const source = sourceFor(datasetCase);
                    const expanded = expandedCaseId === datasetCase.id;
                    return (
                      <article key={datasetCase.id} className="px-5 py-5">
                        <button
                          type="button"
                          className="flex w-full items-start justify-between gap-4 text-left"
                          onClick={() => setExpandedCaseId(expanded ? '' : datasetCase.id)}
                          aria-expanded={expanded}
                        >
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${source === 'Recording' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>{source}</span>
                              <span className="font-medium text-slate-900">{datasetCase.name}</span>
                            </span>
                            <span className="mt-1 block text-xs text-slate-500">{formatDate(datasetCase.createdAt)}{datasetCase.status ? ` · ${datasetCase.status}` : ''}</span>
                          </span>
                          <span className={`mt-1 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m6 9 6 6 6-6" />
                            </svg>
                          </span>
                        </button>
                        {expanded && (
                          <div className="mt-4 border-l-2 border-slate-200 pl-4">
                            <p className="text-xs font-semibold uppercase text-slate-500">Transcript</p>
                            <div className="mt-2 space-y-2">
                              {transcript.map((turn, index) => (
                                <p key={`${datasetCase.id}-${index}`} className="text-sm leading-6 text-slate-700">
                                  <span className="font-medium text-slate-900">{turn.speaker}:</span> {turn.text}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 py-8 text-center text-sm text-slate-500">No recordings or test cases in this group yet.</div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="border-y border-slate-200 bg-white px-6 py-14 text-center">
          <h2 className="font-semibold text-slate-900">Your dataset library is empty</h2>
          <p className="mt-1 text-sm text-slate-500">Create a group, then add a recording or authored test case.</p>
          <button type="button" className="btn-primary mt-5 inline-flex items-center gap-2" onClick={() => setCreateOpen(true)}>
            <PlusIcon /> Create group
          </button>
        </div>
      )}

      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-title">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="upload-title" className="font-semibold text-slate-950">Upload recording</h2>
                <p className="mt-1 text-sm text-slate-500">Choose the dataset library for this call. Language is detected automatically.</p>
              </div>
              <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={closeUpload} aria-label="Close upload dialog"><CloseIcon /></button>
            </div>
            <div className="p-5">
              <p className="text-sm font-medium text-slate-800">Dataset</p>
              <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                {datasets.map((dataset) => (
                  <label key={dataset.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0 hover:bg-slate-50">
                    <input type="radio" name="dataset" value={dataset.id} checked={selectedDatasetId === dataset.id} onChange={() => setSelectedDatasetId(dataset.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{dataset.name}</span>
                      <span className="block text-xs text-slate-500">{dataset.caseCount} {dataset.caseCount === 1 ? 'case' : 'cases'}</span>
                    </span>
                  </label>
                ))}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".wav,.mp3,audio/wav,audio/mpeg"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <button type="button" className="mt-4 w-full rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center hover:border-blue-400 hover:bg-blue-50/40" onClick={() => fileInputRef.current?.click()}>
                <span className="block text-sm font-medium text-slate-900">{selectedFile?.name || 'Choose WAV or MP3'}</span>
                <span className="mt-1 block text-xs text-slate-500">Maximum recording length: 5 minutes</span>
              </button>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" className="btn-secondary" onClick={closeUpload} disabled={uploading}>Cancel</button>
              <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={uploadRecording} disabled={uploading || !selectedDatasetId || !datasets.length}>
                <UploadIcon /> {uploading ? 'Transcribing...' : selectedFile ? 'Upload and transcribe' : 'Choose recording'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <form onSubmit={createDatasetGroup} className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 id="create-title" className="font-semibold text-slate-950">New dataset group</h2>
                <p className="mt-1 text-sm text-slate-500">Group related recordings and test cases.</p>
              </div>
              <button type="button" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setCreateOpen(false)} aria-label="Close create dialog"><CloseIcon /></button>
            </div>
            <div className="grid gap-4 p-5">
              <label className="text-sm font-medium text-slate-700">
                Group name
                <input className="input-field mt-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Billing escalation checks" disabled={saving} autoFocus />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Description
                <textarea className="input-field mt-2 min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this group should validate" disabled={saving} />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Test cases
                <textarea className="input-field mt-2 min-h-32" value={cases} onChange={(event) => setCases(event.target.value)} placeholder={'Customer asks for a refund outside policy\nAgent needs to escalate a billing dispute'} disabled={saving} />
                <span className="mt-2 block text-xs font-normal text-slate-500">Add one test case per line.</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create group'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
