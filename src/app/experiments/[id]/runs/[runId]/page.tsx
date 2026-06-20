'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

type RunData = {
  run: { status: string; failureSummary?: string | null };
  case?: { name: string } | null;
  traces: Array<{ id: string; speaker?: string | null; text?: string | null }>;
};

export default function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = use(params);
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(`/api/runs/${runId}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Run could not be loaded.');
      setData(body as RunData);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Run could not be loaded.'));
  }, [runId]);
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading run...</div>;
  return (
    <div className="space-y-6">
      <div><Link href={`/experiments/${id}`} className="text-sm text-slate-500">&larr; Evaluation</Link><h1 className="page-title mt-3">{data.case?.name || 'Dataset case'}</h1><p className="page-subtitle">Human-derived replay / {data.run.status}</p></div>
      {data.run.failureSummary && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{data.run.failureSummary}</div>}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4 font-semibold">Conversation trace</div>
        {data.traces.length ? data.traces.map((trace) => <div key={trace.id} className="border-b border-slate-100 px-5 py-4 last:border-0"><p className="text-xs font-medium uppercase text-slate-400">{trace.speaker}</p><p className="mt-1 text-sm text-slate-800">{trace.text}</p></div>) : <div className="px-5 py-10 text-center text-sm text-slate-500">Replay is waiting for an available SDK runtime.</div>}
      </div>
    </div>
  );
}
