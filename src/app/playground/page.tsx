'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [savedDatasetId, setSavedDatasetId] = useState('');
  const [error, setError] = useState('');
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
      const firstOnline = loaded.find((runtime) => runtime.status === 'online');
      setRuntimeId((current) => current || firstOnline?.id || loaded[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent runtimes could not be loaded.');
    } finally {
      setLoadingRuntimes(false);
    }
  }, []);

  useEffect(() => {
    void loadRuntimes();
    const timer = window.setInterval(() => void loadRuntimes(), 5000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadRuntimes]);

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
        body: JSON.stringify({ name: caseName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Case could not be saved.');
      setSavedDatasetId(body.dataset.id);
      setState('saved');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Case could not be saved.');
    }
  }

  const online = runtimes.filter((runtime) => runtime.status === 'online');
  const selectedRuntime = runtimes.find((runtime) => runtime.id === runtimeId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="page-title">Playground</h1>
        <p className="page-subtitle">Make one real human call. Lightcurve turns it into a reusable behavioral dataset.</p>
      </div>

      <audio ref={remoteAudioRef} autoPlay />

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {state === 'idle' || state === 'connecting' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-950">Human voice capture</p>
                <p className="mt-1 text-sm text-slate-500">Audio, timing, interruptions, tools, and outcomes are captured automatically.</p>
              </div>
              {selectedRuntime && (
                <span className={`rounded-full px-2.5 py-1 text-xs ${selectedRuntime.status === 'online' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {selectedRuntime.status}
                </span>
              )}
            </div>

            {runtimes.length > 1 && (
              <label className="block text-sm text-slate-600">
                Agent version
                <select className="input-field mt-2" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>
                  {runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}{runtime.version ? ` · ${runtime.version}` : ''}</option>)}
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
          <div className="py-8 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#eef2ff]">
              <span className="h-4 w-4 animate-pulse rounded-full bg-[#2f5ae0]" />
            </div>
            <h2 className="mt-5 text-xl font-semibold text-slate-950">Call in progress</h2>
            <p className="mt-2 text-sm text-slate-500">Speak naturally. This human interaction becomes the source graph for future replays.</p>
            <button type="button" className="mt-7 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white" onClick={() => void endCall()}>End call</button>
          </div>
        ) : state === 'review' ? (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Approve this human-derived case</h2>
              <p className="mt-1 text-sm text-slate-500">Lightcurve will preserve this call’s behavior graph and generate controlled replay variations.</p>
            </div>
            <label className="block text-sm text-slate-600">Case name<input className="input-field mt-2" value={caseName} onChange={(event) => setCaseName(event.target.value)} /></label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Saved privately to <strong>Playground Captures</strong>. Raw audio and complete transcripts are never made public automatically.
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
              <button type="button" className="btn-secondary" onClick={() => { setCapture(null); setState('idle'); }}>Record another call</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
