'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { StatusChip } from '@/components/PageActions';
import { demoRunsAsStored, listRuns, type StoredRun } from '@/lib/workspaceStore';

const filters = {
  Language: ['en-US', 'hi-IN', 'es-ES', 'en-GB'],
  Domain: ['telecom', 'banking', 'ecommerce', 'healthcare'],
  Emotion: ['angry', 'neutral', 'urgent', 'frustrated', 'nervous'],
  Status: ['pass', 'fail', 'running', 'pending'],
};

function ScoreCell({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min((value / max) * 100, 100));
  const color = pct >= 80 ? 'bg-[#2f5ae0]' : pct >= 60 ? 'bg-[#8a6a20]' : 'bg-[#a94d4a]';

  return (
    <div className="grid grid-cols-[38px_58px] items-center gap-2">
      <span className="tabular text-xs text-slate-700">
        {max === 4.5 ? value.toFixed(1) : `${Math.round(value * 100)}%`}
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="table-header">{label}</p>
      <p className="mt-1 text-sm text-slate-700">{value}</p>
    </div>
  );
}

function FilterSelect({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select className="select-field h-9 min-w-[150px]" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {values.map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
    </label>
  );
}

export default function LogsPage() {
  const [storedRuns, setStoredRuns] = useState<StoredRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filterState, setFilterState] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const load = () => setStoredRuns(listRuns());

    load();
    window.addEventListener('lightcurve-workspace-updated', load);
    return () => {
      window.removeEventListener('lightcurve-workspace-updated', load);
    };
  }, []);

  const rows = useMemo(() => {
    const merged = [...storedRuns, ...demoRunsAsStored()];
    return merged.filter((run) => {
    const target = `${run.scenarioName} ${run.transcript}`.toLowerCase();
      const matchesQuery = !query || target.includes(query.toLowerCase());
      const matchesLanguage = !filterState.Language?.length || filterState.Language.includes(run.language);
      const matchesDomain = !filterState.Domain?.length || filterState.Domain.includes(run.domain);
      const matchesEmotion = !filterState.Emotion?.length || filterState.Emotion.includes(run.emotion);
      const matchesStatus = !filterState.Status?.length || filterState.Status.includes(run.status);
      return matchesQuery && matchesLanguage && matchesDomain && matchesEmotion && matchesStatus;
    });
  }, [filterState, query, storedRuns]);

  function exportCsv() {
    const header = ['Scenario', 'Language', 'Agent', 'MOS', 'Task', 'Duration', 'Status', 'Date'];
    const body = rows.map((run) => [
      run.scenarioName,
      run.language,
      run.agent,
      run.mos.toFixed(1),
      Math.round(run.task * 100).toString(),
      run.duration,
      run.status,
      run.date,
    ]);
    const csv = [header, ...body].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lightcurve-call-logs.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function setFilter(label: string, value: string) {
    setFilterState((current) => ({ ...current, [label]: value ? [value] : [] }));
  }

  return (
    <div className="space-y-5">
      <div className="page-header flex items-start justify-between">
        <div>
          <h1 className="page-title">Logs</h1>
          <p className="page-subtitle">Search, filter, and replay every simulated call.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="toolbar-button" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="card rounded-xl px-4 py-3">
          <div className="grid grid-cols-[repeat(4,minmax(150px,1fr))_auto] items-end gap-3">
            {Object.entries(filters).map(([group, values]) => (
              <FilterSelect
                key={group}
                label={group}
                values={values}
                value={filterState[group]?.[0] ?? ''}
                onChange={(value) => setFilter(group, value)}
              />
            ))}
            <button className="toolbar-button h-9" onClick={() => setFilterState({})}>
              Clear
            </button>
          </div>
        </div>
        <section className="card overflow-hidden rounded-xl">
          <div className="border-b border-slate-200 px-4 py-3">
            <input
              className="input-field h-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search scenario name or transcript text"
            />
          </div>

          <table className="data-table table-fixed">
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[10%]" />
              <col className="w-[31%]" />
              <col className="w-[9%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2" />
                <th className="table-header px-3 py-2 text-left">Created</th>
                <th className="table-header px-3 py-2 text-left">Scenario</th>
                <th className="table-header px-3 py-2 text-left">Language</th>
                <th className="table-header px-3 py-2 text-left">MOS</th>
                <th className="table-header px-3 py-2 text-left">Task</th>
                <th className="table-header px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <Fragment key={run.id}>
                  <tr
                    onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                      run.status === 'fail' ? 'border-l-2 border-l-[#d9b3b0]' : ''
                    }`}
                  >
                    <td className="px-3 py-3 text-center text-slate-400">
                      <span className={`inline-block transition-transform ${expanded === run.id ? 'rotate-90' : ''}`}>{'>'}</span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{run.date.replace(', 2026', '')}</td>
                    <td className="px-3 py-3">
                      <p className="truncate text-slate-800">{run.scenarioName}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{run.domain} / {run.emotion}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{run.language}</td>
                    <td className="px-3 py-3"><ScoreCell value={run.mos} max={4.5} /></td>
                    <td className="px-3 py-3"><ScoreCell value={run.task} /></td>
                    <td className="px-3 py-3"><StatusChip status={run.status} /></td>
                    <td className="px-3 py-3 text-right">
                      <button className="btn-secondary min-h-7 px-3 text-xs" onClick={(event) => event.stopPropagation()}>
                        Play
                      </button>
                    </td>
                  </tr>

                  {expanded === run.id && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={8} className="px-3 py-3">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="grid grid-cols-5 gap-4">
                            <DetailItem label="Agent" value={run.agent} />
                            <DetailItem label="Duration" value={run.duration} />
                            <DetailItem label="Latency p95" value={`${run.latencyP95}ms`} />
                            <DetailItem label="STT" value={`${Math.round(run.sttConfidence * 100)}%`} />
                            <DetailItem label="Run ID" value={run.id} />
                          </div>
                          <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3">
                            <button className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-white">
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M4 2.5v11l9-5.5-9-5.5z" />
                              </svg>
                            </button>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full w-2/5 rounded-full bg-[#2f5ae0]" />
                            </div>
                            <span className="max-w-[520px] truncate text-xs text-slate-500">{run.transcript}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>

          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Page 1 of 1 - 25 rows per page
          </div>
        </section>
      </div>
    </div>
  );
}
