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
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/datasets', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? 'Datasets could not be loaded.');
        setDatasets(Array.isArray(body.datasets) ? body.datasets : []);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Datasets could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Datasets</h1>
          <p className="page-subtitle">Human-grounded voice cases captured once and replayed across every agent version.</p>
        </div>
        <Link href="/playground" className="btn-primary">Record a call</Link>
      </div>

      <div className="rounded-xl border border-[#cfd8ff] bg-[#f6f8ff] p-4 text-sm leading-6 text-[#435783]">
        Every approved Playground call becomes a behavioral Case. Lightcurve preserves the human intent and decision path, then varies wording, timing, voice, and interruptions during replay.
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading datasets…</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {datasets.map((dataset) => (
            <Link key={dataset.id} href={`/datasets/${dataset.id}`} className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#b9c6f7] hover:shadow-sm">
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
      )}
    </div>
  );
}
