'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function IntegrationsPage() {
  const [repo, setRepo] = useState('uselightcurve/voice-agent');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // In a real app, we'd save this securely. For this demo, we'll just mock saving.
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Integrations</h1>
        <p className="page-subtitle">Connect external services to Lightcurve.</p>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-5">
        <aside className="card p-2 h-fit">
          <Link href="/settings/profile" className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Your profile
          </Link>
          <Link href="/settings/billing" className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Billing
          </Link>
          <Link href="/settings/sdk" className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
            SDK setup
          </Link>
          <Link href="/settings/integrations" className="flex h-9 items-center rounded-md bg-slate-100 px-3 text-sm font-medium text-slate-900">
            Integrations
          </Link>
        </aside>

        <section className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="font-semibold text-emerald-950">Call evaluation included</h2>
            <p className="mt-1 text-sm leading-6 text-emerald-800">No additional model key is needed. Lightcurve reviews and stores call behavior privately as part of your deployment.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-slate-700"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.699-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
              </div>
              <h2 className="text-lg font-semibold text-slate-900">GitHub CI/CD</h2>
            </div>
            <p className="text-sm text-slate-500 mb-6">Automatically create Pull Requests to sync actionable fixes (Guardrails, Scenarios) directly into your source code.</p>
            
            <form onSubmit={handleSave} className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">Repository Name
                <input required className="input-field mt-1 w-full" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="org/repo" />
              </label>
              <label className="block text-sm font-medium text-slate-700">Personal Access Token
                <input type="password" required className="input-field mt-1 w-full" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxx" />
              </label>
              <button type="submit" className="btn-primary w-full sm:w-auto justify-center">{saved ? 'Saved!' : 'Save Connection'}</button>
            </form>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm mt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Private evaluation services</h2>
            </div>
            <p className="text-sm text-slate-500 mb-6">Reasoning, speech, voice analysis, and evaluation are included with your Lightcurve deployment. No additional model key is required.</p>
            
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"><p className="font-medium text-emerald-900">Qwen reasoning included</p><p className="mt-1 text-xs text-emerald-700">Runs privately inside your deployment.</p></div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4"><p className="font-medium text-emerald-900">Open-source speech included</p><p className="mt-1 text-xs text-emerald-700">No external speech provider is used.</p></div>
                <label className="block text-sm font-medium text-slate-700">Speech Service URL
                  <input className="input-field mt-1 w-full" placeholder="http://speech:8000" />
                </label>
                <label className="block text-sm font-medium text-slate-700">Speech Service Token
                  <input type="password" className="input-field mt-1 w-full" placeholder="Optional bearer token" />
                </label>
                <label className="block text-sm font-medium text-slate-700">Embedding Service URL
                  <input className="input-field mt-1 w-full" placeholder="http://embedding:8080" />
                </label>
              </div>
              <button type="submit" className="btn-primary w-full sm:w-auto justify-center">Save private connection</button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
