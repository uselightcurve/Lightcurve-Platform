'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type ApiKey = { id: string; name: string; keyPrefix: string; lastUsedAt?: string | null };
type Runtime = { id: string; name: string; status: 'online' | 'offline'; version?: string | null };

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex items-start gap-3 code-line mt-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs leading-5 text-slate-800">{value}</code>
      <button type="button" onClick={() => void copy()} className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Step({ number, title, description, children }: { number: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex gap-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2f5ae0] text-sm font-semibold text-white">{number}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <p className="mb-3 mt-1 text-sm text-slate-500">{description}</p>
          {children}
        </div>
      </div>
    </section>
  );
}

export function SdkOnboarding({ showHeader = true }: { showHeader?: boolean }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [language, setLanguage] = useState<'python' | 'node'>('python');

  const installCommand = language === 'python' ? 'pip install -U use-lightcurve' : 'npm install @use-lightcurve/sdk';
  const importSnippet = language === 'python' ? 'import lightcurve.auto' : "import { start } from '@use-lightcurve/sdk/dist/runtime';\n\nstart();";
  const runCommand = language === 'python' ? 'python app.py' : 'node index.js';
  const versionInfo = language === 'python' ? 'Lightcurve SDK 0.5.0 · Python 3.10+' : 'Lightcurve SDK 0.2.2 · Node.js 18+';
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
      const [keyBody, runtimeBody] = await Promise.all([keyResponse.json().catch(() => ({})), runtimeResponse.json().catch(() => ({}))]);
      if (!keyResponse.ok) throw new Error(keyBody.error ?? 'API keys could not be loaded.');
      if (!runtimeResponse.ok) throw new Error(runtimeBody.error ?? 'SDK status could not be loaded.');
      setKeys(Array.isArray(keyBody.apiKeys) ? keyBody.apiKeys : []);
      setRuntimes(Array.isArray(runtimeBody.runtimes) ? runtimeBody.runtimes : []);
      setError('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '';
      if (message.includes('NetworkError') || message.includes('Failed to fetch')) {
        setError('Cannot connect to the server. If you are running locally, ensure your Next.js dev server is still running.');
      } else {
        setError(message || 'SDK setup could not be loaded.');
      }
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  async function createKey() {
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/settings/api-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lightcurve SDK' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'API key could not be created.');
      setSecret(body.secret);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'API key could not be created.');
    } finally { setCreating(false); }
  }

  const online = runtimes.filter((runtime) => runtime.status === 'online');
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {showHeader ? <div className="page-header"><h1 className="page-title">Connect your Sandbox Environment</h1><p className="page-subtitle">Add one import. Lightcurve connects to your test agent to handle Playground sandbox testing, datasets, replay, and evaluation.</p></div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      <div className={`rounded-xl border p-4 ${online.length ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50'}`}>
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm font-semibold text-slate-900">{online.length ? 'Sandbox environment is online' : 'Connect your test agent'}</p><p className="mt-1 text-sm text-slate-600">{online.length ? `${online[0].name}${online[0].version ? ` · ${online[0].version}` : ''} is ready for testing.` : 'Python and Node.js are supported today. Registration happens automatically when your test app starts.'}</p></div>
          {online.length ? <Link href="/playground" className="btn-primary shrink-0">Open Sandbox</Link> : (
            <div className="flex bg-slate-200/50 p-1 rounded-lg w-fit border border-slate-200 shadow-inner shrink-0">
              <button type="button" onClick={() => setLanguage('python')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${language === 'python' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>Python</button>
              <button type="button" onClick={() => setLanguage('node')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${language === 'node' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>Node.js</button>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-4">
        <Step number={1} title="Install the SDK Runner" description={`Run this in your ${language === 'python' ? 'Python' : 'Node.js'} test project.`}><CopyBlock value={installCommand} /><p className="mt-2 text-xs text-slate-400">{versionInfo}</p></Step>
        <Step number={2} title="Generate a workspace key" description="The full key is shown once. Lightcurve stores only its hash.">
          <button type="button" className="btn-primary" disabled={creating} onClick={() => void createKey()}>{creating ? 'Creating…' : 'Generate API key'}</button>
          {secret ? <div className="mt-3 space-y-2"><CopyBlock value={secret} /><p className="text-xs text-amber-700">Copy it now; it will not be shown again.</p></div> : keys.length ? <p className="mt-3 text-sm text-slate-500">You already have {keys.length} workspace key{keys.length === 1 ? '' : 's'}.</p> : null}
        </Step>
        <Step number={3} title="Configure the environment" description="Add the key to your test environment."><CopyBlock value={`LIGHTCURVE_API_KEY=${secret || '<YOUR_LIGHTCURVE_API_KEY>'}`} /></Step>
        <Step number={4} title="Enable Lightcurve" description="Add this before your Pipecat PipelineWorker is created."><CopyBlock value={importSnippet} /></Step>
        <Step number={5} title="Run your test application" description="Use your normal start command. Lightcurve registers the test agent and unlocks the Sandbox automatically."><CopyBlock value={runCommand} /><p className="mt-3 text-sm text-slate-500">That is the entire integration. No agent URL, phone number, room, SIP setup, or callback.</p></Step>
      </div>
    </div>
  );
}
