'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';

type Run = { id: string; caseId?: string | null; status: string; scoringStatus: string; variantIndex?: number | null; replayManifest?: { environment?: string; riskTags?: string[] } | null };
type Score = { runId?: string | null; metricName?: string | null; value?: number | null };
type ExperimentData = {
  experiment: { name: string; status: string; datasetVersion: number; gitSha?: string | null; config?: { preset?: string } };
  dataset: { name: string };
  runtime?: { name: string } | null;
  runs: Run[];
  cases: Array<{ id: string; name: string; domain: string; language: string }>;
  scores: Score[];
  summary: { total: number; completed: number; passRate: number | null; edgeCoverage: number; edgeCount: number; expectedEdgeCount: number; effectiveConcurrency: number; visqol: { average: number | null }; dnsmos: { average: number | null }; geminiQuality: { average: number | null }; latencyBehavior: number | null; interruptionHandling: number | null; failuresByEnvironment: Array<{ environment: string; count: number }>; failureClusters: { graphNodes: Array<{ label: string; count: number }>; pressurePoints: Array<{ label: string; count: number }>; taxonomy: Array<{ label: string; count: number }> } };
};

function percent(value: number | null) { return value == null ? '—' : `${Math.round(value * 100)}%`; }
function mos(value: number | null) { return value == null ? '—' : value.toFixed(2); }
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function Metric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

export default function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ExperimentData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => fetch(`/api/experiments/${id}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Experiment could not be loaded.');
      setData(body as ExperimentData);
      setError('');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Experiment could not be loaded.'));
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [id]);

  const cases = useMemo(() => new Map((data?.cases ?? []).map((item) => [item.id, item])), [data]);
  const metrics = useMemo(() => {
    const result = new Map<string, Map<string, number>>();
    for (const score of data?.scores ?? []) {
      if (!score.runId || !score.metricName || typeof score.value !== 'number') continue;
      const row = result.get(score.runId) ?? new Map<string, number>();
      row.set(score.metricName, score.value);
      result.set(score.runId, row);
    }
    return result;
  }, [data]);
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading experiment…</div>;
  const progress = data.summary.total ? data.summary.completed / data.summary.total : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div><Link href="/experiments" className="text-sm text-slate-500">← Experiments</Link><h1 className="page-title mt-3">{data.experiment.name}</h1><p className="page-subtitle">{data.dataset.name} · version {data.experiment.datasetVersion} · {data.runtime?.name || 'Runtime unavailable'}</p></div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium capitalize text-slate-600">{data.experiment.status}</span>
          {data.runs.length > 1 && (
            <Link href={`/experiments/${id}/compare`} className="text-xs font-medium text-[#2f5ae0] hover:text-blue-800 transition-colors">Compare models →</Link>
          )}
        </div>
      </div>

      <section className="card p-5">
        <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-800">{data.summary.completed} of {data.summary.total} calls scored</span><span className="text-slate-500">{Math.round(progress * 100)}%</span></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#2f5ae0] transition-all" style={{ width: `${progress * 100}%` }} /></div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Success Rate" value={percent(data.summary.passRate)} detail="Completed tasks and rules followed" />
        <Metric title="Conversation Explored" value={percent(data.summary.edgeCoverage)} detail={`${data.summary.edgeCount}/${data.summary.expectedEdgeCount || data.summary.edgeCount} conversation paths explored`} />
        <Metric title="Call Audio Quality" value={mos(data.summary.visqol.average)} detail="Simulated caller voice clarity" />
        <Metric title="Agent Voice Quality" value={mos(data.summary.dnsmos.average)} detail="How natural the AI sounds" />
        <Metric title="AI Logic Quality" value={mos(data.summary.geminiQuality.average)} detail="LLM judge evaluation score" />
        <Metric title="Speed Under Pressure" value={percent(data.summary.latencyBehavior)} detail="Response time consistency" />
        <Metric title="Barge-in Handling" value={percent(data.summary.interruptionHandling)} detail="How well it handles being cut off" />
        <Metric title="Concurrent Calls" value={String(data.summary.effectiveConcurrency)} detail="How many calls it handles at once" />
        <Metric title="Test Configuration" value={label(data.experiment.config?.preset ?? 'release')} detail={`${data.summary.total} locked test environments`} />
      </div>

      {data.summary.failuresByEnvironment.length ? <section className="card p-5"><h2 className="font-semibold text-slate-900">Failures by environment</h2><div className="mt-4 flex flex-wrap gap-2">{data.summary.failuresByEnvironment.map((item) => <span key={item.environment} className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{label(item.environment)} · {item.count}</span>)}</div></section> : null}

      {(data.summary.failureClusters.graphNodes.length || data.summary.failureClusters.pressurePoints.length || data.summary.failureClusters.taxonomy.length) ? <section className="card p-5"><h2 className="font-semibold text-slate-900">Common Issues</h2><div className="mt-4 grid gap-5 md:grid-cols-3">{([['Conversation Steps', data.summary.failureClusters.graphNodes], ['Stress Triggers', data.summary.failureClusters.pressurePoints], ['AI Mistakes', data.summary.failureClusters.taxonomy]] as const).map(([title, items]) => <div key={title}><p className="text-xs font-medium uppercase text-slate-400">{title}</p><div className="mt-2 space-y-2">{items.slice(0, 5).map((item) => <div key={item.label} className="flex justify-between text-sm"><span className="text-slate-700">{label(item.label)}</span><span className="text-slate-400">{item.count}</span></div>)}</div></div>)}</div></section> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-900">Test Call Recordings</h2><p className="mt-1 text-xs text-slate-500">Each row is a unique simulated call with different voices, networks, and behaviors.</p></div>
        {data.runs.map((run) => {
          const item = run.caseId ? cases.get(run.caseId) : undefined;
          const runMetrics = metrics.get(run.id);
          return (
            <Link key={run.id} href={`/experiments/${id}/runs/${run.id}`} className="grid grid-cols-[minmax(0,1fr)_130px_100px_90px] items-center gap-3 border-b border-slate-100 px-5 py-4 last:border-0 hover:bg-slate-50">
              <div className="min-w-0"><p className="truncate font-medium text-slate-900">#{(run.variantIndex ?? 0) + 1} · {item?.name || 'Dataset case'}</p><p className="mt-1 truncate text-sm text-slate-500">{label(run.replayManifest?.environment ?? 'clean')} · {run.replayManifest?.riskTags?.join(', ') || item?.domain}</p></div>
              <span className="text-sm text-slate-600">MOS {runMetrics?.get('dnsmos_overall')?.toFixed(2) ?? '—'}</span>
              <span className="text-sm text-slate-600">Judge {runMetrics?.get('gemini_conversation_quality')?.toFixed(2) ?? '—'}</span>
              <span className={`justify-self-end rounded-full px-2.5 py-1 text-xs capitalize ${run.status === 'failed' ? 'bg-red-50 text-red-700' : run.status === 'complete' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{run.status === 'scoring' ? run.scoringStatus : run.status}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
