'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ExperimentSummary = {
  id: string;
  name: string;
  datasetName: string;
  runtimeName?: string | null;
  runCount: number;
  status: string;
};

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/experiments', { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Evaluations could not be loaded.');
      setExperiments(Array.isArray(body.experiments) ? body.experiments : []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Evaluations could not be loaded.'));
  }, []);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between"><div><h1 className="page-title">Experiments</h1><p className="page-subtitle">Results from your automated test runs.</p></div><Link href="/experiments/new" className="btn-primary">Run experiment</Link></div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      <div className="overflow-hidden card">
        {experiments.length ? experiments.map((experiment) => (
          <Link key={experiment.id} href={`/experiments/${experiment.id}`} className="flex items-center justify-between border-b border-slate-100 px-5 py-4 last:border-0 hover:bg-slate-50">
            <div><p className="font-medium text-slate-900">{experiment.name}</p><p className="mt-1 text-sm text-slate-500">{experiment.datasetName} · {experiment.runtimeName || 'Runtime unavailable'} · {experiment.runCount} cases</p></div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-slate-600">{experiment.status}</span>
          </Link>
        )) : <div className="px-5 py-10 text-center text-sm text-slate-500">No dataset evaluations yet.</div>}
      </div>
    </div>
  );
}
