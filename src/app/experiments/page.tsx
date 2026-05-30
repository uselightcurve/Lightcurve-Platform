'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ScoreBar, StatusChip } from '@/components/PageActions';
import { COST_LANES, costLaneForProvider } from '@/lib/costLanes';

type ExperimentRow = {
  id: string;
  name: string;
  agentType: string;
  agentConfig?: unknown;
  webrtcEndpoint: string;
  status: string | null;
  gitSha: string | null;
  createdAt: string | null;
  summary?: {
    runs: number;
    avgMos: number | null;
    avgTask: number | null;
    latencyP95: number | null;
    passRate: number | null;
    failedReason: string | null;
  };
  workflow?: {
    sourceLane: keyof typeof COST_LANES;
    sourceLaneLabel: string;
    releaseStage: string;
    releaseLabel: string;
    canPromoteFailures: boolean;
    riskyCount: number;
    promotedFromId: string | null;
  };
};

const yamlSnippet = `name: Lightcurve voice eval
on: [pull_request]
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx lightcurve eval --suite release-gate --min-mos 3.8 --min-task 0.80`;

function statusFor(experiment: ExperimentRow) {
  if (experiment.workflow?.releaseStage === 'needs_real_verification') return 'running';
  if (experiment.workflow?.releaseStage === 'final_pass' || experiment.workflow?.releaseStage === 'low_cost_screen') return 'pass';
  if (experiment.workflow?.releaseStage === 'final_block') return 'fail';
  if (experiment.status === 'completed' || experiment.status === 'complete') return 'pass';
  if (experiment.status === 'failed' || experiment.summary?.failedReason) return 'fail';
  if (experiment.status === 'running') return 'running';
  return 'pending';
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function scoreOrPending(value: number | null | undefined, max = 1) {
  return typeof value === 'number' ? <ScoreBar value={value} max={max} /> : <span className="text-xs text-slate-400">Pending</span>;
}

function providerLabel(value: string) {
  if (value === 'stub_agent') return 'Agent Replica';
  if (value === 'custom_webrtc') return 'Custom WebRTC';
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState<'history' | 'imports' | 'cicd'>('history');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      const response = await fetch('/api/experiments', { cache: 'no-store' });
      if (!response.ok) {
        setError('Experiments are unavailable. Check database connectivity and retry.');
        return;
      }
      const data = await response.json();
      setExperiments(data.experiments ?? []);
      setError('');
    };
    load();
  }, []);

  const selectedExperiments = useMemo(
    () => experiments.filter((experiment) => selected.includes(experiment.id)),
    [experiments, selected],
  );

  function toggleSelected(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length < 2 ? [...current, id] : [current[1], id];
    });
  }

  async function toggleExpanded(id: string) {
    setExpanded((current) => current === id ? null : id);
    if (details[id]) return;
    const response = await fetch(`/api/experiments/${id}`, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      setDetails((current) => ({ ...current, [id]: payload }));
    }
  }

  async function copyCiSnippet() {
    await navigator.clipboard.writeText(yamlSnippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Experiments</h1>
        <p className="page-subtitle">Compare real agent versions, inspect scenario regressions, and wire results into CI/CD.</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="flex items-center justify-between">
        <div className="segmented-tabs">
          {(['history', 'imports', 'cicd'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`segmented-tab uppercase ${activeTab === tab ? 'segmented-tab-active' : ''}`}
            >
              {tab === 'cicd' ? 'CI/CD' : tab === 'imports' ? 'Imports' : 'History'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/experiments/new" className="btn-primary">Create Experiment</Link>
          <button className="btn-secondary" disabled={selected.length !== 2}>
            Compare Experiments
          </button>
        </div>
      </div>

      {selectedExperiments.length === 2 ? (
        <div className="card p-4">
          <h2 className="text-sm font-medium text-slate-950">Selected comparison</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            {selectedExperiments.map((experiment) => (
              <div key={experiment.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-slate-950">{experiment.name}</p>
                <div className="mt-3 space-y-2">
                  <div>MOS {scoreOrPending(experiment.summary?.avgMos, 4.5)}</div>
                  <div>Task {scoreOrPending(experiment.summary?.avgTask)}</div>
                  <div>Pass {scoreOrPending(experiment.summary?.passRate)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === 'history' ? (
        <div className="card overflow-hidden">
          <table className="data-table table-fixed text-xs">
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[20%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[11%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-3" />
                <th className="table-header px-3 py-3 text-left">Experiment Name</th>
                <th className="table-header px-3 py-3 text-left">Agent</th>
                <th className="table-header px-3 py-3 text-left">Runs</th>
                <th className="table-header px-3 py-3 text-left">Avg MOS</th>
                <th className="table-header px-3 py-3 text-left">Task Completion</th>
                <th className="table-header px-3 py-3 text-left">Latency p95</th>
                <th className="table-header px-3 py-3 text-left">Pass Rate</th>
                <th className="table-header px-3 py-3 text-left">Date</th>
                <th className="table-header px-3 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((experiment) => (
                <Fragment key={experiment.id}>
                  <tr
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                      statusFor(experiment) === 'fail' ? 'border-l-2 border-l-[#d9b3b0] bg-[#fbf3f2]/50' : ''
                    }`}
                    onClick={() => toggleExpanded(experiment.id)}
                  >
                    <td className="px-3 py-4" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selected.includes(experiment.id)} onChange={() => toggleSelected(experiment.id)} />
                    </td>
                    <td className="px-3 py-4">
                      <Link href={`/experiments/${experiment.id}`} className="text-slate-950 hover:text-[#2f5ae0]">{experiment.name}</Link>
                      <p className="mt-1 text-xs text-slate-500">Git {experiment.gitSha ?? '-'}</p>
                      {experiment.workflow?.releaseLabel ? (
                        <p className="mt-1 text-xs text-slate-500">{experiment.workflow.releaseLabel}</p>
                      ) : null}
                      {experiment.summary?.failedReason ? <p className="mt-1 text-xs text-[#8f3d3b]">{experiment.summary.failedReason}</p> : null}
                    </td>
                    <td className="px-3 py-4 text-slate-600">
                      <p className="text-sm text-slate-800">{providerLabel(experiment.agentType)}</p>
                      <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                        {experiment.workflow?.sourceLaneLabel ?? COST_LANES[costLaneForProvider(experiment.agentType, experiment.agentConfig, experiment.webrtcEndpoint)].label}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-slate-600">{experiment.summary?.runs ?? 0}</td>
                    <td className="px-3 py-4">{scoreOrPending(experiment.summary?.avgMos, 4.5)}</td>
                    <td className="px-3 py-4">{scoreOrPending(experiment.summary?.avgTask)}</td>
                    <td className="px-3 py-4 text-slate-600">{experiment.summary?.latencyP95 ? `${experiment.summary.latencyP95}ms` : '-'}</td>
                    <td className="px-3 py-4">{scoreOrPending(experiment.summary?.passRate)}</td>
                    <td className="px-3 py-4 text-slate-600">{formatDate(experiment.createdAt)}</td>
                    <td className="px-3 py-4"><StatusChip status={statusFor(experiment)} /></td>
                  </tr>
                  {expanded === experiment.id ? (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={10} className="px-5 py-4">
                        <div className="grid grid-cols-3 gap-3">
                          {(details[experiment.id]?.runs ?? []).map((run: any) => (
                            <Link
                              key={run.id}
                              href={`/experiments/${experiment.id}/runs/${run.id}`}
                              className="rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300"
                            >
                              <p className="truncate text-sm text-slate-950">{run.id}</p>
                              <p className="mt-2 text-xs text-slate-500">{run.status}</p>
                            </Link>
                          ))}
                          {details[experiment.id] && !details[experiment.id].runs?.length ? (
                            <p className="text-sm text-slate-500">No runs created for this experiment.</p>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {!experiments.length ? (
                <tr>
                  <td colSpan={10} className="px-5 py-14 text-center">
                    <p className="text-sm font-medium text-slate-900">No experiments yet</p>
                    <p className="mt-1 text-sm text-slate-500">Create a real sandbox run to start comparing agent quality.</p>
                    <Link href="/experiments/new" className="btn-primary mt-4 inline-flex">Create experiment</Link>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : activeTab === 'imports' ? (
        <div className="card p-6">
          <h2 className="text-sm font-medium text-slate-950">Production imports</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Imports only run after a real provider connection is configured in Settings. Lightcurve will not show sample provider calls here.
          </p>
          <Link href="/settings" className="btn-primary mt-5 inline-flex">Add agent connection</Link>
        </div>
      ) : (
        <div className="grid grid-cols-[1.2fr_0.8fr] gap-4">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-950">GitHub Actions snippet</h2>
              <button className="btn-secondary min-h-8 px-3 py-1.5 text-xs" onClick={copyCiSnippet}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="code-line mt-4 overflow-auto whitespace-pre-wrap">{yamlSnippet}</pre>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-medium text-slate-950">Release gate</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">CI/CD gates use real experiment scores through the release-gate API.</p>
            <Link href="/api/release-gate" className="btn-secondary mt-5 inline-flex">Open gate endpoint</Link>
          </div>
        </div>
      )}
    </div>
  );
}
