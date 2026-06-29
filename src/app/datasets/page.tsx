'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type DatasetSummary = {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  sourceType: string;
  currentVersion: number;
  caseCount: number;
  updatedAt?: string | null;
};

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch('/api/datasets', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? 'Datasets could not be loaded.');
        setDatasets(Array.isArray(body.datasets) ? body.datasets : []);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Datasets could not be loaded.'))
      .finally(() => setLoading(false));
  }, [refreshTrigger]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setUploading(true);
    setError('');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/datasets/upload', {
        method: 'POST',
        body: formData,
      });
      
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'File upload failed.');
      
      setRefreshTrigger((prev) => prev + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred during upload.');
    } finally {
      setUploading(false);
      // Reset input
      event.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-lg bg-white p-8 shadow-xl border border-slate-100">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#cfd8ff] border-t-indigo-600"></div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-slate-900">Analyzing Call</h3>
              <p className="mt-1 text-sm text-slate-500">Extracting transcript, behavior graph, and accent...</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Datasets</h1>
          <p className="page-subtitle">Voice call recordings saved as test cases for your agents.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/playground" className="btn-primary">Record a call</Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Upload New Dataset</h2>
        <p className="mt-1 text-sm text-slate-500">Upload an audio file to extract transcript, behavior graph, and accent parameters.</p>
        <div className="mt-4">
          <label className="btn-secondary inline-flex cursor-pointer items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            Select Audio File
            <input type="file" className="hidden" accept=".wav,.mp3,audio/wav,audio/mpeg" onChange={handleFileUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading datasets…</div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Existing Datasets</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {datasets.map((dataset) => (
            <Link key={dataset.id} href={`/datasets/${dataset.id}`} className="card flex flex-col justify-between p-5 transition hover:border-[#b9c6f7]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">{dataset.name}</h2>
                  <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">{dataset.description || 'Human-derived voice evaluation dataset.'}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{dataset.visibility}</span>
              </div>
              <div className="mt-5 flex items-center gap-4 text-xs text-slate-500">
                <span>{dataset.caseCount} {dataset.caseCount === 1 ? 'case' : 'cases'}</span>
                <span>Version {dataset.currentVersion}</span>
              </div>
            </Link>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
