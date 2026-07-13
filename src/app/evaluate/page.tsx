'use client';

import { useEffect, useMemo, useState } from 'react';
import { INTERACTION_ATTRIBUTES, PARTICIPANT_ATTRIBUTES, TEMPORAL_ATTRIBUTES } from '@/lib/modelOrbitRubric';
import type { ModelOrbitEvaluation, ModelOrbitObservation } from '@/lib/modelOrbit';

type RunOption = { id: string; caseName?: string; agent?: string; date?: string; status?: string };
type OrbitResponse = {
  run: { id: string; name: string; experiment: string; status: string };
  evaluation: ModelOrbitEvaluation;
  storedAt?: string;
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function metricValue(observation: ModelOrbitObservation | undefined) {
  if (!observation || observation.value == null) return 'No evidence';
  if (observation.unit === 'milliseconds') return `${Math.round(observation.value)} ms`;
  if (observation.unit === 'words_per_minute') return `${Math.round(observation.value)} wpm`;
  if (observation.unit === 'ratio_0_1') return percent(observation.value);
  return observation.value.toFixed(2);
}

function ConfidenceBadge({ observation }: { observation?: ModelOrbitObservation }) {
  if (!observation?.value && observation?.value !== 0) return <span className="text-xs text-slate-400">unmeasured</span>;
  const tone = observation.confidence >= 0.75
    ? 'bg-emerald-50 text-emerald-700'
    : observation.confidence >= 0.5
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600';
  const label = observation.confidence >= 0.75 ? 'High' : observation.confidence >= 0.5 ? 'Medium' : 'Limited';
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${tone}`}>{label} confidence | {percent(observation.confidence)}</span>;
}

function AttributeRow({ label, observation, color }: { label: string; observation?: ModelOrbitObservation; color: string }) {
  const intensity = observation?.unit === 'intensity_0_4' && observation.value != null ? observation.value / 4 : 0;
  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-slate-950">{metricValue(observation)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${color}`} style={{ width: `${intensity * 100}%` }} /></div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ConfidenceBadge observation={observation} />
        <span className="text-[11px] text-slate-400">{observation?.disagreement == null ? 'More review needed' : observation.disagreement < 0.35 ? 'Checks closely aligned' : 'Checks vary'}</span>
      </div>
    </div>
  );
}

function Timeline({ evaluation, metricId }: { evaluation: ModelOrbitEvaluation; metricId: string }) {
  const points = evaluation.nodes.flatMap((node, index) => {
    const observation = node.attributes[metricId];
    return observation?.value == null ? [] : [{ node, index, value: observation.value }];
  });
  const width = 760;
  const height = 190;
  const x = (index: number) => evaluation.nodes.length <= 1 ? width / 2 : 38 + index * (width - 76) / (evaluation.nodes.length - 1);
  const y = (value: number) => 18 + (4 - value) * (height - 52) / 4;
  const pathFor = (speaker: 'human' | 'agent') => points.filter((point) => point.node.speaker === speaker).map((point, index) => `${index ? 'L' : 'M'} ${x(point.index)} ${y(point.value)}`).join(' ');
  if (!points.length) return <div className="flex h-44 items-center justify-center text-sm text-slate-500">No evidence for this attribute.</div>;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[620px] w-full" role="img" aria-label="Behavior changes across conversation turns">
        {[0, 1, 2, 3, 4].map((value) => <g key={value}><line x1="38" x2={width - 38} y1={y(value)} y2={y(value)} stroke="#e2e8f0" /><text x="12" y={y(value) + 4} fill="#64748b" fontSize="11">{value}</text></g>)}
        <path d={pathFor('human')} fill="none" stroke="#2f5ae0" strokeWidth="2.5" />
        <path d={pathFor('agent')} fill="none" stroke="#0f766e" strokeWidth="2.5" />
        {points.map((point) => <g key={point.node.id}><circle cx={x(point.index)} cy={y(point.value)} r="5" fill={point.node.speaker === 'human' ? '#2f5ae0' : '#0f766e'} /><text x={x(point.index)} y={height - 8} textAnchor="middle" fill="#64748b" fontSize="10">{point.index + 1}</text></g>)}
      </svg>
      <div className="flex justify-center gap-5 text-xs text-slate-500"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2f5ae0]" />Human</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-teal-700" />Agent</span></div>
    </div>
  );
}

