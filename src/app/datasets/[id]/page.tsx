'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

type DatasetCase = {
  id: string;
  name: string;
  language: string;
  domain: string;
  status: string;
  visibility: string;
  behaviorGraph: { nodes?: unknown[]; edges?: unknown[] };
  createdAt?: string | null;
};

type DatasetDetail = {
  dataset: {
    id: string;
    name: string;
    description?: string | null;
    currentVersion: number;
    visibility: string;
  };
  cases: DatasetCase[];
  contributions: Array<{ caseId: string; status: string }>;
};

export default function DatasetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<DatasetDetail | null>(null);
  const [error, setError] = useState('');

  async function contribute(caseId: string) {
    const confirmed = window.confirm('Contribute only the anonymized behavior graph to the community benchmark? Raw audio and the full transcript stay private.');
    if (!confirmed) return;
    const response = await fetch(`/api/datasets/cases/${caseId}/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consent: true }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body.error ?? 'Case could not be contributed.');
      return;
    }
    setData((current) => current ? {
      ...current,
      contributions: [...current.contributions.filter((item) => item.caseId !== caseId), { caseId, status: body.contribution.status }],
    } : current);
  }

  useEffect(() => {
    fetch(`/api/datasets/${id}`, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? 'Dataset could not be loaded.');
        setData(body);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Dataset could not be loaded.'));
  }, [id]);

  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading dataset…</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/datasets" className="text-sm text-slate-500 hover:text-slate-900">← Datasets</Link>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">{data.dataset.name}</h1>
            <p className="page-subtitle">{data.dataset.description}</p>
          </div>
          <Link href={`/experiments/new?dataset=${data.dataset.id}`} className="btn-primary">Run dataset</Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Cases</p><p className="mt-1 text-2xl font-semibold">{data.cases.length}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Dataset version</p><p className="mt-1 text-2xl font-semibold">{data.dataset.currentVersion}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Visibility</p><p className="mt-1 text-2xl font-semibold capitalize">{data.dataset.visibility}</p></div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-950">Human-derived cases</h2></div>
        {data.cases.length ? data.cases.map((item) => (
          <div key={item.id} className="border-b border-slate-100 px-5 py-4 last:border-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-slate-900">{item.name}</p>
                <p className="mt-1 text-sm text-slate-500">{item.domain} · {item.language} · {item.behaviorGraph?.nodes?.length ?? 0} graph nodes</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">human-derived</span>
                {data.contributions.some((contribution) => contribution.caseId === item.id) ? (
                  <span className="rounded-full bg-[#eef2ff] px-2 py-1 text-[11px] text-[#2448bb]">benchmark review</span>
                ) : (
                  <button type="button" className="text-xs font-medium text-[#2f5ae0]" onClick={() => void contribute(item.id)}>Contribute anonymized</button>
                )}
              </div>
            </div>
          </div>
        )) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-slate-600">No cases yet.</p>
            <Link href="/playground" className="mt-3 inline-flex text-sm font-medium text-[#2f5ae0]">Record the first human call</Link>
          </div>
        )}
      </div>
    </div>
  );
}
