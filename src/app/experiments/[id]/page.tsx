'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getExperiment } from '@/lib/workspaceStore';

function formatScenarioName(value: unknown) {
  return String(value ?? 'Unknown scenario')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function ScoreBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color =
    max === 5
      ? value >= 3.8 ? 'bg-[#2f5ae0]' : value >= 3.3 ? 'bg-[#8a6a20]' : 'bg-[#a94d4a]'
      : value >= 0.8 ? 'bg-[#2f5ae0]' : value >= 0.6 ? 'bg-[#8a6a20]' : 'bg-[#a94d4a]';

  return (
    <div className="flex items-center gap-2">
      <div className="score-bar-track flex-1">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700 tabular-nums">
        {max === 5 ? value.toFixed(1) : `${Math.round(value * 100)}%`}
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

  const label = status === 'complete' || status === 'completed' ? 'Pass' : status === 'failed' ? 'Fail' : status;
  return <span className={map[status] ?? 'status-pill-pending'}>{label}</span>;
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
          scenarios: [],
        });
        setPolling(false);
        return;
      }

      fetch(`/api/experiments/${id}`)
        .then((r) => r.json())
        .then((d) => {
          setData(d);
          if (['vapi', 'retell', 'elevenlabs'].includes(d.experiment?.agentType)) {
            (d.runs ?? [])
              .filter(
                (run: any) =>
                  run.externalCallId &&
                  (['running', 'evaluating'].includes(run.status) || (run.status === 'complete' && (run.turnCount ?? 0) === 0)),
              )
              .forEach((run: any) => {
                fetch(`/api/runs/${run.id}/poll`, { method: 'POST' }).catch(() => undefined);
              });
          }
          const allDone = d.runs?.every((run: any) => run.status === 'complete' || run.status === 'failed');
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
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-gray-400">Loading...</div>
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
  const scenarios: any[] = data.scenarios ?? [];
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const failedRuns = runs.filter((run) => run.status === 'failed');
  const firstFailure = failedRuns.find((run) => run.failureSummary)?.failureSummary;

  const avgMos = (() => {
    const vals = scores.filter((score) => score.metricName === 'mos').map((score) => score.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  const avgTask = (() => {
    const vals = scores.filter((score) => score.metricName === 'task_completed').map((score) => score.value);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-400">
        <Link href="/experiments" className="hover:text-gray-700">Experiments</Link>
        <span>/</span>
        <span className="font-medium text-gray-700">{exp.name}</span>
      </div>

      <div className="page-header flex items-start justify-between">
        <div>
          <h1 className="page-title">{exp.name}</h1>
          <p className="page-subtitle">
            Agent: <span className="capitalize">{exp.agentType}</span> - {runs.length} run{runs.length !== 1 ? 's' : ''}
          </p>
        </div>
        <StatusPill status={exp.status} />
      </div>

      {failedRuns.length > 0 && (
        <div className="mb-4 rounded-lg border border-[#e3c3c1] bg-[#fbf3f2] px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#8f3d3b]">Release gate failed</p>
              <p className="mt-1 text-sm leading-relaxed text-[#8f3d3b]">
                {firstFailure ?? 'One or more scenarios missed the MOS or task-completion threshold.'}
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[#e3c3c1] bg-white px-2 py-0.5 text-xs font-medium text-[#8f3d3b]">
              {failedRuns.length} failed
            </span>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { label: 'Avg MOS', value: avgMos, max: 5, fmt: (value: number) => value.toFixed(1) },
          { label: 'Avg Task completion', value: avgTask, max: 1, fmt: (value: number) => `${Math.round(value * 100)}%` },
          { label: 'Total runs', value: runs.length, max: null, fmt: (value: number) => String(value) },
        ].map((card) => (
          <div key={card.label} className="card p-5">
            <div className="mb-1 text-xs font-medium text-gray-400">{card.label}</div>
            <div className="text-2xl font-medium text-gray-900">
              {card.value != null ? card.fmt(card.value as number) : '-'}
            </div>
            {card.max && card.value != null && (
              <div className="mt-2">
                <ScoreBar value={card.value as number} max={card.max} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-medium text-gray-800">Runs</h2>
          {polling && (
            <span className="flex items-center gap-1.5 text-xs text-[#2448bb]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2f5ae0]" />
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
            {runs.map((run, index) => {
              const runScores = scores.filter((score) => score.runId === run.id);
              const mos = runScores.find((score) => score.metricName === 'mos');
              const task = runScores.find((score) => score.metricName === 'task_completed');
              const scenario = scenariosById.get(run.scenarioId);
              const scenarioName = scenario?.name ?? run.scenarioId;

              return (
                <tr
                  key={run.id}
                  className={`border-b border-gray-100 transition-colors hover:bg-gray-50 ${index === runs.length - 1 ? 'border-0' : ''}`}
                >
                  <td className="max-w-[280px] px-5 py-3.5">
                    <div className="truncate text-sm font-medium text-gray-800">{formatScenarioName(scenarioName)}</div>
                    {run.failureSummary && (
                      <div className="mt-1 truncate text-xs text-[#8f3d3b]">{run.failureSummary}</div>
                    )}
                  </td>
                  <td className="px-5 py-3.5"><StatusPill status={run.status} /></td>
                  <td className="px-5 py-3.5 text-gray-500">{run.turnCount ?? '-'}</td>
                  <td className="min-w-[130px] px-5 py-3.5">
                    {mos ? <ScoreBar value={mos.value} max={5} /> : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="min-w-[130px] px-5 py-3.5">
                    {task ? <ScoreBar value={task.value} /> : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/experiments/${id}/runs/${run.id}`}
                      className="text-xs text-gray-400 transition-colors hover:text-gray-700"
                    >
                      View -&gt;
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
