'use client';

import { useEffect, useState } from 'react';

type Guardrail = { id: string; name: string; description: string; rule: string; updatedAt: string };

export default function GuardrailsPage() {
  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rule, setRule] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadGuardrails = () => fetch('/api/guardrails').then((r) => r.json()).then((data) => {
    if (data.guardrails) setGuardrails(data.guardrails);
  });

  useEffect(() => {
    loadGuardrails();
  }, []);

  async function createGuardrail(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/guardrails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, rule }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Failed to create guardrail');
      setName('');
      setDescription('');
      setRule('');
      loadGuardrails();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="page-title">Guardrails</h1>
        <p className="page-subtitle">Define constraints the agent must follow.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Create New Guardrail</h2>
        {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={createGuardrail} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">Name
              <input required className="input-field mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. No Medical Advice" />
            </label>
            <label className="block text-sm font-medium text-slate-700">Description
              <input className="input-field mt-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Prevents prescribing medication" />
            </label>
          </div>
          <label className="block text-sm font-medium text-slate-700">Rule
            <textarea required className="input-field mt-1 h-24" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="The agent must never give medical advice..." />
          </label>
          <button type="submit" disabled={saving} className="btn-primary w-full justify-center">{saving ? 'Saving...' : 'Create Guardrail'}</button>
        </form>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Existing Guardrails</h2>
        {guardrails.length === 0 ? (
          <p className="text-sm text-slate-500">No guardrails found.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {guardrails.map(g => (
              <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">{g.name}</h3>
                <p className="text-xs text-slate-500">{g.description}</p>
                <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700 border border-slate-100">{g.rule}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
