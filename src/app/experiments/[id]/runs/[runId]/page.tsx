'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getRun } from '@/lib/workspaceStore';

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

export default function RunDetail() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [data, setData] = useState<any>(null);
  const [polling, setPolling] = useState(true);
  const [importTranscript, setImportTranscript] = useState('');
  const [importAudioUrl, setImportAudioUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    const load = () => {
      const localRun = getRun(runId);
      if (localRun) {
        setData({
          run: {
            ...localRun,
            status: localRun.status === 'pass' ? 'complete' : localRun.status === 'fail' ? 'failed' : localRun.status,
            turnCount: localRun.traces.length,
          },
          traces: localRun.traces.map((trace, index) => ({
            ...trace,
            turnIndex: index,
            totalLatencyMs: trace.latencyMs,
            sttConfidence: trace.sttConfidence,
          })),
          scores: localRun.scores.map((score) => ({
            ...score,
            id: `${localRun.id}-${score.metricName}`,
            runId: localRun.id,
            method: score.metricName === 'mos' ? 'simulated-mos' : 'sandbox-judge',
          })),
        });
        setPolling(false);
        return;
      }

      fetch(`/api/runs/${runId}`)
        .then((r) => r.json())
        .then((d) => {
          setData(d);
          if (d.run?.externalCallId && ['vapi', 'retell', 'elevenlabs'].includes(d.run?.provider) && ['running', 'evaluating'].includes(d.run.status)) {
            fetch(`/api/runs/${runId}/poll`, { method: 'POST' }).catch(() => undefined);
          }
          if (d.run?.status === 'complete' || d.run?.status === 'failed') setPolling(false);
        })
        .catch(() => setData({ error: 'Run not found' }));
    };

    load();
    if (!polling) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [runId, polling]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">Loading...</div>
    );
  }

  if (data.error) {
    return (
      <div className="card p-8 text-center">
        <h1 className="page-title">Run not found</h1>
        <p className="page-subtitle">Create or save a sandbox call to inspect the transcript.</p>
        <Link href="/playground" className="btn-primary mt-5">Open playground</Link>
      </div>
    );
  }

  const run = data.run;
  const experiment = data.experiment;
  const scenario = data.scenario;
  const persona = scenario?.persona ?? {};
  const traces: any[] = data.traces ?? [];
  const scores: any[] = data.scores ?? [];
  const isVapiBotToBot =
    run.provider === 'vapi' &&
    experiment?.agentConfig &&
    typeof experiment.agentConfig === 'object' &&
    experiment.agentConfig.callMode === 'bot_to_bot_phone';

  const mosScore = scores.find((s) => s.metricName === 'mos');
  const criterionScores = scores.filter((s) => s.metricName !== 'mos');
  const suggestion = criterionScores.find((s) => s.rationale)?.rationale;

  const importReplay = async () => {
    if (!importTranscript.trim() && !importAudioUrl.trim()) {
      setImportError('Add a transcript or recording URL to score this replay.');
      return;
    }

    setImporting(true);
    setImportError('');
    try {
      const response = await fetch(`/api/runs/${runId}/import-recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: importTranscript,
          audioUrl: importAudioUrl,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Replay import failed');
      setData((current: any) => ({
        ...current,
        run: body.run,
        traces: body.traces,
        scores: body.scores,
      }));
      setPolling(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Replay import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/experiments" className="hover:text-gray-700">Experiments</Link>
        <span>/</span>
        <Link href={`/experiments/${id}`} className="hover:text-gray-700">Detail</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Run</span>
      </div>

      <div className="page-header">
        <h1 className="page-title">Run Detail</h1>
        <p className="page-subtitle font-mono text-xs mt-1 text-gray-400">{run.id}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Left: Transcript */}
        <div className="col-span-2 space-y-4">
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-800">Transcript</h2>
              <span className="text-xs text-gray-400">{traces.length} turns</span>
            </div>

            {traces.length === 0 ? (
              <div className="px-5 py-10 text-sm text-gray-400 text-center">
                {polling
                  ? 'Waiting for call to start...'
                  : ['vapi', 'retell', 'elevenlabs'].includes(run.provider)
                    ? run.externalStatus === 'awaiting_recording_import'
                      ? 'Waiting for a recording or transcript import. This is the low-cost replay path for expensive live-call providers.'
                      : isVapiBotToBot
                        ? 'No transcript captured yet. Lightcurve is waiting for Vapi to return bot-to-bot phone turns from the synthetic caller and target agent.'
                        : 'No transcript captured. In human-pilot mode, the tester must speak the selected scenario script while Lightcurve captures the result.'
                    : 'No transcript available.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                {traces.map((t: any) => {
                  const isCaller = t.speaker === 'caller';
                  return (
                    <div key={t.id} className="px-5 py-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-xs font-medium uppercase tracking-wider ${isCaller ? 'text-[#2448bb]' : 'text-gray-500'}`}>
                          {isCaller ? (['vapi', 'retell', 'elevenlabs'].includes(run.provider) ? 'Caller' : 'Caller (Synthetic)') : 'Agent'}
                        </span>
                        <div className="flex items-center gap-2">
                          {t.totalLatencyMs != null && (
                            <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded">
                              {t.totalLatencyMs}ms
                            </span>
                          )}
                          {t.sttConfidence != null && (
                            <span className="text-xs text-gray-400">
                              conf {(t.sttConfidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed">{t.text}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {scenario && (
            <div className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-800">Selected scenario</h3>
                  <p className="mt-1 text-sm font-medium text-gray-900">{scenario.name?.replace(/_/g, ' ')}</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">
                  {scenario.language} / {scenario.domain}
                </span>
              </div>
              {persona.opening_line && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Caller opening line</p>
                  <p className="mt-1 text-sm text-slate-700">"{persona.opening_line}"</p>
                </div>
              )}
              {persona.goal && <p className="mt-3 text-sm leading-relaxed text-slate-600">{persona.goal}</p>}
            </div>
          )}

          {run.externalStatus === 'awaiting_recording_import' && (
            <div className="card p-5">
              <h3 className="text-sm font-medium text-gray-800">Import replay</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                Paste an ElevenLabs transcript or recording URL to score this scenario without placing another paid live call.
              </p>
              <div className="mt-4 space-y-3">
                <textarea
                  className="input-field min-h-[140px]"
                  value={importTranscript}
                  onChange={(event) => setImportTranscript(event.target.value)}
                  placeholder={'Caller: I need help with my refund...\nAgent: I can help with that.'}
                />
                <input
                  className="input-field"
                  value={importAudioUrl}
                  onChange={(event) => setImportAudioUrl(event.target.value)}
                  placeholder="Optional recording URL"
                />
              </div>
              {importError && <p className="mt-3 text-xs text-[#8f3d3b]">{importError}</p>}
              <button type="button" className="btn-primary mt-4" onClick={importReplay} disabled={importing}>
                {importing ? 'Importing...' : 'Import and score'}
              </button>
            </div>
          )}

          {/* Audio Players */}
          {(run.audioCallerUrl || run.audioAgentUrl) && (
            <div className="card p-5 space-y-4">
              <h3 className="text-sm font-medium text-gray-800">Audio recordings</h3>
              {run.audioCallerUrl && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">{run.provider === 'vapi' ? 'Caller / phone channel' : 'Caller (synthetic)'}</label>
                  <audio controls src={run.audioCallerUrl} className="w-full h-10" />
                </div>
              )}
              {run.audioAgentUrl && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Agent</label>
                  <audio controls src={run.audioAgentUrl} className="w-full h-10" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Scores */}
        <div className="space-y-4">
          {/* MOS */}
          <div className="card p-5">
            <div className="text-xs font-medium text-gray-400 mb-1">MOS score</div>
            {mosScore ? (
              <>
                <div className="text-3xl font-medium text-gray-900 mb-3">
                  {mosScore.value.toFixed(1)}
                  <span className="text-base font-normal text-gray-400"> / 5</span>
                </div>
                <ScoreBar value={mosScore.value} max={5} />
                <p className="text-xs text-gray-400 mt-2">LLM-as-judge voice quality proxy</p>
              </>
            ) : (
              <div>
                <div className="text-2xl font-medium text-gray-300">Pending</div>
                <p className="mt-2 text-xs text-gray-400">MOS appears from provider analysis, the MOS service, or Lightcurve's proxy score.</p>
              </div>
            )}
          </div>

          {/* Criteria */}
          {criterionScores.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-medium text-gray-800 mb-4">Evaluation criteria</h3>
              <div className="space-y-4">
                {criterionScores.map((s: any) => (
                  <div key={s.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600 capitalize">
                        {s.metricName.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <ScoreBar value={s.value} />
                    {s.rationale && (
                      <p className="text-xs text-gray-400 mt-1 leading-snug">{s.rationale}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggestion callout */}
          {suggestion && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <svg className="w-4 h-4 text-[#8a6a20]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-medium text-slate-700">Judge suggestion</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{suggestion}</p>
            </div>
          )}

          {run.failureSummary && (
            <div className="rounded-lg border border-[#e3c3c1] bg-[#fbf3f2] p-4">
              <div className="text-xs font-medium text-[#8f3d3b]">Failure reason</div>
              <p className="mt-1 text-xs leading-relaxed text-[#8f3d3b]">{run.failureSummary}</p>
            </div>
          )}

          {/* Run metadata */}
          <div className="card p-5">
            <h3 className="text-sm font-medium text-gray-800 mb-3">Run info</h3>
            <div className="space-y-2 text-xs">
              {[
                { label: 'Status', val: run.status },
                { label: 'Provider', val: run.provider ?? 'synthetic' },
                { label: 'External status', val: run.externalStatus ?? '-' },
                { label: 'Turns', val: run.turnCount ?? '-' },
                { label: 'Duration', val: run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '-' },
              ].map((item) => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-gray-400">{item.label}</span>
                  <span className="font-medium text-gray-700 capitalize">{item.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
