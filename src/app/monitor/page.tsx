'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ScoreBar, StatusChip } from '@/components/PageActions';
import { regressionAlerts } from '@/lib/uiDemoData';
import { demoRunsAsStored, listRuns, type StoredRun } from '@/lib/workspaceStore';

const traceRows = [
  {
    speaker: 'caller',
    scenario: 'plan_upgrade_hinglish',
    text: 'Mujhe unlimited data plan chahiye, but price clear batao.',
    latency: 'STT 740ms',
    confidence: '81%',
  },
  {
    speaker: 'agent',
    scenario: 'plan_upgrade_hinglish',
    text: 'I can help you upgrade. The unlimited plan starts at 899 per month.',
    latency: 'LLM 1180ms',
    confidence: 'ok',
  },
  {
    speaker: 'caller',
    scenario: 'internet_outage_credit',
    text: 'My internet has been down for six hours. I work from home.',
    latency: 'STT 910ms',
    confidence: '73%',
  },
  {
    speaker: 'agent',
    scenario: 'internet_outage_credit',
    text: 'I see the outage. I can check restoration ETA and billing credit.',
    latency: 'TTS 520ms',
    confidence: 'ok',
  },
];

const checks = [
  { label: 'Audio captured', value: '6 of 6', status: 'pass' },
  { label: 'STT confidence', value: '86% avg', status: 'warn' },
  { label: 'MOS scoring', value: 'complete', status: 'pass' },
  { label: 'CI output', value: '1 gate failed', status: 'fail' },
];

function ObservationMeter({ value }: { value: number }) {
  const color = value >= 0.86 ? 'bg-[#2f5ae0]' : value >= 0.78 ? 'bg-[#8a6a20]' : 'bg-[#a94d4a]';

  return (
    <div className="grid grid-cols-[42px_76px] items-center gap-3">
      <span className="tabular text-sm text-slate-700">{Math.round(value * 100)}%</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </div>
  );
}