export default function EvaluatePage() {
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [runId, setRunId] = useState('');
  const [data, setData] = useState<OrbitResponse | null>(null);
  const [metricId, setMetricId] = useState('politeness');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/runs', { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Calls could not be loaded.');
      const options = (Array.isArray(body.runs) ? body.runs : []) as RunOption[];
      setRuns(options);
      setRunId((current) => current || options[0]?.id || '');
      if (!options.length) setLoading(false);
    }).catch((reason) => { setError(reason instanceof Error ? reason.message : 'Calls could not be loaded.'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    setError('');
    fetch(`/api/evaluate?runId=${encodeURIComponent(runId)}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'This call could not be reviewed.');
      setData(body as OrbitResponse);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'This call could not be reviewed.')).finally(() => setLoading(false));
  }, [runId]);

  const selectedAttribute = useMemo(() => PARTICIPANT_ATTRIBUTES.find((attribute) => attribute.id === metricId), [metricId]);

  async function refreshEvaluation() {
    if (!runId) return;
    setRefreshing(true);
    setError('');
    try {
      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'The call could not be reviewed again.');
      setData(body as OrbitResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The call could not be reviewed again.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Evaluate</h1>
        <p className="page-subtitle">See how callers and your voice agent behaved throughout each call.</p>
      </div>
      <div className="flex flex-col items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
        <label className="w-full max-w-xl text-sm text-slate-600">Choose a call
          <select className="input-field mt-1 w-full" value={runId} onChange={(event) => setRunId(event.target.value)}>
            {runs.map((run) => <option key={run.id} value={run.id}>{run.caseName || run.id}{run.agent ? ` | ${run.agent}` : ''}{run.date ? ` | ${run.date}` : ''}</option>)}
          </select>
        </label>
        <button type="button" className="btn-secondary" disabled={!runId || refreshing} onClick={() => void refreshEvaluation()}>{refreshing ? 'Reviewing...' : 'Review again'}</button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!runId && !loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Run a voice test or capture a call to see the first evaluation.</div>}
      {loading && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Reviewing this call...</div>}

      {data && !loading && (
        <>
          <section className="rounded-lg border border-slate-200 bg-white px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">{data.run.name}</h2><p className="mt-1 text-sm text-slate-500">{data.run.experiment}</p></div><span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">Initial review</span></div>
            <p className="mt-3 text-xs leading-5 text-slate-500">These numbers describe what happened in the call. A higher number is not automatically better or worse.</p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['Conversation moments', String(data.evaluation.summary.sourceNodeCount)],
              ['Call coverage', percent(data.evaluation.summary.evidenceCoverage)],
              ['Overall confidence', percent(data.evaluation.summary.averageConfidence)],
              ['Review consistency', data.evaluation.summary.averageDisagreement == null ? 'Pending' : data.evaluation.summary.averageDisagreement < 0.35 ? 'Close' : 'Mixed'],
            ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{value}</p></div>)}
          </div>

          <section>
            <div className="mb-3"><h2 className="text-lg font-semibold text-slate-950">How each person sounded</h2><p className="mt-1 text-sm text-slate-500">The caller and your agent are reviewed separately.</p></div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-[#cfd8ff] bg-white"><div className="border-b border-[#e2e7ff] px-5 py-4"><p className="font-semibold text-slate-950">Human caller</p><p className="mt-1 text-xs text-slate-500">{data.evaluation.profiles.human.turnCount} call moments</p></div><div className="px-5">{PARTICIPANT_ATTRIBUTES.map((attribute) => <AttributeRow key={attribute.id} label={attribute.label} observation={data.evaluation.profiles.human.attributes[attribute.id]} color="bg-[#2f5ae0]" />)}</div></div>
              <div className="rounded-lg border border-teal-200 bg-white"><div className="border-b border-teal-100 px-5 py-4"><p className="font-semibold text-slate-950">Your agent</p><p className="mt-1 text-xs text-slate-500">{data.evaluation.profiles.agent.turnCount} call moments</p></div><div className="px-5">{PARTICIPANT_ATTRIBUTES.map((attribute) => <AttributeRow key={attribute.id} label={attribute.label} observation={data.evaluation.profiles.agent.attributes[attribute.id]} color="bg-teal-700" />)}</div></div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-lg font-semibold text-slate-950">How the call changed</h2><p className="mt-1 text-sm text-slate-500">Follow each behavior from one moment to the next.</p></div><label className="text-xs text-slate-500">Show<select className="input-field mt-1 min-w-52" value={metricId} onChange={(event) => setMetricId(event.target.value)}>{PARTICIPANT_ATTRIBUTES.map((attribute) => <option key={attribute.id} value={attribute.id}>{attribute.label}</option>)}</select></label></div>
            <div className="mt-5"><Timeline evaluation={data.evaluation} metricId={metricId} /></div>
            {selectedAttribute && <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500"><strong className="text-slate-700">What this means:</strong> {selectedAttribute.definition}</p>}
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-950">Call flow</h2><div className="mt-3 divide-y divide-slate-100">{TEMPORAL_ATTRIBUTES.map((attribute) => { const observation = data.evaluation.temporal[attribute.id]; return <div key={attribute.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm text-slate-700">{attribute.label}</p><ConfidenceBadge observation={observation} /></div><p className="text-sm font-semibold tabular-nums text-slate-950">{metricValue(observation)}</p></div>; })}</div></section>
            <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-950">Conversation flow</h2><div className="mt-3 divide-y divide-slate-100">{INTERACTION_ATTRIBUTES.map((attribute) => { const observation = data.evaluation.interaction[attribute.id]; return <div key={attribute.id} className="flex items-center justify-between gap-4 py-3"><div><p className="text-sm text-slate-700">{attribute.label}</p><ConfidenceBadge observation={observation} /></div><p className="text-sm font-semibold tabular-nums text-slate-950">{metricValue(observation)}</p></div>; })}</div></section>
          </div>

          {(data.evaluation.voice.human || data.evaluation.voice.agent) && <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-950">Voice patterns</h2><p className="mt-1 text-sm text-slate-500">Measured directly from each side of the call.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{(['human', 'agent'] as const).map((speaker) => { const voice = data.evaluation.voice[speaker]; return <div key={speaker} className="rounded-lg border border-slate-200 p-4"><p className="font-medium text-slate-900">{speaker === 'human' ? 'Human caller' : 'Your agent'}</p>{voice ? <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Call length</p><p className="mt-1 font-semibold">{Math.round(voice.durationMs / 1000)} sec</p></div><div><p className="text-xs text-slate-500">Time paused</p><p className="mt-1 font-semibold">{percent(voice.pauseRatio)}</p></div><div><p className="text-xs text-slate-500">Voice movement</p><p className="mt-1 font-semibold">{voice.pitchRangeHz == null ? 'Unavailable' : `${Math.round(voice.pitchRangeHz)} Hz`}</p></div><div><p className="text-xs text-slate-500">Result confidence</p><p className="mt-1 font-semibold">{percent(voice.confidence)}</p></div></div> : <p className="mt-3 text-sm text-slate-500">Voice measurements are unavailable.</p>}</div>; })}</div></section>}

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-semibold text-slate-950">Moments behind the results</h2><p className="mt-1 text-sm text-slate-500">Open the conversation moments that shaped each result.</p></div>
            <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3 font-medium">Moment</th><th className="px-4 py-3 font-medium">Who</th><th className="px-4 py-3 font-medium">What was said</th><th className="px-4 py-3 font-medium">{selectedAttribute?.label}</th><th className="px-5 py-3 font-medium">Confidence</th></tr></thead><tbody className="divide-y divide-slate-100">{data.evaluation.nodes.map((node) => { const observation = node.attributes[metricId]; return <tr key={node.id} className="align-top"><td className="px-5 py-4 text-xs font-medium text-slate-500">{node.turnIndex + 1}</td><td className="px-4 py-4 capitalize text-slate-700">{node.speaker === 'agent' ? 'Agent' : 'Caller'}</td><td className="max-w-xl px-4 py-4"><p className="line-clamp-2 text-slate-700">{node.text}</p><p className="mt-1 text-xs text-slate-400">{observation?.evidence.join(' | ') || 'No matching signals'}</p></td><td className="px-4 py-4 font-semibold tabular-nums text-slate-950">{metricValue(observation)}</td><td className="px-5 py-4"><ConfidenceBadge observation={observation} /></td></tr>; })}</tbody></table></div>
          </section>

          <section className="rounded-lg border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">What to keep in mind</h2><ul className="mt-2 space-y-1 text-sm leading-6 text-amber-900">{data.evaluation.summary.limitations.map((limitation) => <li key={limitation}>- {limitation}</li>)}</ul></section>
        </>
      )}
    </div>
  );
}
