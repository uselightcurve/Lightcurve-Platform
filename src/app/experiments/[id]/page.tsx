'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';

type ExperimentData = {
  experiment: { name: string; status: string; datasetVersion: number; gitSha?: string | null };
  dataset: { name: string };
  runtime?: { name: string } | null;
  runs: Array<{ id: string; caseId?: string | null; status: string }>;
  cases: Array<{ id: string; name: string; domain: string; language: string }>;
};

export default function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ExperimentData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => fetch(`/api/experiments/${id}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Evaluation could not be loaded.');
      setData(body as ExperimentData);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Evaluation could not be loaded.'));
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [id]);

  const cases = useMemo(() => new Map((data?.cases ?? []).map((item) => [item.id, item])), [data]);
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading evaluation...</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/experiments" className="text-sm text-slate-500">&larr; Experiments</Link>
        <h1 className="page-title mt-3">{data.experiment.name}</h1>
        <p className="page-subtitle">{data.dataset.name} / version {data.experiment.datasetVersion} / {data.runtime?.name || 'Runtime unavailable'}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Cases</p><p className="mt-1 text-2xl font-semibold">{data.runs.length}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Status</p><p className="mt-1 text-2xl font-semibold capitalize">{data.experiment.status}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Git revision</p><p className="mt-1 truncate text-lg font-semibold">{data.experiment.gitSha || '-'}</p></div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.runs.map((run) => {
          const item = run.caseId ? cases.get(run.caseId) : undefined;
          return (
            <Link key={run.id} href={`/experiments/${id}/runs/${run.id}`} className="flex items-center justify-between border-b border-slate-100 px-5 py-4 last:border-0 hover:bg-slate-50">
              <div><p className="font-medium text-slate-900">{item?.name || 'Dataset case'}</p><p className="mt-1 text-sm text-slate-500">{item?.domain} / {item?.language}</p></div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-slate-600">{run.status}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
