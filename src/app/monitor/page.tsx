'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

const waveformHeights = [32, 58, 76, 44, 88, 62, 35, 72, 96, 52, 41, 83, 67, 49, 91, 34, 64, 78, 45, 59, 73, 38, 86, 55, 69, 31, 47, 82, 61, 36, 74, 93, 43, 57, 80, 39, 65, 90, 51, 70];

type RunSummary = { id: string };
type ScoreRow = { metricName?: string; value?: number; rationale?: string | null };
type TraceRow = { speaker?: string | null; text?: string | null };
type RunDetail = {
  run?: { status?: string | null; failureSummary?: string | null; variantIndex?: number | null };
  traces?: TraceRow[];
  scores?: ScoreRow[];
  audio?: { agent?: string | null };
  case?: { name?: string | null };
  experiment?: { name?: string | null; runtimeId?: string | null };
};

export default function CallAnalysisPage() {
  const [runData, setRunData] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/runs');
        const data = await res.json() as { runs?: RunSummary[] };
        if (data.runs && data.runs.length > 0) {
          const runId = data.runs[0].id;
          const detailsRes = await fetch(`/api/runs/${runId}`);
          const details = await detailsRes.json() as RunDetail;
          setRunData(details);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading monitor data...</div>;
  }

  if (!runData) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-base font-medium text-slate-950">No runs available</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
          Run an experiment to monitor the agent&apos;s performance here.
        </p>
        <Link href="/experiments/new" className="btn-primary mt-5 inline-flex">Create first experiment</Link>
      </div>
    );
  }

  const { run, traces, scores, audio, case: caseData, experiment } = runData;
  const isPass = run?.status === 'pass' || run?.status === 'completed' || scores?.some((s) => s.metricName === 'task_completed' && s.value === 1);
  const verdict = isPass ? 'Pass' : 'Fail';
  const summary = run?.failureSummary || "No summary available for this run.";
  const intent = caseData?.name || experiment?.name || "Unknown Intent";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-5 mb-2">
        <div className="flex items-center gap-4">
          <h1 className="page-title text-[1.4rem]">Monitor</h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary h-[36px] w-[36px] p-0 flex items-center justify-center bg-white border-slate-200">
            <svg className="w-[18px] h-[18px] text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            <span className="sr-only">Export</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 items-start">
        {/* Left Column: Call Summary */}
        <div className={`card overflow-hidden ${isPass ? 'border-emerald-200 bg-emerald-50/50' : 'border-[#fecaca] bg-[#fff5f5]'}`}>
          <div className={`p-6 border-b ${isPass ? 'border-emerald-200' : 'border-[#fecaca]'}`}>
            <h2 className={`text-lg font-semibold ${isPass ? 'text-emerald-800' : 'text-[#7f1d1d]'}`}>Call Summary</h2>
          </div>
          
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-[140px_1fr] gap-4">
              <span className={`text-sm font-medium ${isPass ? 'text-emerald-800' : 'text-[#991b1b]'}`}>Verdict</span>
              <div>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${isPass ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-[#fee2e2] text-[#991b1b] border-[#fca5a5]'}`}>
                  {verdict}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[140px_1fr] gap-4">
              <span className={`text-sm font-medium ${isPass ? 'text-emerald-800' : 'text-[#991b1b]'}`}>Summary</span>
              <p className={`text-sm leading-relaxed ${isPass ? 'text-emerald-900' : 'text-[#7f1d1d]'}`}>
                {summary}
              </p>
            </div>

            {scores && scores.length > 0 && (
              <div className="grid grid-cols-[140px_1fr] gap-4">
                <span className={`text-sm font-medium ${isPass ? 'text-emerald-800' : 'text-[#991b1b]'}`}>Outcome Breakdown</span>
                <div className="space-y-2">
                  {scores.map((score, idx) => (
                    <div key={idx} className={`bg-white border ${isPass ? 'border-emerald-200 hover:border-emerald-300' : 'border-[#fecaca] hover:border-[#fca5a5]'} rounded-lg p-3 flex items-start justify-between gap-4 cursor-pointer transition-colors shadow-sm`}>
                      <span className="text-sm text-slate-800 leading-tight flex-1">{score.rationale || score.metricName}</span>
                      <div className="flex items-center gap-3 shrink-0 mt-0.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${(score.value ?? 0) >= 1 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                          {(score.value ?? 0) >= 1 ? 'Pass' : 'Fail'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Audio Player Card */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Audio Recording</h3>
              <span className="text-xs font-medium tabular text-slate-500 bg-slate-100 px-2 py-1 rounded">00:00</span>
            </div>
            
            <div className="flex items-center gap-3">
              <button className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 flex items-center justify-center text-white transition-colors shadow-sm">
                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              </button>
              
              {/* Mock Waveform */}
              <div className="flex-1 flex items-center gap-[2px] h-10">
                {[...Array(40)].map((_, i) => (
                  <div 
                    key={i} 
                    className={`w-full rounded-full ${i < 15 ? 'bg-blue-600' : 'bg-slate-200'}`}
                    style={{ height: `${waveformHeights[i] ?? 40}%` }}
                  />
                ))}
              </div>
            </div>
            {audio?.agent && (
              <div className="mt-4 flex justify-between gap-2">
                <audio controls className="w-full h-8" src={audio.agent} />
              </div>
            )}
          </div>

          {/* Scenario Details */}
          <div className="card">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Scenario Details</h3>
              <Link href="/datasets" className="text-xs font-medium text-blue-600 hover:underline">View in Dataset</Link>
            </div>
            
            <div className="p-5 space-y-5">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Agent</span>
                  <span className="block text-sm font-medium text-slate-900">{experiment?.runtimeId ? "Production Agent" : "SDK Agent"}</span>
                </div>
                <div className="flex-1">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Variant</span>
                  <span className="block text-sm font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded w-max">Run {run?.variantIndex ?? 1}</span>
                </div>
              </div>

              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Intent</span>
                <p className="text-sm text-slate-700 leading-snug">{intent}</p>
              </div>
            </div>
          </div>

          {/* Accordions */}
          <div className="card overflow-hidden">
            <button className="w-full p-4 flex items-center justify-between border-b border-slate-100 hover:bg-slate-50 transition-colors">
              <span className="text-sm font-semibold text-slate-900">Transcript ({traces?.length || 0} turns)</span>
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {traces && traces.length > 0 && (
              <div className="p-4 bg-slate-50 space-y-3 max-h-60 overflow-y-auto">
                {traces.map((trace, idx) => (
                  <div key={idx}>
                    <div className="text-xs font-semibold text-slate-500 mb-1">{trace.speaker}</div>
                    <div className="text-sm text-slate-800">{trace.text}</div>
                  </div>
                ))}
              </div>
            )}
            <button className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-900">Raw Metadata</span>
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
