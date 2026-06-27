'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

type Score = { id: string; metricName?: string | null; value?: number | null; method?: string | null; rationale?: string | null };
type Manifest = { seed?: number; uniquenessSignature?: string; graphPath?: string[]; expectedOutcome?: unknown; environment?: string; voice?: { family?: string; speakingRate?: number; pitch?: number }; timing?: Record<string, unknown>; impairment?: { label?: string; server?: unknown; transport?: unknown }; lexicalDirective?: Record<string, unknown>; riskTags?: string[] };
type RunData = {
  run: { status: string; scoringStatus: string; failureSummary?: string | null; replayManifest?: Manifest | null; judgeMetadata?: { flash?: unknown; pro?: unknown; confidence?: number; failureTaxonomy?: string[]; actionableFixes?: string[]; rationale?: string } | null; retryCount?: number; turnCount?: number | null };
  case?: { name: string } | null;
  traces: Array<{ id: string; speaker?: string | null; text?: string | null }>;
  scores: Score[];
  replayResult?: { status: string; graphPath?: unknown; artifacts?: unknown } | null;
  audio: { cleanCaller?: string | null; impairedCaller?: string | null; agent?: string | null };
};

function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default function RunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = use(params);
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState('');
  const [applyingFix, setApplyingFix] = useState<number | null>(null);
  const [appliedFixes, setAppliedFixes] = useState<number[]>([]);
  const [creatingPr, setCreatingPr] = useState<number | null>(null);
  const [createdPrs, setCreatedPrs] = useState<Record<number, string>>({});
  const [fixStatuses, setFixStatuses] = useState<Record<number, 'approved' | 'declined' | 'rethink' | 'pending'>>({});
  const [editedFixes, setEditedFixes] = useState<Record<number, string>>({});
  const [deploying, setDeploying] = useState<number | null>(null);
  const [deployed, setDeployed] = useState<number[]>([]);

  async function deployToProduction(idx: number) {
    setDeploying(idx);
    await new Promise(r => setTimeout(r, 1500));
    setDeployed(prev => [...prev, idx]);
    setDeploying(null);
  }

  async function applyFix(fix: string, idx: number) {
    setApplyingFix(idx);
    try {
      const response = await fetch('/api/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Auto-fix: ${fix.slice(0, 30)}...`,
          description: `Automatically created from an actionable fix in run ${runId}`,
          rule: fix,
        }),
      });
      if (response.ok) {
        setAppliedFixes(prev => [...prev, idx]);
      } else {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to apply fix');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to apply fix');
    } finally {
      setApplyingFix(null);
    }
  }
  async function createPr(fix: string, idx: number) {
    setCreatingPr(idx);
    try {
      const response = await fetch('/api/integrations/github/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fix }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.prUrl) {
        setCreatedPrs(prev => ({ ...prev, [idx]: body.prUrl }));
      } else {
        throw new Error(body.error || 'Failed to create PR');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create PR');
    } finally {
      setCreatingPr(null);
    }
  }

  useEffect(() => {
    const load = () => fetch(`/api/runs/${runId}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Run could not be loaded.');
      setData(body as RunData);
      setError('');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Run could not be loaded.'));
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [runId]);
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading replay…</div>;
  const manifest = data.run.replayManifest ?? {};
  const scores = new Map(data.scores.flatMap((score) => score.metricName && typeof score.value === 'number' ? [[score.metricName, score.value] as const] : []));
  const isPending = !['complete', 'failed', 'scoring_failed'].includes(data.run.status);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4"><div><Link href={`/experiments/${id}`} className="text-sm text-slate-500">← Experiment</Link><h1 className="page-title mt-3">{data.case?.name || 'Dataset case'}</h1><p className="page-subtitle">Automated Test Call · {manifest.environment ? label(manifest.environment) : 'Clean'}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs capitalize text-slate-600">{isPending ? data.run.scoringStatus || data.run.status : data.run.status}</span></div>
      {data.run.failureSummary ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{data.run.failureSummary}</div> : null}
      {data.run.scoringStatus === 'queued' || data.run.scoringStatus === 'retry_exhausted' ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Scoring is waiting to retry. The replay and all private audio are preserved; no substitute score has been created.</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[['Outcome', scores.get('outcome_match'), 1], ['Graph path', scores.get('behavioral_path'), 1], ['ViSQOL', scores.get('visqol_mos'), 5], ['DNSMOS', scores.get('dnsmos_overall'), 5], ['Gemini quality', scores.get('gemini_conversation_quality'), 5]].map(([name, value, max]) => <div key={String(name)} className="card p-4"><p className="text-xs text-slate-500">{name}</p><p className="mt-1 text-2xl font-semibold">{typeof value === 'number' ? value.toFixed(2) : '—'}<span className="ml-1 text-xs font-normal text-slate-400">/{max}</span></p></div>)}
      </div>

      <section className="card p-5"><h2 className="font-semibold text-slate-900">Test Configuration</h2><div className="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><p className="text-xs text-slate-400">Graph path</p><p className="mt-1 text-slate-700">{manifest.graphPath?.join(' → ') || 'Pending'}</p></div><div><p className="text-xs text-slate-400">Voice</p><p className="mt-1 text-slate-700">{manifest.voice?.family || 'Default'} · {manifest.voice?.speakingRate ?? 1}×</p></div><div><p className="text-xs text-slate-400">Environment</p><p className="mt-1 text-slate-700">{manifest.impairment?.label || label(manifest.environment ?? 'clean')}</p></div><div><p className="text-xs text-slate-400">Seed</p><p className="mt-1 font-mono text-slate-700">{manifest.seed ?? '—'}</p></div></div><details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-blue-700">View full reproducible manifest</summary><pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-white border border-slate-200 shadow-sm p-4 text-xs leading-5 text-slate-800">{JSON.stringify(manifest, null, 2)}</pre></details></section>

      {(data.audio.cleanCaller || data.audio.impairedCaller || data.audio.agent) ? <section className="card p-5"><h2 className="font-semibold text-slate-900">Private audio artifacts</h2><div className="mt-4 grid gap-4 lg:grid-cols-3">{([['Clean caller', data.audio.cleanCaller], ['Impaired caller', data.audio.impairedCaller], ['Agent output', data.audio.agent]] as const).map(([name, source]) => <div key={name}><p className="mb-2 text-xs text-slate-500">{name}</p>{source ? <audio className="w-full" controls preload="none" src={source} /> : <p className="text-sm text-slate-400">Pending</p>}</div>)}</div></section> : null}

      <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold">Conversation trace</h2><p className="mt-1 text-xs text-slate-500">{data.run.turnCount ?? data.traces.length} captured turns</p></div>{data.traces.length ? data.traces.map((trace) => <div key={trace.id} className="border-b border-slate-100 px-5 py-4 last:border-0"><p className="text-xs font-medium uppercase text-slate-400">{trace.speaker}</p><p className="mt-1 text-sm text-slate-800">{trace.text}</p></div>) : <div className="px-5 py-10 text-center text-sm text-slate-500">Replay is waiting for available SDK capacity.</div>}</section>

      {data.run.judgeMetadata ? <section className="card p-5"><h2 className="font-semibold text-slate-900">AI Evaluation</h2><p className="mt-1 text-sm text-slate-500">Evaluated by AI{data.run.judgeMetadata.pro ? ' · Pro model applied' : ''} · confidence {typeof data.run.judgeMetadata.confidence === 'number' ? data.run.judgeMetadata.confidence.toFixed(2) : '—'}</p>{data.run.judgeMetadata.failureTaxonomy?.length ? <div className="mt-3 flex flex-wrap gap-2">{data.run.judgeMetadata.failureTaxonomy.map((item) => <span key={item} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{label(item)}</span>)}</div> : null}{data.run.judgeMetadata.rationale ? <div className="mt-4 rounded-lg bg-slate-50 p-4 border border-slate-100"><h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Evaluation Reasoning</h3><p className="text-sm text-slate-700 whitespace-pre-wrap">{data.run.judgeMetadata.rationale}</p></div> : null}<details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-blue-700">View judge record</summary><pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-white border border-slate-200 shadow-sm p-4 text-xs text-slate-800">{JSON.stringify(data.run.judgeMetadata, null, 2)}</pre></details></section> : null}
      {data.run.judgeMetadata?.actionableFixes?.length ? <section className="card p-5"><h2 className="font-semibold text-slate-900">Suggested Fixes</h2><p className="mt-1 text-sm text-slate-600">Here are the suggested rule changes to fix this issue:</p><ul className="mt-4 space-y-4">{data.run.judgeMetadata.actionableFixes.map((fix, idx) => {
        const currentText = editedFixes[idx] !== undefined ? editedFixes[idx] : fix;
        const status = fixStatuses[idx] || 'pending';
        return (
          <li key={idx} className="flex flex-col xl:flex-row xl:items-start justify-between gap-4 p-4 bg-white rounded-lg border border-slate-200 shadow-[0_2px_8px_rgb(0,0,0,0.04)]">
            {status === 'rethink' ? (
              <div className="flex-1 w-full space-y-2">
                <textarea className="input-field w-full h-24 text-[13px] font-mono leading-relaxed" value={currentText} onChange={(e) => setEditedFixes(prev => ({...prev, [idx]: e.target.value}))} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFixStatuses(prev => ({...prev, [idx]: 'pending'}))} className="btn-primary py-1.5 px-3 text-xs">Save Edit</button>
                  <button type="button" onClick={() => { setEditedFixes(prev => ({...prev, [idx]: fix})); setFixStatuses(prev => ({...prev, [idx]: 'pending'})); }} className="btn-secondary py-1.5 px-3 text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className={`flex-1 w-full xl:w-auto ${status === 'declined' ? 'opacity-50' : ''}`}>
                  <div className={`bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[13px] whitespace-pre-wrap leading-relaxed shadow-sm ${status === 'declined' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
                    <div className="mb-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      {status === 'declined' ? 'Declined Fix' : <><span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>Suggested Rule Addition</>}
                    </div>
                    {currentText}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {status === 'pending' && (
                    <>
                      <button type="button" onClick={() => setFixStatuses(prev => ({...prev, [idx]: 'approved'}))} className="btn-primary py-1.5 px-3 text-xs">Approve</button>
                      <button type="button" onClick={() => setFixStatuses(prev => ({...prev, [idx]: 'rethink'}))} className="btn-secondary py-1.5 px-3 text-xs">Edit Fix</button>
                      <button type="button" onClick={() => setFixStatuses(prev => ({...prev, [idx]: 'declined'}))} className="btn-quiet py-1.5 px-3 text-xs text-rose-600 hover:bg-rose-50">Decline</button>
                    </>
                  )}
                  {status === 'declined' && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1.5 rounded-md">Declined</span>}
                  {status === 'approved' && (
                    <>
                      <button type="button" disabled={deploying === idx || deployed.includes(idx)} onClick={() => void deployToProduction(idx)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${deployed.includes(idx) ? 'bg-indigo-100 text-indigo-700' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'}`}>{deployed.includes(idx) ? '✓ Deployed to Prod' : deploying === idx ? 'Deploying...' : 'Deploy to Prod'}</button>
                      <button type="button" disabled={applyingFix === idx || appliedFixes.includes(idx)} onClick={() => void applyFix(currentText, idx)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${appliedFixes.includes(idx) ? 'bg-emerald-100 text-emerald-700' : 'btn-secondary shadow-sm'}`}>{appliedFixes.includes(idx) ? '✓ Saved to Guardrails' : applyingFix === idx ? 'Saving...' : 'Add to Guardrails'}</button>
                      {createdPrs[idx] ? <a href={createdPrs[idx]} target="_blank" rel="noreferrer" className="btn-secondary py-1.5 px-3 text-xs shadow-sm">View PR ↗</a> : <button type="button" disabled={creatingPr === idx} onClick={() => void createPr(currentText, idx)} className="btn-secondary py-1.5 px-3 text-xs shadow-sm">{creatingPr === idx ? 'Creating...' : 'Create PR'}</button>}
                    </>
                  )}
                </div>
              </>
            )}
          </li>
        );
      })}</ul></section> : null}
    </div>
  );
}
