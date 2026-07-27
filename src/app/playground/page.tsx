'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SUPPORTED_CASE_LANGUAGES } from '@/lib/constants';

type Runtime = {
  id: string;
  name: string;
  framework: string;
  version?: string | null;
  gitSha?: string | null;
  status: 'online' | 'offline';
};

type Capture = {
  id: string;
  status: string;
  transcript?: Array<{ speaker: string; text: string }>;
};

type LiveKitConfig = {
  id?: string;
  customerEmail: string;
  customerName: string;
  runtimeName: string;
  serverUrl: string;
  roomName: string;
  agentIdentity: string;
  agentName: string;
  participantMetadata: string;
  lightcurveLiveKit?: { url: string; configured: boolean };
};

type ReadinessCheck = { name: string; ok: boolean; detail?: unknown; error?: string };
type Readiness = { ok: boolean; checkedAt: string; checks: ReadinessCheck[] };
type LiveKitSession = {
  capture: Capture;
  completeUrl: string;
  room: { url: string; name: string };
  caller: { identity: string; token: string };
  agent: { identity: string; name: string; token: string; workerToken?: string; metadata: string };
};

const defaultLiveKitConfig: LiveKitConfig = {
  customerEmail: 'shivam@kolsetu.com',
  customerName: 'Kolsetu',
  runtimeName: 'Kolsetu LiveKit agent',
  serverUrl: '',
  roomName: 'lightcurve-kolsetu-shivam',
  agentIdentity: 'kolsetu-agent',
  agentName: 'Kolsetu agent',
  participantMetadata: '',
};

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const listener = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', listener);
        resolve();
      }
    };
    peer.addEventListener('icegatheringstatechange', listener);
    window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', listener);
      resolve();
    }, 5000);
  });
}

