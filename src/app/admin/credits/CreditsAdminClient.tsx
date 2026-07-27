'use client';

import { useState } from 'react';

type CreditResponse = {
  user?: { email: string; name: string | null };
  granted?: { minutes: number; actions: number };
  credits?: { minutes: number; actions: number };
  remaining?: { minutes: number | null; actions: number | null };
  summary?: {
    minutesUsed: number;
    actionsUsed: number;
    minutesCredits: number;
    actionsCredits: number;
    minutesRemaining: number | null;
    actionsRemaining: number | null;
  };
  auditId?: string;
  error?: string;
};

function formatNumber(value: number | null | undefined) {
  if (value == null) return 'Unlimited';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

export function CreditsAdminClient() {
  const [email, setEmail] = useState('');
  const [minutes, setMinutes] = useState('5000');
  const [actions, setActions] = useState('25000');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CreditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'check' | 'grant'>('check');

  async function submit(intent: 'check' | 'grant') {
    setLoading(true);
    setMode(intent);
    setResult(null);
    try {
      const response = intent === 'check'
        ? await fetch(`/api/admin/credits?email=${encodeURIComponent(email)}`)
        : await fetch('/api/admin/credits', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, minutes: Number(minutes), actions: Number(actions), note }),
          });
      setResult(await response.json());
    } catch {
      setResult({ error: 'Request failed.' });
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;
  const credits = result?.credits ?? (summary ? { minutes: summary.minutesCredits, actions: summary.actionsCredits } : undefined);
  const remaining = result?.remaining ?? (summary ? { minutes: summary.minutesRemaining, actions: summary.actionsRemaining } : undefined);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
      <form
        className="card h-fit space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit('grant');
        }}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">Customer credits</h2>
          <p className="mt-1 text-sm text-slate-500">Check or grant testing minutes and eval actions.</p>
        </div>

        <label className="block text-sm font-medium text-slate-700">
          Customer email
          <input className="input-field mt-1" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="customer@example.com" required />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            Minutes
            <input className="input-field mt-1" type="number" min="1" value={minutes} onChange={(event) => setMinutes(event.target.value)} required />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Actions
            <input className="input-field mt-1" type="number" min="1" step="1" value={actions} onChange={(event) => setActions(event.target.value)} required />
          </label>
        </div>

        <label className="block text-sm font-medium text-slate-700">
          Note
          <textarea className="input-field mt-1 min-h-20 resize-y" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reason for the grant" />
        </label>

        <div className="flex gap-2">
          <button className="btn-secondary" type="button" disabled={loading || !email} onClick={() => void submit('check')}>
            Check
          </button>
          <button className="btn-primary" type="submit" disabled={loading || !email}>
            Grant credits
          </button>
        </div>
      </form>

      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Result</h2>
          <p className="mt-1 text-sm text-slate-500">Every grant is written to the billing audit log.</p>
        </div>
        <div className="p-5">
          {!result ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
              Enter a customer email, then check the balance or grant credits.
            </div>
          ) : result.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">{result.error}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-slate-900">{result.user?.email}</p>
                <p className="mt-1 text-sm text-slate-500">{mode === 'grant' ? 'Credits granted.' : 'Current credit balance.'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="metric-tile">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Minute credits</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(credits?.minutes)}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatNumber(remaining?.minutes)} remaining</p>
                </div>
                <div className="metric-tile">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Action credits</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(credits?.actions)}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatNumber(remaining?.actions)} remaining</p>
                </div>
              </div>
              {result.granted ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  Granted {formatNumber(result.granted.minutes)} minutes and {formatNumber(result.granted.actions)} actions.
                </div>
              ) : null}
              {result.auditId ? <p className="text-xs text-slate-500">Audit ID: {result.auditId}</p> : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
