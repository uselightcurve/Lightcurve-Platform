'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ScoreBar, StatusChip } from '@/components/PageActions';

type RunRow = {
  id: string;
  experimentId: string;
  scenarioName: string;
  agent: string;
  status: string;
  mos: number | null;
  task: number | null;
  latencyP95: number | null;
  sttConfidence: number | null;
  duration: string;
  transcript?: string | Array<{ speaker: string; text: string; latencyMs?: number }>;
  traces?: Array<{ speaker: string; text: string; latencyMs?: number; totalLatencyMs?: number }>;
  failureSummary?: string | null;
};

function statusFor(status: string): 'pass' | 'fail' | 'running' | 'pending' {
  if (status === 'complete' || status === 'completed' || status === 'pass') return 'pass';
  if (status === 'failed' || status === 'fail') return 'fail';
  if (status === 'running') return 'running';
  return 'pending';
}

function ObservationMeter({ value }: { value: number | null }) {
  if (value == null) return <span className="text-sm text-slate-400">Pending</span>;
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

function CheckStatus({ status }: { status: 'pass' | 'fail' | 'pending' }) {
  const className =
    status === 'pass'
      ? 'bg-[#edf7f2] text-[#245b4c] ring-[#c7e8d9]'
      : status === 'fail'
        ? 'bg-[#fbf3f2] text-[#8f3d3b] ring-[#efcfcc]'
        : 'bg-slate-100 text-slate-500 ring-slate-200';

  return <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${className}`}>{status}</span>;
}

function traceTurns(run: RunRow) {
  if (Array.isArray(run.traces)) {
    return run.traces.map((trace) => ({
      speaker: trace.speaker,
      text: trace.text,
      latencyMs: trace.latencyMs ?? trace.totalLatencyMs,
    }));
  }

  if (Array.isArray(run.transcript)) return run.transcript;
  if (typeof run.transcript === 'string' && run.transcript.trim()) {
    return [{ speaker: 'transcript', text: run.transcript }];
  }

  return [];
}

export default function MonitorPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      setError('');
      try {
        const response = await fetch('/api/runs', { cache: 'no-store' });
        if (!response.ok) throw new Error('Monitor data is unavailable.');
        const payload = await response.json();
        if (!cancelled) setRuns(payload.runs ?? []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Monitor data is unavailable.');
      }
    }

    loadRuns();
    const interval = window.setInterval(loadRuns, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const activeRows = useMemo(
    () => runs.filter((run) => ['running', 'failed', 'fail'].includes(run.status)).slice(0, 25),
    [runs],
  );
  const visibleRows = activeRows.length ? activeRows : runs.slice(0, 25);
  const failedRows = runs.filter((run) => statusFor(run.status) === 'fail');
  const transcriptRows = runs
    .flatMap((run) =>
      traceTurns(run).slice(0, 4).map((turn, index) => ({
        id: `${run.id}-${index}`,
        scenario: run.scenarioName,
        speaker: turn.speaker,
        text: turn.text,
        latency: turn.latencyMs ? `${turn.latencyMs}ms` : '-',
      })),
    )
    .slice(0, 8);

  const checks = [
    { label: 'Runs captured', value: `${runs.length}`, status: runs.length ? 'pass' : 'pending' },
    {
      label: 'Transcripts',
      value: `${runs.filter((run) => traceTurns(run).length).length} available`,
      status: runs.some((run) => traceTurns(run).length) ? 'pass' : 'pending',
    },
    {
      label: 'Scores',
      value: `${runs.filter((run) => run.mos != null || run.task != null).length} scored`,
      status: runs.some((run) => run.mos != null || run.task != null) ? 'pass' : 'pending',
    },
    { label: 'Failures', value: `${failedRows.length} needs review`, status: failedRows.length ? 'fail' : 'pass' },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Monitor</h1>
        <p className="page-subtitle">Sandbox observation for live runs, transcripts, scoring, and release gates.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/experiments/new" className="toolbar-button toolbar-button-primary">New sandbox run</Link>
        <Link href="/logs" className="toolbar-button">Replay runs</Link>
        <button className="toolbar-button">All agents</button>
        <button className="toolbar-button">Past 1 hour</button>
        <button className="toolbar-button">Alerts</button>
      </div>

      {error && (
        <div className="rounded-lg border border-[#efcfcc] bg-[#fbf3f2] px-4 py-3 text-sm text-[#8f3d3b]">{error}</div>
      )}

      <div className="grid grid-cols-[1fr_320px] gap-4">
        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Sandbox runs</h2>
              <span className="text-xs text-slate-500">{failedRows.length} needs attention</span>
            </div>
          </div>
          {visibleRows.length ? (
            <table className="data-table table-fixed">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[16%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[7%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="table-header px-4 py-3 text-left">Scenario</th>
                  <th className="table-header px-4 py-3 text-left">Agent</th>
                  <th className="table-header px-4 py-3 text-left">Status</th>
                  <th className="table-header px-4 py-3 text-left">MOS</th>
                  <th className="table-header px-4 py-3 text-left">STT</th>
                  <th className="table-header px-4 py-3 text-left">p95</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((run) => (
                  <tr
                    key={run.id}
                    className={`border-b border-slate-100 last:border-b-0 ${statusFor(run.status) === 'fail' ? 'border-l-2 border-l-[#d9b3b0] bg-[#fbf3f2]/40' : ''}`}
                  >
                    <td className="px-4 py-4 text-slate-800">{run.scenarioName}</td>
                    <td className="px-4 py-4 text-slate-600">{run.agent}</td>
                    <td className="px-4 py-4"><StatusChip status={statusFor(run.status)} /></td>
                    <td className="px-4 py-4">{run.mos == null ? <span className="text-sm text-slate-400">Pending</span> : <ScoreBar value={run.mos} max={4.5} />}</td>
                    <td className="px-4 py-4"><ObservationMeter value={run.sttConfidence} /></td>
                    <td className="px-4 py-4 text-slate-600">{run.latencyP95 == null ? '-' : `${run.latencyP95}ms`}</td>
                    <td className="px-4 py-4 text-right">
                      <Link href={`/experiments/${run.experimentId}/runs/${run.id}`} className="text-sm text-slate-500 hover:text-slate-900">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-950">No sandbox observations yet</p>
              <p className="mt-2 text-sm text-slate-500">Create a sandbox run to see live status, transcripts, and scoring here.</p>
              <Link href="/experiments/new" className="btn-primary mt-4 inline-flex">Create Experiment</Link>
            </div>
          )}
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
                  <span className="tabular text-slate-500">3.8</span>
                </div>
                <ScoreBar value={3.8} max={4.5} />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Task threshold</span>
                  <span className="tabular text-slate-500">80%</span>
                </div>
                <ScoreBar value={0.8} />
              </div>
              <Link href="/settings/billing" className="toolbar-button flex w-full justify-center">Usage limits</Link>
            </div>
          </section>
        </aside>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Turn-level traces</h2>
        </div>
        {transcriptRows.length ? (
          <div className="divide-y divide-slate-100">
            {transcriptRows.map((trace) => (
              <div key={trace.id} className="grid grid-cols-[120px_220px_1fr_120px] items-start gap-4 px-4 py-3 text-sm">
                <span className="text-slate-500">{trace.speaker}</span>
                <span className="text-slate-700">{trace.scenario}</span>
                <span className="leading-6 text-slate-800">{trace.text}</span>
                <span className="text-slate-500">{trace.latency}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-sm text-slate-500">No transcript turns have been captured yet.</div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Regression alerts</h2>
        </div>
        {failedRows.length ? (
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="table-header px-4 py-3 text-left">Metric</th>
                <th className="table-header px-4 py-3 text-left">Scenario</th>
                <th className="table-header px-4 py-3 text-left">Issue</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {failedRows.slice(0, 10).map((run) => (
                <tr key={run.id} className="border-b border-l-2 border-b-slate-100 border-l-[#d9b3b0] bg-[#fbf3f2]/50">
                  <td className="px-4 py-3 text-[#8f3d3b]">Release gate</td>
                  <td className="px-4 py-3 text-slate-700">{run.scenarioName}</td>
                  <td className="px-4 py-3 text-slate-600">{run.failureSummary ?? 'Run failed or score fell below threshold.'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/experiments/${run.experimentId}/runs/${run.id}`} className="btn-secondary min-h-8 text-xs">Investigate</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-4 py-8 text-sm text-slate-500">No regression alerts from your captured runs.</div>
        )}
      </section>
    </div>
  );
}