export default function PlaygroundPage() {
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [runtimeId, setRuntimeId] = useState('');
  const [loadingRuntimes, setLoadingRuntimes] = useState(true);
  const [state, setState] = useState<'idle' | 'connecting' | 'live' | 'review' | 'saved'>('idle');
  const [capture, setCapture] = useState<Capture | null>(null);
  const [caseName, setCaseName] = useState('');
  const [caseLanguage, setCaseLanguage] = useState('en-US');
  const [voiceCloneConsent, setVoiceCloneConsent] = useState(false);
  const [savedDatasetId, setSavedDatasetId] = useState('');
  const [error, setError] = useState('');
  const [liveKitAllowed, setLiveKitAllowed] = useState(false);
  const [liveKitOpen, setLiveKitOpen] = useState(false);
  const [liveKitConfig, setLiveKitConfig] = useState<LiveKitConfig>(defaultLiveKitConfig);
  const [savingLiveKit, setSavingLiveKit] = useState(false);
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [liveKitNotice, setLiveKitNotice] = useState('');
  const [creatingLiveKitSession, setCreatingLiveKitSession] = useState(false);
  const [liveKitSession, setLiveKitSession] = useState<LiveKitSession | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const loadRuntimes = useCallback(async () => {
    try {
      const response = await fetch('/api/runtimes', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Agent runtimes could not be loaded.');
      const loaded = (Array.isArray(body.runtimes) ? body.runtimes : []) as Runtime[];
      setRuntimes(loaded);
      const capturable = loaded.filter((runtime) => runtime.framework !== 'livekit');
      const firstOnline = capturable.find((runtime) => runtime.status === 'online');
      setRuntimeId((current) => {
        if (current && capturable.some((runtime) => runtime.id === current)) return current;
        return firstOnline?.id || capturable[0]?.id || '';
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent runtimes could not be loaded.');
    } finally {
      setLoadingRuntimes(false);
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void loadRuntimes(), 0);
    const timer = window.setInterval(() => void loadRuntimes(), 5000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(timer);
    };
  }, [loadRuntimes]);

  useEffect(() => {
    fetch('/api/integrations/livekit', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body) => {
        setLiveKitAllowed(Boolean(body.eligible));
        if (body.eligible && body.config) setLiveKitConfig((current) => ({ ...current, ...body.config }));
        if (body.eligible) void checkReadiness();
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => () => {
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function startCall() {
    setError('');
    setState('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const captureResponse = await fetch('/api/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeId: runtimeId || undefined }),
      });
      const captureBody = await captureResponse.json().catch(() => ({}));
      if (!captureResponse.ok) throw new Error(captureBody.error ?? 'Call could not be created.');
      const created = captureBody.capture as Capture;
      setCapture(created);
      if (typeof MediaRecorder !== 'undefined') {
        const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType: preferredType });
        recordedChunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) recordedChunksRef.current.push(event.data);
        };
        recorder.start(1000);
        recorderRef.current = recorder;
      }

      const signalState = await fetch(`/api/captures/${created.id}/signal`, { cache: 'no-store' }).then((response) => response.json());
      const peer = new RTCPeerConnection({ iceServers: Array.isArray(signalState.iceServers) ? signalState.iceServers : [] });
      peerRef.current = peer;
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (!remoteAudioRef.current) return;
        remoteAudioRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void remoteAudioRef.current.play().catch(() => undefined);
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setState('live');
        if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
          setError('The live audio connection ended unexpectedly.');
        }
      };

      const offer = await peer.createOffer({ offerToReceiveAudio: true });
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const offerResponse = await fetch(`/api/captures/${created.id}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer: peer.localDescription }),
      });
      const offerBody = await offerResponse.json().catch(() => ({}));
      if (!offerResponse.ok) throw new Error(offerBody.error ?? 'Audio signaling failed.');

      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const response = await fetch(`/api/captures/${created.id}/signal`, { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (body.answer?.type === 'answer' && typeof body.answer.sdp === 'string') {
          await peer.setRemoteDescription(body.answer);
          return;
        }
      }
      throw new Error('The agent runtime did not answer the call in time.');
    } catch (reason) {
      peerRef.current?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      peerRef.current = null;
      streamRef.current = null;
      setState('idle');
      setError(reason instanceof Error ? reason.message : 'Call could not be started.');
    }
  }

  async function endCall() {
    if (!capture) return;
    const recordedAudio = await new Promise<Blob | null>((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(recordedChunksRef.current.length ? new Blob(recordedChunksRef.current, { type: recorder?.mimeType || 'audio/webm' }) : null);
        return;
      }
      recorder.onstop = () => resolve(new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      recorder.stop();
    });
    recorderRef.current = null;
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current = null;
    streamRef.current = null;
    if (recordedAudio?.size) {
      const form = new FormData();
      form.append('audio', recordedAudio, 'human.webm');
      const upload = await fetch(`/api/captures/${capture.id}/audio`, { method: 'POST', body: form });
      if (!upload.ok) setError('The call ended, but the human audio recording could not be stored.');
    }
    await fetch(`/api/captures/${capture.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'complete' }),
    });
    const refreshed = await fetch(`/api/captures/${capture.id}`, { cache: 'no-store' }).then((response) => response.json());
    setCapture(refreshed.capture ?? capture);
    setCaseName(`Human call ${new Date().toLocaleDateString()}`);
    setState('review');
  }

  async function approveCase() {
    if (!capture) return;
    setError('');
    try {
      const response = await fetch(`/api/captures/${capture.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: caseName, language: caseLanguage, voiceCloneConsent }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Case could not be saved.');
      setSavedDatasetId(body.dataset.id);
      setState('saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Case could not be saved.');
    }
  }

  function updateLiveKitConfig<K extends keyof LiveKitConfig>(key: K, value: LiveKitConfig[K]) {
    setLiveKitConfig((current) => ({ ...current, [key]: value }));
  }

  async function saveLiveKitConfig(event: React.FormEvent) {
    event.preventDefault();
    setSavingLiveKit(true);
    setLiveKitNotice('');
    setError('');
    try {
      const response = await fetch('/api/integrations/livekit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(liveKitConfig),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'LiveKit configuration could not be saved.');
      setLiveKitConfig((current) => ({ ...current, ...body.config }));
      setLiveKitNotice('Kolsetu agent details saved. Simulated-call tests can now use this runtime.');
      setLiveKitSession(null);
      await loadRuntimes();
      await checkReadiness();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'LiveKit configuration could not be saved.');
    } finally {
      setSavingLiveKit(false);
    }
  }

  async function checkReadiness() {
    setCheckingReadiness(true);
    setLiveKitNotice('');
    try {
      const response = await fetch('/api/integrations/livekit/readiness', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Readiness could not be checked.');
      setReadiness(body as Readiness);
    } catch {
      setReadiness(null);
    } finally {
      setCheckingReadiness(false);
    }
  }

  async function createLiveKitSession() {
    setCreatingLiveKitSession(true);
    setLiveKitNotice('');
    setError('');
    try {
      const response = await fetch('/api/integrations/livekit/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: liveKitConfig.roomName, purpose: 'kolsetu_manual_connection_test' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'LiveKit room could not be created.');
      setLiveKitSession(body as LiveKitSession);
      setLiveKitNotice('LiveKit room created. Shivam can connect the Kolsetu agent with the details shown in the popup.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'LiveKit room could not be created.');
    } finally {
      setCreatingLiveKitSession(false);
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
  }

  const captureRuntimes = runtimes.filter((runtime) => runtime.framework !== 'livekit');
  const liveKitRuntimes = runtimes.filter((runtime) => runtime.framework === 'livekit');
  const online = captureRuntimes.filter((runtime) => runtime.status === 'online');

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Playground</h1>
          <p className="page-subtitle">Talk to your agent to test it and save the recording as a test case.</p>
        </div>
        {liveKitAllowed ? (
          <button type="button" className="btn-secondary" onClick={() => { setLiveKitOpen(true); void checkReadiness(); }}>
            Kolsetu LiveKit
          </button>
        ) : null}
      </div>

      <audio ref={remoteAudioRef} autoPlay />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">{error}</div>}
      {liveKitNotice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm">{liveKitNotice}</div>}

      {liveKitOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm" onClick={() => setLiveKitOpen(false)}>
          <form onSubmit={saveLiveKitConfig} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Kolsetu simulated-call setup</h2>
                <p className="mt-1 text-sm text-slate-500">Paste the Kolsetu agent details here. Lightcurve handles LiveKit rooms, Czech caller voice, evaluation, and suggested fixes.</p>
              </div>
              <button type="button" className="btn-quiet px-2" onClick={() => setLiveKitOpen(false)} aria-label="Close LiveKit configuration">x</button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-slate-600">Runtime name in Lightcurve
                <input className="input-field mt-2" value={liveKitConfig.runtimeName} onChange={(event) => updateLiveKitConfig('runtimeName', event.target.value)} placeholder="Kolsetu LiveKit agent" required />
              </label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                <p className="font-medium text-slate-900">Lightcurve LiveKit project</p>
                <p className="mt-1 break-all font-mono text-xs">{liveKitConfig.lightcurveLiveKit?.url || liveKitConfig.serverUrl || 'Configured by Lightcurve'}</p>
              </div>
              <label className="block text-sm text-slate-600">Base room prefix
                <input className="input-field mt-2" value={liveKitConfig.roomName} onChange={(event) => updateLiveKitConfig('roomName', event.target.value)} placeholder="lightcurve-kolsetu-shivam" required />
              </label>
              <label className="block text-sm text-slate-600">Kolsetu agent identity
                <input className="input-field mt-2" value={liveKitConfig.agentIdentity} onChange={(event) => updateLiveKitConfig('agentIdentity', event.target.value)} placeholder="Exact identity used by their LiveKit agent" required />
              </label>
              <label className="block text-sm text-slate-600">Agent display name
                <input className="input-field mt-2" value={liveKitConfig.agentName} onChange={(event) => updateLiveKitConfig('agentName', event.target.value)} placeholder="Kolsetu agent" />
              </label>
              <label className="block text-sm text-slate-600 sm:col-span-2">Participant metadata
                <textarea className="input-field mt-2 min-h-24 resize-y" value={liveKitConfig.participantMetadata} onChange={(event) => updateLiveKitConfig('participantMetadata', event.target.value)} placeholder='{"tenant":"kolsetu","contact":"shivam@kolsetu.com"}' />
              </label>
            </div>

            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {liveKitConfig.lightcurveLiveKit?.configured
                ? 'Shivam should paste his agent identity/name here. Their agent code must join rooms using the same identity. Lightcurve creates per-test rooms and tokens under the hood.'
                : 'Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on Lightcurve before creating Kolsetu rooms.'}
            </div>
            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">Connect Kolsetu through LiveKit</p>
                  <p className="mt-1 text-blue-800">Save the agent identity first, then create a room. Use the worker token for livekit.agents /agent connections.</p>
                </div>
                <button type="button" className="btn-primary shrink-0" disabled={creatingLiveKitSession} onClick={() => void createLiveKitSession()}>
                  {creatingLiveKitSession ? 'Creating...' : 'Create test room'}
                </button>
              </div>
              {liveKitSession ? (
                <div className="mt-4 grid gap-3">
                  {[
                    ['LiveKit URL', liveKitSession.room.url],
                    ['Room name', liveKitSession.room.name],
                    ['Lightcurve capture ID', liveKitSession.capture.id],
                    ['Save recording URL', liveKitSession.completeUrl],
                    ['Agent identity', liveKitSession.agent.identity],
                    ['Agent display name', liveKitSession.agent.name],
                    ['Participant metadata', liveKitSession.agent.metadata],
                    ...(liveKitSession.agent.workerToken ? [['LiveKit Agents worker token', liveKitSession.agent.workerToken]] : []),
                    ['Room participant token', liveKitSession.agent.token],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-blue-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-slate-900">{label}</p>
                        <button type="button" className="btn-secondary py-1 text-xs" onClick={() => void copyText(value)}>Copy</button>
                      </div>
                      <p className="mt-2 break-all font-mono text-xs text-slate-700">{value}</p>
                    </div>
                  ))}
                  <p className="text-xs leading-5 text-blue-800">After the connected LiveKit call ends, post the transcript and optional caller/agent audio to the save recording URL. Lightcurve will add it to Audio Library for automated eval.</p>
                </div>
              ) : null}
            </div>
            <div className={`mt-5 rounded-lg border p-4 text-sm ${readiness?.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex items-center justify-between gap-3">
                <p className={`font-semibold ${readiness?.ok ? 'text-emerald-950' : 'text-amber-950'}`}>{readiness?.ok ? 'Ready for the Kolsetu test' : 'Readiness checks'}</p>
                <button type="button" className="btn-secondary py-1 text-xs" disabled={checkingReadiness} onClick={() => void checkReadiness()}>{checkingReadiness ? 'Checking...' : 'Recheck'}</button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(readiness?.checks ?? []).map((item) => (
                  <div key={item.name} className="rounded-md border border-white/70 bg-white/70 px-3 py-2">
                    <p className="font-medium text-slate-900">{item.ok ? 'Ready' : 'Needs attention'}: {item.name}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.ok ? String(item.detail ?? 'configured') : item.error}</p>
                  </div>
                ))}
                {!readiness ? <p className="text-xs text-amber-800">Open this panel after login to check LiveKit, voice clone, speech, scoring, and eval services.</p> : null}
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => setLiveKitOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={savingLiveKit}>{savingLiveKit ? 'Saving...' : 'Save agent details'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="card flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-lg">
        {state === 'idle' || state === 'connecting' ? (
          <div className="space-y-8">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 border border-slate-100">
                <svg className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <h2 className="text-xl font-bold text-slate-900">New Voice Capture</h2>
              <p className="mt-2 text-sm text-slate-500">Audio, timing, interruptions, and tool calls will be recorded.</p>
            </div>

            {captureRuntimes.length > 1 && (
              <label className="block text-sm text-slate-600">
                Agent version
                <select className="input-field mt-2" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>
                  {captureRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}{runtime.version ? ` · ${runtime.version}` : ''}</option>)}
                </select>
              </label>
            )}

            {loadingRuntimes ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">Checking your SDK…</div>
            ) : online.length ? (
              <button
                type="button"
                className="btn-primary flex min-h-12 w-full items-center justify-center text-base"
                disabled={state === 'connecting'}
                onClick={() => void startCall()}
              >
                {state === 'connecting' ? 'Starting call…' : 'Start Call'}
              </button>
            ) : liveKitRuntimes.length ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-emerald-950">Kolsetu LiveKit is configured.</p>
                    <p className="mt-1 text-sm text-emerald-800">Use automated evaluations to run simulated calls. This voice-capture button is only for SDK agents that answer browser WebRTC calls.</p>
                  </div>
                  <Link href="/experiments/new" className="btn-primary shrink-0">Run evaluation</Link>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[#cfd8ff] bg-[#f6f8ff] p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                  <div>
                    <p className="font-medium text-slate-900">Waiting for agent connection…</p>
                    <p className="mt-1 text-sm text-slate-600">Start your Pipecat or LiveKit agent with the Lightcurve SDK installed. It will automatically appear here once online.</p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button type="button" className="btn-secondary" onClick={() => { setLoadingRuntimes(true); void loadRuntimes(); }}>Check connection</button>
                    <Link href="/settings/sdk" className="btn-primary">Install SDK</Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : state === 'live' ? (
          <div className="py-12 text-center">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-[#eef2ff] border-4 border-white shadow-xl">
              <div className="flex items-center gap-1.5 h-8">
                <span className="w-1.5 h-full bg-[#2f5ae0] rounded-full animate-[pulse_1s_ease-in-out_infinite]" />
                <span className="w-1.5 h-1/2 bg-[#2f5ae0] rounded-full animate-[pulse_1.2s_ease-in-out_infinite_0.2s]" />
                <span className="w-1.5 h-3/4 bg-[#2f5ae0] rounded-full animate-[pulse_0.8s_ease-in-out_infinite_0.4s]" />
                <span className="w-1.5 h-full bg-[#2f5ae0] rounded-full animate-[pulse_1.1s_ease-in-out_infinite_0.1s]" />
                <span className="w-1.5 h-1/2 bg-[#2f5ae0] rounded-full animate-[pulse_0.9s_ease-in-out_infinite_0.3s]" />
              </div>
            </div>
            <h2 className="mt-6 text-2xl font-bold text-slate-900">Call is Live</h2>
            <p className="mt-2 text-sm text-slate-500">Speak naturally. This human interaction becomes the source graph for future replays.</p>
            <button type="button" className="mt-8 rounded-lg bg-red-600 px-8 py-3 text-sm font-semibold text-white shadow-md hover:bg-red-700 transition-colors" onClick={() => void endCall()}>End Call</button>
          </div>
        ) : state === 'review' ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Approve this human-derived case</h2>
              <p className="mt-1 text-sm text-slate-500">Lightcurve will preserve this call’s behavior graph and generate controlled replay variations.</p>
            </div>
            <label className="block text-sm text-slate-600">Case name<input className="input-field mt-2" value={caseName} onChange={(event) => setCaseName(event.target.value)} /></label>
            <label className="block text-sm text-slate-600">Call language<select className="input-field mt-2" value={caseLanguage} onChange={(event) => setCaseLanguage(event.target.value)}>{SUPPORTED_CASE_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}</select></label>
            <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={voiceCloneConsent} onChange={(event) => setVoiceCloneConsent(event.target.checked)} />
              <span><strong>Use my recorded voice in private test variants.</strong><span className="mt-1 block text-xs leading-5 text-slate-500">This permits Lightcurve to create synthetic caller speech from this recording only for your private agent tests. You can turn it off in the dataset replay policy.</span></span>
            </label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Saved privately to <strong>Audio Library</strong>. Raw audio and complete transcripts are never made public automatically.
            </div>
            <button type="button" className="btn-primary w-full" onClick={() => void approveCase()}>Approve and add to dataset</button>
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl text-emerald-700">✓</div>
            <h2 className="mt-4 text-xl font-semibold text-slate-950">Case added to your dataset</h2>
            <p className="mt-2 text-sm text-slate-500">It is ready for behavioral replay across agent versions.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href={`/datasets/${savedDatasetId}`} className="btn-primary">View dataset</Link>
              <button type="button" className="btn-secondary" onClick={() => { setCapture(null); setVoiceCloneConsent(false); setCaseLanguage('en-US'); setState('idle'); }}>Record another call</button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
