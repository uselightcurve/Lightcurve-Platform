'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ciRuns, experiments as demoExperiments } from '@/lib/uiDemoData';
import { ScoreBar, StatusChip } from '@/components/PageActions';
import { ProviderName } from '@/components/ProviderLogo';
import { demoImportedCalls, providerDefinitions, type NormalizedCall } from '@/lib/integrations';
import { getThresholds, listExperiments, saveScenario, saveThresholds } from '@/lib/workspaceStore';

const scenarioBreakdowns = [
  { scenario: 'angry_refund_call', mosA: 4.1, mosB: 3.8, taskA: 0.86, taskB: 0.76 },
  { scenario: 'plan_upgrade_hinglish', mosA: 3.9, mosB: 3.4, taskA: 0.82, taskB: 0.58 },
  { scenario: 'internet_outage_credit', mosA: 3.8, mosB: 3.2, taskA: 0.78, taskB: 0.52 },
];

const yamlSnippet = `name: Lightcurve voice eval
on: [pull_request]
jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx lightcurve eval --suite release-gate --min-mos 3.8 --min-task 0.80`;

export default function ExperimentsPage() {
  const [storedExperiments, setStoredExperiments] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(demoExperiments[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<'history' | 'imports' | 'cicd'>('history');
  const [showCompare, setShowCompare] = useState(false);
  const [importedCalls, setImportedCalls] = useState<NormalizedCall[]>(demoImportedCalls);
  const [importing, setImporting] = useState(false);
  const [scenarioCandidate, setScenarioCandidate] = useState<any | null>(null);
  const [mosThreshold, setMosThreshold] = useState('3.8');
  const [taskThreshold, setTaskThreshold] = useState('0.80');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = () => setStoredExperiments(listExperiments());
    const thresholds = getThresholds();
    setMosThreshold(thresholds.mos.toFixed(1));
    setTaskThreshold(thresholds.task.toFixed(2));
    load();
    window.addEventListener('lightcurve-workspace-updated', load);
    return () => window.removeEventListener('lightcurve-workspace-updated', load);
  }, []);

  const allExperiments = useMemo(() => {
    const existing = new Set(storedExperiments.map((experiment) => experiment.id));
    return [
      ...storedExperiments,
      ...demoExperiments.filter((experiment) => !existing.has(experiment.id)),
    ];
  }, [storedExperiments]);

  const selectedExperiments = useMemo(() => {
    return allExperiments.filter((experiment) => selected.includes(experiment.id));
  }, [allExperiments, selected]);

  function toggleSelected(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return current.length < 2 ? [...current, id] : [current[1], id];
    });
    setShowCompare(false);
  }

  async function importProductionCalls(provider: string) {
    setImporting(true);
    try {
      const response = await fetch('/api/imports/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json();
      setImportedCalls(data.calls?.length ? data.calls : demoImportedCalls);
    } finally {
      setImporting(false);
    }
  }

  async function convertFailure(call: NormalizedCall) {
    const response = await fetch('/api/scenarios/from-failure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call }),
    });
    const data = await response.json();
    setScenarioCandidate(data.scenario);
    if (data.scenario) {
      saveScenario({
        id: `import-${call.id}`,
        name: data.scenario.name,
        language: data.scenario.language,
        domain: data.scenario.domain,
        persona: {
          age: 35,
          accent: call.language,
          ...data.scenario.persona,
        },
        successCriteria: data.scenario.successCriteria,
        callerSeed: data.scenario.callerSeed,
        isPreset: false,
        source: data.scenario.source,
      });
    }
  }

  async function copyCiSnippet() {
    await navigator.clipboard.writeText(yamlSnippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function persistThresholds() {
    saveThresholds({
      mos: Number(mosThreshold) || 3.8,
      task: Number(taskThreshold) || 0.8,
    });
  }

  if (showCompare && selectedExperiments.length === 2) {
    const [left, right] = selectedExperiments;
    const metricRows = [
      ['Avg MOS', left.mos.toFixed(1), right.mos.toFixed(1), right.mos - left.mos],
      ['Task Completion', `${Math.round(left.task * 100)}%`, `${Math.round(right.task * 100)}%`, right.task - left.task],
      ['Latency p95', `${left.latencyP95}ms`, `${right.latencyP95}ms`, left.latencyP95 - right.latencyP95],
      ['Pass Rate', `${Math.round(left.passRate * 100)}%`, `${Math.round(right.passRate * 100)}%`, right.passRate - left.passRate],
    ] as const;

    return (
      <div className="space-y-5">
        <div className="page-header flex items-start justify-between">
          <div>
            <h1 className="page-title">Compare experiments</h1>
            <p className="page-subtitle">{left.date} / {left.version} compared with {right.date} / {right.version}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCompare(false)} className="btn-secondary">Back</button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="table-header px-5 py-3 text-left">Metric</th>
                <th className="table-header px-5 py-3 text-left">{left.name}</th>
                <th className="table-header px-5 py-3 text-left">{right.name}</th>
                <th className="table-header px-5 py-3 text-left">Delta</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map(([metric, leftValue, rightValue, delta]) => (
                <tr key={metric} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-5 py-4 text-slate-950">{metric}</td>
                  <td className="px-5 py-4 text-slate-600">{leftValue}</td>
                  <td className="px-5 py-4 text-slate-600">{rightValue}</td>
                  <td className={`px-5 py-4 ${delta >= 0 ? 'text-[#245b4c]' : 'text-[#8f3d3b]'}`}>
                    {delta > 0 ? '+' : ''}{typeof delta === 'number' && Math.abs(delta) < 1 ? delta.toFixed(2) : delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-medium text-slate-950">Per-scenario comparison</h2>
          </div>
          <table className="data-table">
            <tbody>
              {scenarioBreakdowns.map((row) => (
                <tr key={row.scenario} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-5 py-4 text-slate-950">{row.scenario}</td>
                  <td className="px-5 py-4"><ScoreBar value={row.mosA} max={4.5} /></td>
                  <td className="px-5 py-4"><ScoreBar value={row.mosB} max={4.5} /></td>
                  <td className="px-5 py-4 text-slate-500">same caller seed</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="card p-5">
            <h2 className="text-sm font-medium text-slate-950">Caller turns</h2>
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">I have already called twice. Where is my refund?</p>
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Please do not tell me it was delivered. It was not at my door.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="text-sm font-medium text-slate-950">{left.version}</h2>
              <p className="mt-4 text-sm leading-6 text-slate-600">Opened missing-package review, acknowledged uncertainty, offered refund escalation.</p>
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-medium text-slate-950">{right.version}</h2>
              <p className="mt-4 text-sm leading-6 text-slate-600">Repeated delivery scan, delayed escalation, missed caller frustration cue.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Experiments</h1>
        <p className="page-subtitle">Compare agent versions, inspect scenario regressions, and wire results into CI/CD.</p>
      </div>

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
          <Link href="/experiments/new" className="btn-primary">
            Create Experiment
          </Link>
          <button
            className="btn-secondary"
            disabled={selected.length !== 2}
            onClick={() => setShowCompare(true)}
          >
            Compare Experiments
          </button>
        </div>
      </div>

      {activeTab === 'history' ? (
        <div className="card overflow-hidden">
          <table className="data-table table-fixed text-xs">
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[11%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[11%]" />
              <col className="w-[7%]" />
              <col className="w-[7%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-3 py-3" />
                <th className="table-header px-3 py-3 text-left">Experiment Name</th>
                <th className="table-header px-3 py-3 text-left">Agent Version</th>
                <th className="table-header px-3 py-3 text-left">Scenarios</th>
                <th className="table-header px-3 py-3 text-left">Avg MOS</th>
                <th className="table-header px-3 py-3 text-left">Task Completion</th>
                <th className="table-header px-3 py-3 text-left">Latency p95</th>
                <th className="table-header px-3 py-3 text-left">Pass Rate</th>
                <th className="table-header px-3 py-3 text-left">Date</th>
                <th className="table-header px-3 py-3 text-left">Compare</th>
              </tr>
            </thead>
            <tbody>
              {allExperiments.map((experiment) => (
                <Fragment key={experiment.id}>
                  <tr
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                      experiment.reason || experiment.status === 'fail' ? 'border-l-2 border-l-[#d9b3b0] bg-[#fbf3f2]/50' : ''
                    }`}
                    onClick={() => setExpanded(expanded === experiment.id ? null : experiment.id)}
                  >
                    <td className="px-3 py-4" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.includes(experiment.id)}
                        onChange={() => toggleSelected(experiment.id)}
                      />
                    </td>
                    <td className="px-3 py-4">
                      <p className="text-slate-950">{experiment.name}</p>
                      <p className="mt-1 text-xs text-slate-500">Git {experiment.gitSha}</p>
                      {experiment.reason && <p className="mt-1 text-xs text-[#8f3d3b]">{experiment.reason}</p>}
                    </td>
                    <td className="px-3 py-4 text-slate-600">{experiment.version}</td>
                    <td className="px-3 py-4 text-slate-600">{experiment.scenarios}</td>
                    <td className="px-3 py-4"><ScoreBar value={experiment.mos} max={4.5} /></td>
                    <td className="px-3 py-4"><ScoreBar value={experiment.task} /></td>
                    <td className="px-3 py-4 text-slate-600">{experiment.latencyP95}ms</td>
                    <td className="px-3 py-4"><ScoreBar value={experiment.passRate} /></td>
                    <td className="px-3 py-4 text-slate-600">{experiment.date.replace(', 2026', '')}</td>
                    <td className="px-3 py-4">
                      <StatusChip status={experiment.reason || experiment.status === 'fail' ? 'fail' : 'pass'} />
                    </td>
                  </tr>
                  {expanded === experiment.id && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={10} className="px-5 py-4">
                        <div className="grid grid-cols-3 gap-3">
                          {scenarioBreakdowns.map((row) => (
                            <div key={row.scenario} className="rounded-lg border border-slate-200 bg-white p-3">
                              <p className="text-sm text-slate-950">{row.scenario}</p>
                              <div className="mt-3"><ScoreBar value={experiment.id === 'exp-stage-v3' ? row.mosB : row.mosA} max={4.5} /></div>
                              <p className="mt-2 text-xs text-slate-500">Task seed locked for transcript diff</p>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : activeTab === 'imports' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {providerDefinitions.map((provider) => (
              <button
                key={provider.id}
                onClick={() => importProductionCalls(provider.id)}
                className="card p-4 text-left hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-950">
                      <ProviderName provider={provider.id} name={provider.name} />
                    </p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{provider.tagline}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {provider.capabilities.length}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-sm font-medium text-slate-950">Production failures</h2>
                <p className="mt-1 text-xs text-slate-500">Imported calls are normalized before evals, recommendations, and scenario replay.</p>
              </div>
              <button onClick={() => importProductionCalls('all')} className="btn-secondary" disabled={importing}>
                {importing ? 'Importing' : 'Import all'}
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="table-header px-5 py-3 text-left">Provider</th>
                  <th className="table-header px-5 py-3 text-left">Call</th>
                  <th className="table-header px-5 py-3 text-left">Failure</th>
                  <th className="table-header px-5 py-3 text-left">MOS</th>
                  <th className="table-header px-5 py-3 text-left">Task</th>
                  <th className="table-header px-5 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {importedCalls.map((call) => (
                  <tr key={call.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-5 py-4 text-slate-600">
                      <ProviderName
                        provider={call.provider}
                        name={providerDefinitions.find((provider) => provider.id === call.provider)?.name ?? call.provider}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-slate-950">{call.scenarioName}</p>
                      <p className="mt-1 text-xs text-slate-500">{call.externalCallId} / {call.language}</p>
                    </td>
                    <td className="max-w-md px-5 py-4 text-slate-600">{call.failureSummary}</td>
                    <td className="min-w-32 px-5 py-4">{call.mos ? <ScoreBar value={call.mos} max={4.5} /> : '-'}</td>
                    <td className="min-w-36 px-5 py-4">{call.taskCompletion ? <ScoreBar value={call.taskCompletion} /> : '-'}</td>
                    <td className="px-5 py-4">
                      <button onClick={() => convertFailure(call)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">
                        Convert to Scenario
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scenarioCandidate && (
            <div className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-label">Scenario candidate</p>
                  <h2 className="mt-2 text-sm font-medium text-slate-950">{scenarioCandidate.name}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{scenarioCandidate.persona.goal}</p>
                  <p className="mt-3 text-sm text-[#2448bb]">{scenarioCandidate.source.promptRecommendation}</p>
                </div>
                <a href="/scenarios" className="btn-primary">Review in Scenarios</a>
              </div>
            </div>
          )}
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
          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="text-sm font-medium text-slate-950">Pass/fail thresholds</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-500">MOS<input className="input-field mt-1" value={mosThreshold} onChange={(event) => setMosThreshold(event.target.value)} /></label>
                <label className="text-xs text-slate-500">Task<input className="input-field mt-1" value={taskThreshold} onChange={(event) => setTaskThreshold(event.target.value)} /></label>
              </div>
              <button className="btn-primary mt-4 w-full" onClick={persistThresholds}>Save thresholds</button>
            </div>
            <div className="card overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-sm font-medium text-slate-950">Last CI runs</h2>
              </div>
              {ciRuns.map((run) => (
                <div key={run.sha} className="flex items-center justify-between border-b border-slate-100 px-5 py-3 last:border-b-0">
                  <div>
                    <p className="text-sm text-slate-950">{run.sha}</p>
                    <p className="text-xs text-slate-500">{run.experiment}</p>
                  </div>
                  <StatusChip status={run.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
