'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { buildPronunciationReport } from '@/lib/pronunciation';

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

function formatUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '$0.0000';
  return `$${value.toFixed(4)}`;
}

function auditBadgeClass(status: string) {
  if (status === 'detected') return 'border-[#b7e0d0] bg-[#effaf5] text-[#2f6f5f]';
  if (status === 'proxy') return 'border-[#ead7a7] bg-[#fff9e8] text-[#8a6a20]';
  if (status === 'external') return 'border-[#cfd8ff] bg-[#f8faff] text-[#2448bb]';
  if (status === 'pending') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-slate-200 bg-white text-slate-400';
}

export default function RunDetail() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [data, setData] = useState<any>(null);
  const [polling, setPolling] = useState(true);
  const [importTranscript, setImportTranscript] = useState('');
  const [importAudioUrl, setImportAudioUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [liveKitSession, setLiveKitSession] = useState<any>(null);
  const [liveKitError, setLiveKitError] = useState('');
  const [copiedJoinValue, setCopiedJoinValue] = useState('');
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);

  useEffect(() => {
    const load = () => {
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

  useEffect(() => {
    if (!data?.run || data.run.provider !== 'livekit' || data.run.externalStatus !== 'livekit_room_ready') return;
    let cancelled = false;
    fetch(`/api/runs/${runId}/livekit-session`, { cache: 'no-store' })
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setLiveKitError(body.error ?? 'LiveKit session unavailable');
          return;
        }
        setLiveKitSession(body);
        setLiveKitError('');
      })
      .catch(() => {
        if (!cancelled) setLiveKitError('LiveKit session unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [data?.run?.id, data?.run?.provider, data?.run?.externalStatus, runId]);

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
  const experimentConfig: any =
    experiment?.agentConfig && typeof experiment.agentConfig === 'object'
      ? experiment.agentConfig
      : {};
  const pronunciationSource = scenario?.pronunciation ?? experimentConfig.pronunciation ?? null;
  const traces: any[] = data.traces ?? [];
  const scores: any[] = data.scores ?? [];
  const resourceAudit = data.resourceAudit;
  const pronunciationReport = pronunciationSource
    ? buildPronunciationReport(pronunciationSource, traces)
    : null;
  const isVapiBotToBot =
    run.provider === 'vapi' &&
    experimentConfig.callMode === 'bot_to_bot_phone';

  const mosScore = scores.find((s) => s.metricName === 'mos');
  const pronunciationMetricNames = new Set([
    'capture_exact_match',
    'capture_confirmation',
    'capture_integrity',
    'capture_correction',
    'pace_stability',
    'capture_overall',
  ]);
  const criterionScores = scores.filter((s) => s.metricName !== 'mos' && !pronunciationMetricNames.has(s.metricName));
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

  const copyJoinValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedJoinValue(label);
      window.setTimeout(() => setCopiedJoinValue(''), 1400);
    } catch {
      setCopiedJoinValue('');
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
                  : run.provider === 'livekit' && run.externalStatus === 'livekit_room_ready'
                    ? 'Lightcurve room is ready. Waiting for the customer agent and synthetic caller to join before transcript scoring begins.'
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

          {run.provider === 'livekit' && run.externalStatus === 'livekit_room_ready' && (
            <>
              <div className="card p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-medium text-gray-900">Lightcurve room ready</h2>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Room details are ready. Open the connection modal when your agent is ready to join.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary min-h-9 px-4 py-2 text-sm"
                    onClick={() => setConnectionModalOpen(true)}
                  >
                    Connect agent
                  </button>
                </div>
                {liveKitError && (
                  <div className="mt-3 rounded-lg border border-[#e3c3c1] bg-[#fbf3f2] p-3 text-xs leading-relaxed text-[#8f3d3b]">
                    {liveKitError}
                  </div>
                )}
              </div>

              {connectionModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm">
                  <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                      <div>
                        <h2 className="text-base font-medium text-slate-950">Connect agent to Lightcurve room</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          Paste these one-time details into your agent runtime. Lightcurve joins as the caller and judge.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                        onClick={() => setConnectionModalOpen(false)}
                      >
                        Close
                      </button>
                    </div>

                    <div className="max-h-[72vh] space-y-4 overflow-auto p-5">
                      {liveKitError ? (
                        <div className="rounded-lg border border-[#e3c3c1] bg-[#fbf3f2] p-3 text-xs leading-relaxed text-[#8f3d3b]">
                          {liveKitError}
                        </div>
                      ) : liveKitSession ? (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Room URL</p>
                                <button
                                  type="button"
                                  onClick={() => copyJoinValue('room-url', liveKitSession.liveKitUrl)}
                                  className="text-xs text-[#2448bb]"
                                >
                                  {copiedJoinValue === 'room-url' ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <p className="mt-2 break-all font-mono text-xs text-slate-800">{liveKitSession.liveKitUrl}</p>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Room</p>
                                <button
                                  type="button"
                                  onClick={() => copyJoinValue('room-name', liveKitSession.roomName)}
                                  className="text-xs text-[#2448bb]"
                                >
                                  {copiedJoinValue === 'room-name' ? 'Copied' : 'Copy'}
                                </button>
                              </div>
                              <p className="mt-2 break-all font-mono text-xs text-slate-800">{liveKitSession.roomName}</p>
                            </div>
                          </div>
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <label className="block text-xs font-medium text-slate-600">Agent join token</label>
                              <button
                                type="button"
                                onClick={() => copyJoinValue('agent-token', liveKitSession.agentToken)}
                                className="text-xs text-[#2448bb]"
                              >
                                {copiedJoinValue === 'agent-token' ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <textarea
                              className="input-field min-h-24 font-mono text-xs"
                              readOnly
                              value={liveKitSession.agentToken}
                            />
                            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                              Token is short-lived and scoped to this room. Refresh this page if the agent connects after it expires.
                            </p>
                          </div>
                          <div className="rounded-lg border border-[#cfd8ff] bg-[#f8faff] p-3 text-xs leading-relaxed text-[#526894]">
                            {liveKitSession.instructions}
                          </div>
                          {Array.isArray(liveKitSession.joinOptions) && (
                            <div className="space-y-3">
                              <h3 className="text-sm font-medium text-gray-800">Choose your agent runtime</h3>
                              {liveKitSession.joinOptions.map((option: any) => (
                                <details key={option.id} className="rounded-lg border border-slate-200 bg-white p-3">
                                  <summary className="cursor-pointer text-sm font-medium text-slate-900">
                                    {option.label}
                                    <span className="ml-2 text-xs font-normal text-slate-400">{option.summary}</span>
                                  </summary>
                                  <div className="mt-3 grid gap-3">
                                    <div className="grid gap-1.5 text-xs leading-relaxed text-slate-500">
                                      {(option.steps ?? []).map((step: string, index: number) => (
                                        <p key={`${option.id}-${index}`}>{step}</p>
                                      ))}
                                    </div>
                                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                                      <div className="mb-2 flex items-center justify-between gap-2">
                                        <span className="text-xs font-medium text-slate-500">Copy-ready setup</span>
                                        <button
                                          type="button"
                                          onClick={() => copyJoinValue(option.id, option.code)}
                                          className="text-xs text-[#2448bb]"
                                        >
                                          {copiedJoinValue === option.id ? 'Copied' : 'Copy'}
                                        </button>
                                      </div>
                                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-800">
                                        {option.code}
                                      </pre>
                                    </div>
                                  </div>
                                </details>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                          Preparing Lightcurve room details...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                )}
            </>
          )}

          {pronunciationReport && (
            <div className="card overflow-hidden">
              <div className="border-b border-gray-100 px-5 py-3.5">
                <h2 className="text-sm font-medium text-gray-800">Capture Accuracy</h2>
                <p className="mt-1 text-xs text-gray-400">
                  {pronunciationReport.entityType === 'email' ? 'Email' : 'Phone number'} readback and pacing check
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 p-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Expected</p>
                  <p className="mt-2 break-all font-mono text-sm text-slate-900">{pronunciationReport.expectedValue}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Captured</p>
                  <p className="mt-2 break-all font-mono text-sm text-slate-900">{pronunciationReport.capturedValue ?? 'Not found'}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pacing drift</p>
                  <p className="mt-2 text-sm text-slate-900">{pronunciationReport.pacing.driftPercent}% during readback</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-gray-100 p-5">
                {pronunciationReport.segments.map((segment) => (
                  <div key={segment.label}>
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-gray-600">{segment.label}</span>
                      <span className={`text-xs ${segment.pass ? 'text-[#2f6f5f]' : 'text-[#8f3d3b]'}`}>{segment.pass ? 'Pass' : 'Fail'}</span>
                    </div>
                    <ScoreBar value={segment.value} />
                    <p className="mt-1 text-xs leading-snug text-gray-400">{segment.rationale}</p>
                  </div>
                ))}
              </div>
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

          {resourceAudit && (
            <div className="card overflow-hidden">
              <div className="border-b border-gray-100 px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-gray-800">Resource audit</h3>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${resourceAudit.billable ? 'border-[#b7e0d0] bg-[#effaf5] text-[#2f6f5f]' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                    {resourceAudit.billable ? 'Billable' : 'Not billable'}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">{resourceAudit.verdict}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 p-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-400">Tested minutes</p>
                  <p className="mt-1 text-lg font-medium text-slate-950">{resourceAudit.testedMinutes.toFixed(2)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-400">Est. Lightcurve cost</p>
                  <p className="mt-1 text-lg font-medium text-slate-950">{formatUsd(resourceAudit.estimatedLightcurveCostUsd)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-400">Provider spend</p>
                  <p className="mt-1 text-lg font-medium capitalize text-slate-950">
                    {resourceAudit.providerSpend === 'possible' ? 'Possible' : resourceAudit.providerSpend}
                  </p>
                </div>
              </div>
              <div className="space-y-2 border-t border-gray-100 p-5 pt-0">
                {(resourceAudit.resources ?? []).map((resource: any) => (
                  <div key={resource.label} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-slate-700">{resource.label}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${auditBadgeClass(resource.status)}`}>
                        {resource.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{resource.detail}</p>
                    {resource.estimatedCostUsd ? (
                      <p className="mt-1 text-xs text-slate-400">Estimated: {formatUsd(resource.estimatedCostUsd)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Run metadata */}
          <div className="card p-5">
            <h3 className="text-sm font-medium text-gray-800 mb-3">Run info</h3>
            <div className="space-y-2 text-xs">
              {[
                { label: 'Status', val: run.status },
                { label: 'Provider', val: run.provider ?? '-' },
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