function CheckStatus({ status }: { status: string }) {
  const className =
    status === 'pass'
      ? 'bg-[#edf7f2] text-[#245b4c] ring-[#c7e8d9]'
      : status === 'fail'
        ? 'bg-[#fbf3f2] text-[#8f3d3b] ring-[#efcfcc]'
        : 'bg-[#fbf7ea] text-[#8a6a20] ring-[#ead99b]';

  return <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${className}`}>{status}</span>;
}

export default function MonitorPage() {
  const [storedRuns, setStoredRuns] = useState<StoredRun[]>([]);
  useEffect(() => {
    const load = () => setStoredRuns(listRuns());
    load();
    window.addEventListener('lightcurve-workspace-updated', load);
    return () => window.removeEventListener('lightcurve-workspace-updated', load);
  }, []);

  const observationRows = useMemo(() => {
    return [...storedRuns, ...demoRunsAsStored()].map((run, index) => ({
      ...run,
      stream: index === 0 ? 'live' : 'replay',
      route: index % 2 === 0 ? 'LiveKit' : 'Vapi',
    }));
  }, [storedRuns]);
  const liveRows = observationRows.filter((run) => run.status === 'running' || run.status === 'fail');

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Monitor</h1>
        <p className="page-subtitle">Sandbox observation for calls, STT confidence, traces, and release gates.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="toolbar-button toolbar-button-primary">Live calls</button>
        <button className="toolbar-button">Replay runs</button>
        <button className="toolbar-button">All agents</button>
        <button className="btn-quiet min-h-8 px-2">Filter</button>
        <button className="btn-quiet min-h-8 px-2">Group</button>
        <button className="toolbar-button">Past 1 hour</button>
        <button className="toolbar-button">Alerts</button>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-4">
        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Active sandbox calls</h2>
              <span className="text-xs text-slate-500">{liveRows.length} needs attention</span>
            </div>
          </div>
          <table className="data-table table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[11%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[7%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="table-header px-4 py-3 text-left">Scenario</th>
                <th className="table-header px-4 py-3 text-left">Route</th>
                <th className="table-header px-4 py-3 text-left">Agent</th>
                <th className="table-header px-4 py-3 text-left">Status</th>
                <th className="table-header px-4 py-3 text-left">MOS</th>
                <th className="table-header px-4 py-3 text-left">STT</th>
                <th className="table-header px-4 py-3 text-left">p95</th>
                <th className="table-header px-4 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody>
              {observationRows.map((run) => (
                <tr
                  key={run.id}
                  className={`border-b border-slate-100 last:border-b-0 ${run.status === 'fail' ? 'border-l-2 border-l-[#d9b3b0] bg-[#fbf3f2]/40' : ''}`}
                >
                  <td className="px-4 py-4 text-slate-800">{run.scenarioName}</td>
                  <td className="px-4 py-4 text-slate-600">{run.route}</td>
                  <td className="px-4 py-4 text-slate-600">{run.agent}</td>
                  <td className="px-4 py-4"><StatusChip status={run.status} /></td>
                  <td className="px-4 py-4"><ScoreBar value={run.mos} max={4.5} /></td>
                  <td className="px-4 py-4"><ObservationMeter value={run.sttConfidence} /></td>
                  <td className="px-4 py-4 text-slate-600">{run.latencyP95}ms</td>
                  <td className="px-4 py-4 text-slate-600">{run.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Observation checks</h2>
            <div className="mt-4 space-y-3">
              {checks.map((check) => (
                <div key={check.label} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                  <div>
                    <p className="text-sm text-slate-700">{check.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{check.value}</p>
                  </div>
                  <CheckStatus status={check.status} />
                </div>
              ))}
            </div>
          </section>

          <section className="card p-4">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Sandbox gates</h2>
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">MOS threshold</span>
                  <span className="tabular text-slate-500">3.5</span>
                </div>
                <ScoreBar value={3.9} max={4.5} />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Task threshold</span>
                  <span className="tabular text-slate-500">80%</span>
                </div>
                <ScoreBar value={0.79} />
              </div>
              <button className="toolbar-button w-full">Edit thresholds</button>
            </div>
          </section>
        </aside>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Turn-level traces</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {traceRows.map((trace) => (
            <div key={`${trace.speaker}-${trace.scenario}`} className="grid grid-cols-[120px_220px_1fr_120px_80px] items-start gap-4 px-4 py-3 text-sm">
              <span className="text-slate-500">{trace.speaker}</span>
              <span className="text-slate-700">{trace.scenario}</span>
              <span className="leading-6 text-slate-800">{trace.text}</span>
              <span className="text-slate-500">{trace.latency}</span>
              <span className="text-slate-500">{trace.confidence}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Regression alerts</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="table-header px-4 py-3 text-left">Metric</th>
              <th className="table-header px-4 py-3 text-left">Scenario</th>
              <th className="table-header px-4 py-3 text-left">Previous</th>
              <th className="table-header px-4 py-3 text-left">Current</th>
              <th className="table-header px-4 py-3 text-left">Delta</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {regressionAlerts.map((alert) => (
              <tr key={`${alert.metric}-${alert.scenario}`} className="border-b border-l-2 border-b-slate-100 border-l-[#d9b3b0] bg-[#fbf3f2]/50">
                <td className="px-4 py-3 text-[#8f3d3b]">{alert.metric}</td>
                <td className="px-4 py-3 text-slate-700">{alert.scenario}</td>
                <td className="px-4 py-3 text-slate-600">{alert.previous}</td>
                <td className="px-4 py-3 text-slate-600">{alert.current}</td>
                <td className="px-4 py-3 text-[#8f3d3b]">{alert.delta}</td>
                <td className="px-4 py-3 text-right">
                  <Link href="/logs" className="btn-secondary min-h-8 text-xs">Investigate</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
