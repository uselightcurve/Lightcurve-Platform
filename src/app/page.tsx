'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ScoreBar, StatusChip } from '@/components/PageActions';
import { OverviewMetricGrid } from '@/components/OverviewMetricGrid';

type OverviewResponse = {
  panels: {
    calls: { value: number; series: number[] };
    mos: { value: number; series: number[] };
    task: { value: number; series: number[] };
    latency: { value: number; series: number[] };
    failures: { value: number; series: number[] };
    experiments: { value: number; series: number[] };
  };
  recentExperiments: Array<{ id: string; name: string; status: string | null; mos: number | null; date: string }>;
  failingScenarios: Array<{ runId: string; experimentId: string | null; name: string; reason: string; score: number }>;
};

function emptyOverview(): OverviewResponse {
  return {
    panels: {
      calls: { value: 0, series: [0] },
      mos: { value: 0, series: [0] },
      task: { value: 0, series: [0] },
      latency: { value: 0, series: [0] },
      failures: { value: 0, series: [0] },
      experiments: { value: 0, series: [0] },
    },
    recentExperiments: [],
    failingScenarios: [],
  };
}

function statusFor(status: string | null) {
  if (status === 'completed' || status === 'complete' || status === 'pass') return 'pass';
  if (status === 'failed' || status === 'fail') return 'fail';
  if (status === 'running') return 'running';
  return 'pending';
}

export default function Home() {
  const [overview, setOverview] = useState<OverviewResponse>(() => emptyOverview());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const response = await fetch('/api/overview', { cache: 'no-store' });
      if (!response.ok) {
        setError('Workspace metrics are unavailable. Check database connectivity and retry.');
        setLoading(false);
        return;
      }
      setOverview(await response.json());
      setError('');
      setLoading(false);
    };
    load();
  }, []);

  const panels = useMemo(() => [
    {
      title: 'Calls',
      value: overview.panels.calls.value.toString(),
      href: '/logs',
      icon: 'bubble',
      variant: 'line' as const,
      series: overview.panels.calls.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Avg MOS',
      value: overview.panels.mos.value ? overview.panels.mos.value.toFixed(1) : '-',
      href: '/monitor?metric=mos',
      icon: 'target',
      variant: 'line' as const,
      series: overview.panels.mos.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Task completion',
      value: overview.panels.task.value ? `${Math.round(overview.panels.task.value)}%` : '-',
      href: '/monitor?metric=task',
      icon: 'check',
      variant: 'line' as const,
      series: overview.panels.task.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Latency p95',
      value: overview.panels.latency.value ? `${(overview.panels.latency.value / 1000).toFixed(1)}s` : '-',
      href: '/monitor?metric=latency',
      icon: 'clock',
      variant: 'line' as const,
      series: overview.panels.latency.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Failure topics',
      value: overview.panels.failures.value.toString(),
      href: '/experiments?tab=imports',
      icon: 'topic',
      variant: 'bars' as const,
      series: overview.panels.failures.series,
      labels: ['refund', 'billing', 'clinic', 'plan', 'outage', 'routing', 'payment'],
    },
    {
      title: 'Experiments',
      value: overview.panels.experiments.value.toString(),
      href: '/experiments',
      icon: 'flask',
      variant: 'line' as const,
      series: overview.panels.experiments.series,
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
  ], [overview]);

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <p className="page-subtitle">Health and release readiness across sandbox calls.</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/monitor" className="btn-primary">View charts</Link>
        <Link href="/logs" className="btn-secondary">Calls</Link>
        <Link href="/experiments/new" className="btn-secondary">Create experiment</Link>
      </div>

      <OverviewMetricGrid panels={panels} />

      {!loading && !overview.recentExperiments.length && !overview.failingScenarios.length ? (
        <section className="card p-8 text-center">
          <h2 className="text-base font-medium text-slate-950">No sandbox runs yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Connect a real agent endpoint, pick scenarios, and Lightcurve will populate this dashboard with live run data.
          </p>
          <Link href="/experiments/new" className="btn-primary mt-5 inline-flex">Create first experiment</Link>
        </section>
      ) : (
        <div className="grid grid-cols-[1.25fr_0.75fr] gap-4">
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Recent experiments</h2>
            </div>
            <table className="data-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="table-header px-4 py-3 text-left">Name</th>
                  <th className="table-header px-4 py-3 text-left">Status</th>
                  <th className="table-header px-4 py-3 text-left">MOS</th>
                  <th className="table-header px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {overview.recentExperiments.map((experiment) => (
                  <tr key={experiment.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 text-slate-800">{experiment.name}</td>
                    <td className="px-4 py-3"><StatusChip status={statusFor(experiment.status)} /></td>
                    <td className="min-w-[150px] px-4 py-3">
                      {experiment.mos ? <ScoreBar value={experiment.mos} max={4.5} /> : <span className="text-sm text-slate-400">Pending</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{experiment.date}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/experiments/${experiment.id}`} className="btn-secondary min-h-8 text-xs">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Failing scenarios</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {overview.failingScenarios.length ? overview.failingScenarios.map((scenario) => (
                <div key={scenario.runId} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm text-slate-800">{scenario.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{scenario.reason}</p>
                    <div className="mt-2">
                      <ScoreBar value={scenario.score} />
                    </div>
                  </div>
                  <Link href="/experiments/new" className="btn-secondary min-h-8 self-start text-xs">Re-run</Link>
                </div>
              )) : (
                <div className="px-4 py-8 text-sm text-slate-500">No failed scenarios yet.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
