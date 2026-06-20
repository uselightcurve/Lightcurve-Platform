'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string | null;
};

type Runtime = {
  id: string;
  name: string;
  status: 'online' | 'offline';
  version?: string | null;
};

const installCommand = 'pip install --upgrade https://app.uselightcurve.com/sdk/use_lightcurve-0.4.0-py3-none-any.whl';
const importSnippet = `# Add this before creating your Pipecat PipelineWorker
import lightcurve.auto`;

function CopyBlock({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-950 p-3 text-slate-100">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs leading-5">{value}</code>
      <button type="button" onClick={() => void copy()} className="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800">
        {copied ? 'Copied' : label}
      </button>
    </div>
  );
}

export default function SdkSetupPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [secret, setSecret] = useState('');
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [keyResponse, runtimeResponse] = await Promise.all([
        fetch('/api/settings/api-keys', { cache: 'no-store' }),
        fetch('/api/runtimes', { cache: 'no-store' }),
      ]);
      const [keyBody, runtimeBody] = await Promise.all([
        keyResponse.json().catch(() => ({})),
        runtimeResponse.json().catch(() => ({})),
      ]);
      if (!keyResponse.ok) throw new Error(keyBody.error ?? 'API keys could not be loaded.');
      if (!runtimeResponse.ok) throw new Error(runtimeBody.error ?? 'SDK status could not be loaded.');
      setKeys(Array.isArray(keyBody.apiKeys) ? keyBody.apiKeys : []);
      setRuntimes(Array.isArray(runtimeBody.runtimes) ? runtimeBody.runtimes : []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'SDK setup could not be loaded.');
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  async function createKey() {
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Lightcurve SDK' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'API key could not be created.');
      setSecret(body.secret);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'API key could not be created.');
    } finally {
      setCreating(false);
    }
  }

  const online = runtimes.filter((runtime) => runtime.status === 'online');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="page-header">
        <h1 className="page-title">Install Lightcurve SDK</h1>
        <p className="page-subtitle">Three copy-paste steps once. Lightcurve handles Playground calls, capture, datasets, and replay.</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className={`rounded-xl border p-4 ${online.length ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{online.length ? 'SDK is online' : 'Waiting for your application'}</p>
            <p className="mt-1 text-sm text-slate-600">
              {online.length
                ? `${online[0].name}${online[0].version ? ` · ${online[0].version}` : ''} is ready for Playground calls and dataset replays.`
                : 'Complete the steps below, then run your application. Registration is automatic.'}
            </p>
          </div>
          {online.length ? <Link href="/playground" className="btn-primary shrink-0">Start a call</Link> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">Not running</span>}
        </div>
      </div>

      <div className="space-y-4">
        <section className="card p-5">
          <div className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2f5ae0] text-sm font-semibold text-white">1</span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-slate-900">Install the SDK</h2>
              <p className="mb-3 mt-1 text-sm text-slate-500">Run this in the same Python environment as your Pipecat agent.</p>
              <CopyBlock value={installCommand} label="Copy" />
              <p className="mt-2 text-xs text-slate-400">Lightcurve SDK 0.4.0 · Python 3.10+</p>
            </div>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2f5ae0] text-sm font-semibold text-white">2</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-900">Add your workspace key</h2>
                  <p className="mt-1 text-sm text-slate-500">Put it in your application environment. Lightcurve stores only its hash.</p>
                </div>
                <button type="button" className="btn-primary shrink-0" disabled={creating} onClick={() => void createKey()}>
                  {creating ? 'Creating…' : 'Create API key'}
                </button>
              </div>
              {secret ? (
                <div className="mt-4 space-y-2">
                  <CopyBlock value={`LIGHTCURVE_API_KEY=${secret}`} label="Copy" />
                  <p className="text-xs text-amber-700">Copy it now. The full key is shown only once.</p>
                </div>
              ) : keys.length ? (
                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">You already have {keys.length} SDK key{keys.length === 1 ? '' : 's'}. Create a new one only if you no longer have the full value.</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="card p-5">
          <div className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2f5ae0] text-sm font-semibold text-white">3</span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-slate-900">Enable Lightcurve once</h2>
              <p className="mb-3 mt-1 text-sm text-slate-500">Add this before your Pipecat worker is created, then run the app normally.</p>
              <CopyBlock value={importSnippet} label="Copy" />
              <p className="mt-3 text-sm text-slate-500">That is the entire integration. No agent URL, phone number, LiveKit room, SIP configuration, or callback is required.</p>
            </div>
          </div>
        </section>
      </div>

      {keys.length > 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Workspace keys</h2>
          </div>
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between border-b border-slate-100 px-5 py-3 last:border-0">
              <div>
                <p className="text-sm font-medium text-slate-800">{key.name}</p>
                <code className="text-xs text-slate-500">{key.keyPrefix}…</code>
              </div>
              <span className={`text-xs ${key.lastUsedAt ? 'text-emerald-600' : 'text-slate-400'}`}>{key.lastUsedAt ? 'Used' : 'Not used yet'}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
