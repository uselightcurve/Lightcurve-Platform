'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt?: string | null;
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const load = () => fetch('/api/settings/api-keys', { cache: 'no-store' }).then((response) => response.json()).then((body) => setKeys(body.apiKeys ?? [])).catch(() => setError('API keys could not be loaded.'));
  useEffect(() => { void load(); }, []);
  async function createKey() {
    const response = await fetch('/api/settings/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Pipecat SDK' }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error ?? 'API key could not be created.'); return; }
    setSecret(body.secret);
    void load();
  }
  return <div className="space-y-5"><div><h1 className="page-title">API keys</h1><p className="page-subtitle">One key activates the Lightcurve SDK inside your Pipecat application.</p></div><div className="grid grid-cols-[220px_1fr] gap-5"><aside className="card p-2"><Link href="/settings/profile" className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Your profile</Link><Link href="/settings/billing" className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">Billing</Link><Link href="/settings/api-keys" className="flex h-9 items-center rounded-md bg-slate-100 px-3 text-sm font-medium text-slate-900">API keys</Link></aside><section className="space-y-4">{error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}{secret && <div className="rounded-xl border border-[#cfd8ff] bg-[#f6f8ff] p-5"><p className="text-sm font-medium text-slate-900">Copy this key now</p><code className="mt-3 block overflow-x-auto rounded-lg bg-white p-3 text-sm text-slate-800">{secret}</code><p className="mt-2 text-xs text-slate-500">It will not be shown again.</p></div>}<div className="card p-5"><div className="flex items-start justify-between"><div><p className="font-medium text-slate-900">SDK setup</p><p className="mt-1 text-sm text-slate-500">Set LIGHTCURVE_API_KEY, then add <code>import lightcurve.auto</code> once.</p></div><button className="btn-primary" onClick={() => void createKey()}>Create key</button></div><div className="mt-5 space-y-2">{keys.map((key) => <div key={key.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3"><div><p className="text-sm font-medium text-slate-800">{key.name}</p><code className="text-xs text-slate-500">{key.keyPrefix}…</code></div><span className="text-xs text-slate-400">{key.lastUsedAt ? 'Active' : 'Not used yet'}</span></div>)}</div></div></section></div></div>;
}
