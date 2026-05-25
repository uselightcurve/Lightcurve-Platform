import Link from 'next/link';
import { ScoreBar, StatusChip } from '@/components/PageActions';
import { OverviewMetricGrid } from '@/components/OverviewMetricGrid';
import { demoRuns, failingScenarios } from '@/lib/uiDemoData';

const panels = [
  {
    title: 'Calls',
    value: demoRuns.length.toString(),
    sublabel: 'sandbox runs',
    href: '/logs',
    icon: 'bubble',
    variant: 'line' as const,
    series: [2, 3, 4, 4, 5, 6, 6],
    labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
  },
  {
    title: 'Avg MOS',
    value: '4.0',
    sublabel: 'target 3.8',
    href: '/monitor?metric=mos',
    icon: 'target',
    variant: 'line' as const,
    series: [3.6, 3.7, 3.9, 3.8, 4.0, 4.1, 4.0],
    labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
  },
  {
    title: 'Task completion',
    value: '79%',
    sublabel: 'release gate 80%',
    href: '/monitor?metric=task',
    icon: 'check',
    variant: 'line' as const,
    series: [64, 70, 76, 74, 78, 81, 79],
    labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
  },
  {
    title: 'Latency p95',
    value: '1.4s',
    sublabel: 'target 1.5s',
    href: '/monitor?metric=latency',
    icon: 'clock',
    variant: 'line' as const,
    series: [1.8, 1.7, 1.6, 1.6, 1.5, 1.4, 1.4],
    labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
  },
  {
    title: 'Failure topics',
    value: failingScenarios.length.toString(),
    sublabel: 'needs review',
    href: '/experiments?tab=imports',
    icon: 'topic',
    variant: 'bars' as const,
    series: [34, 58, 46, 74, 62, 38, 82, 54, 48, 68],
    labels: ['refund', 'billing', 'clinic', 'plan', 'outage', 'routing', 'payment', 'fraud', 'noise', 'handoff'],
  },
  {
    title: 'Experiments',
    value: '12',
    sublabel: 'this week',
    href: '/experiments',
    icon: 'flask',
    variant: 'line' as const,
    series: [4, 5, 7, 8, 9, 11, 12],
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
];

export default function Home() {
  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <p className="page-subtitle">Health and release readiness across sandbox calls.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/monitor" className="btn-primary">+ Chart</Link>
        <button className="btn-secondary">Calls</button>
        <button className="btn-secondary">All agents view</button>
        <button className="btn-quiet">Filter</button>
        <button className="btn-quiet">Group</button>
        <button className="btn-secondary">Last 14 days</button>
        <button className="btn-secondary">Alerts</button>
      </div>

      <OverviewMetricGrid panels={panels} />

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
              {demoRuns.slice(0, 5).map((run) => (
                <tr key={run.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-4 py-3 text-slate-800">{run.scenario}</td>
                  <td className="px-4 py-3"><StatusChip status={run.status} /></td>
                  <td className="min-w-[150px] px-4 py-3"><ScoreBar value={run.mos} max={4.5} /></td>
                  <td className="px-4 py-3 text-slate-500">{run.date}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href="/logs" className="btn-secondary min-h-8 text-xs">View</Link>
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
            {failingScenarios.map((scenario) => (
              <div key={scenario.name} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                <div>
                  <p className="text-sm text-slate-800">{scenario.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{scenario.reason}</p>
                  <div className="mt-2">
                    <ScoreBar value={scenario.score} />
                  </div>
                </div>
                <Link href="/experiments/new" className="btn-secondary min-h-8 self-start text-xs">Re-run</Link>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
