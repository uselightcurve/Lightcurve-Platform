'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

type RunSummary = { id: string; caseId?: string | null; variantIndex?: number | null; status: string; replayManifest?: { environment?: string } | null };
type ExperimentData = {
  experiment: { name: string };
  runs: RunSummary[];
  cases: Array<{ id: string; name: string }>;
};
type RunDetail = {
  run: { status: string; scoringStatus: string; failureSummary?: string | null; judgeMetadata?: { confidence?: number; rationale?: string; actionableFixes?: string[] } | null };
  case?: { name: string } | null;
  traces: Array<{ id: string; speaker?: string | null; text?: string | null }>;
  scores: Array<{ metricName?: string | null; value?: number | null }>;
};

function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function CompareRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [expData, setExpData] = useState<ExperimentData | null>(null);
  const [baseRunId, setBaseRunId] = useState('');
  const [compRunId, setCompRunId] = useState('');
  const [baseRun, setBaseRun] = useState<RunDetail | null>(null);
  const [compRun, setCompRun] = useState<RunDetail | null>(null);

  useEffect(() => {
    fetch(`/api/experiments/${id}`).then(r => r.json()).then(data => {
      setExpData(data);
      if (data.runs?.length > 0) {
        setBaseRunId(data.runs[0].id);
        if (data.runs.length > 1) setCompRunId(data.runs[1].id);
        else setCompRunId(data.runs[0].id);
      }
    });
  }, [id]);

  useEffect(() => {
    if (baseRunId) fetch(`/api/runs/${baseRunId}`).then(r => r.json()).then(setBaseRun);
  }, [baseRunId]);

  useEffect(() => {
    if (compRunId) fetch(`/api/runs/${compRunId}`).then(r => r.json()).then(setCompRun);
  }, [compRunId]);

  if (!expData) return <div className="text-sm text-slate-500">Loading comparison...</div>;

  const cases = new Map(expData.cases?.map(c => [c.id, c.name]) || []);

  const renderRunSide = (runId: string, setRunId: (v: string) => void, runDetail: RunDetail | null) => {
    const scores = new Map(runDetail?.scores?.flatMap(s => s.metricName && typeof s.value === 'number' ? [[s.metricName, s.value]] : []) || []);
    return (
      <div className="flex-1 min-w-0 space-y-4">
        <select className="input-field w-full" value={runId} onChange={(e) => setRunId(e.target.value)}>
          {expData.runs?.map(r => <option key={r.id} value={r.id}>#{ (r.variantIndex ?? 0) + 1 } · {cases.get(r.caseId || '') || 'Case'} · {label(r.replayManifest?.environment ?? 'clean')}</option>)}
        </select>
        
        {!runDetail ? <div className="p-4 text-sm text-slate-500">Loading run details...</div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3"><p className="text-xs text-slate-500">DNSMOS</p><p className="mt-1 text-xl font-semibold">{scores.get('dnsmos_overall')?.toFixed(2) ?? '—'}</p></div>
              <div className="card p-3"><p className="text-xs text-slate-500">Quality</p><p className="mt-1 text-xl font-semibold">{scores.get('gemini_conversation_quality')?.toFixed(2) ?? '—'}</p></div>
            </div>
            
            {runDetail.run.failureSummary && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <p className="font-semibold mb-1">Failure</p>
                {runDetail.run.failureSummary}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden max-h-[600px] flex flex-col">
              <div className="border-b border-slate-100 px-4 py-3 bg-slate-50"><h3 className="font-semibold text-sm">Conversation Trace</h3></div>
              <div className="overflow-y-auto p-4 space-y-4 flex-1">
                {runDetail.traces?.map(t => (
                  <div key={t.id}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{t.speaker}</p>
                    <p className="text-sm text-slate-800">{t.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/experiments/${id}`} className="text-sm text-slate-500">← Back to Experiment</Link>
        <h1 className="page-title mt-3">Compare Runs</h1>
        <p className="page-subtitle">{expData.experiment?.name} · Side-by-side call comparison</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {renderRunSide(baseRunId, setBaseRunId, baseRun)}
        {renderRunSide(compRunId, setCompRunId, compRun)}
      </div>
    </div>
  );
}
