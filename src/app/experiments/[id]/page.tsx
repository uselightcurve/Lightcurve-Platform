'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getExperiment } from '@/lib/workspaceStore';

function ScoreBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color =
    max === 4.5
      ? value >= 3.5 ? 'bg-[#2f5ae0]' : value >= 3.0 ? 'bg-[#8a6a20]' : 'bg-[#a94d4a]'
      : value >= 0.8 ? 'bg-[#2f5ae0]' : value >= 0.6 ? 'bg-[#8a6a20]' : 'bg-[#a94d4a]';
  return (
    <div className="flex items-center gap-2">
      <div className="score-bar-track flex-1">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700 tabular-nums">
        {max === 4.5 ? `${value.toFixed(1)}/4.5` : value.toFixed(2)}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'status-pill-pending',
    running: 'status-pill-running',
    pass: 'status-pill-complete',
    fail: 'status-pill-failed',
    complete: 'status-pill-complete',
    completed: 'status-pill-complete',
    evaluating: 'status-pill-running',
    failed: 'status-pill-failed',
  };
  return <span className={map[status] ?? 'status-pill-pending'}>{status}</span>;
}

export default function ExperimentDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    const load = () => {
      const local = getExperiment(id);
      if (local) {
        setData({
          experiment: {
            ...local.experiment,
            agentType: local.experiment.agentType,
            status: local.experiment.status === 'pass' ? 'completed' : local.experiment.status,
          },
          runs: local.runs.map((run) => ({
            ...run,
            status: run.status === 'pass' ? 'complete' : run.status === 'fail' ? 'failed' : run.status,
            turnCount: run.traces.length,
            scenarioId: run.scenarioName,
          })),
          scores: local.runs.flatMap((run) =>
            run.scores.map((score) => ({
              ...score,
              id: `${run.id}-${score.metricName}`,
              runId: run.id,
            })),
          ),
        });
        setPolling(false);
        return;
      }

      fetch(`/api/experiments/${id}`)
        .then((r) => r.json())
        .then((d) => {
          setData(d);
          const allDone = d.runs?.every((r: any) => r.status === 'complete' || r.status === 'failed');
          if (allDone) setPolling(false);
        })
        .catch(() => setData({ error: 'Experiment not found' }));
    };

    load();
    if (!polling) return;
    const intervalId = setInterval(load, 3000);
    return () => clearInterval(intervalId);
  }, [id, polling]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="card p-8 text-center">
        <h1 className="page-title">Experiment not found</h1>
        <p className="page-subtitle">Create a sandbox test first, then open the experiment detail.</p>
        <Link href="/experiments/new" className="btn-primary mt-5">Create sandbox test</Link>
      </div>
    );
  }

  const exp = data.experiment;
  const runs: any[] = data.runs ?? [];
  const scores: any[] = data.scores ?? [];

  const avgMos = (() => {
    const vals = scores.filter((s) => s.metricName === 'mos').map((s) => s.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  const avgTc = (() => {
    const vals = scores.filter((s) => s.metricName === 'task_completed').map((s) => s.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/experiments" className="hover:text-gray-700">Experiments</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{exp.name}</span>
      </div>

      <div className="page-header flex items-start justify-between">
        <div>
          <h1 className="page-title">{exp.name}</h1>
          <p className="page-subtitle">Agent: <span className="capitalize">{exp.agentType}</span> · {runs.length} run{runs.length !== 1 ? 's' : ''}</p>
        </div>
        <StatusPill status={exp.status} />
      </div>

      {/* Aggregate score cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Avg MOS', value: avgMos, max: 4.5, fmt: (v: number) => `${v.toFixed(1)} / 4.5` },
          { label: 'Avg Task completion', value: avgTc, max: 1, fmt: (v: number) => v.toFixed(2) },
          { label: 'Total runs', value: runs.length, max: null, fmt: (v: number) => String(v) },
        ].map((card) => (
          <div key={card.label} className="card p-5">
            <div className="text-xs font-medium text-gray-400 mb-1">{card.label}</div>
            <div className="text-2xl font-medium text-gray-900">
              {card.value != null ? card.fmt(card.value as number) : '—'}
            </div>
            {card.max && card.value != null && (
              <div className="mt-2">
                <ScoreBar value={card.value as number} max={card.max} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Runs table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-800">Runs</h2>
          {polling && (
            <span className="flex items-center gap-1.5 text-xs text-[#2448bb]">
              <span className="w-1.5 h-1.5 bg-[#2f5ae0] rounded-full animate-pulse" />
              Live updating
            </span>
          )}
        </div>
        <table className="data-table">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="table-header px-5 py-3 text-left font-medium">Scenario</th>
              <th className="table-header px-5 py-3 text-left font-medium">Status</th>
              <th className="table-header px-5 py-3 text-left font-medium">Turns</th>
              <th className="table-header px-5 py-3 text-left font-medium">MOS</th>
              <th className="table-header px-5 py-3 text-left font-medium">Task score</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r: any, i: number) => {
              const runScores = scores.filter((s) => s.runId === r.id);
              const mos = runScores.find((s) => s.metricName === 'mos');
              const tc = runScores.find((s) => s.metricName === 'task_completed');
              return (
                <tr
                  key={r.id}
                  className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${i === runs.length - 1 ? 'border-0' : ''}`}
                >
                  <td className="px-5 py-3.5 font-mono text-xs text-gray-500 max-w-[200px] truncate">
                    {r.scenarioId}
                  </td>
                  <td className="px-5 py-3.5"><StatusPill status={r.status} /></td>
                  <td className="px-5 py-3.5 text-gray-500">{r.turnCount ?? '—'}</td>
                  <td className="px-5 py-3.5 min-w-[130px]">
                    {mos ? <ScoreBar value={mos.value} max={4.5} /> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3.5 min-w-[130px]">
                    {tc ? <ScoreBar value={tc.value} /> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/experiments/${id}/runs/${r.id}`}
                      className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
