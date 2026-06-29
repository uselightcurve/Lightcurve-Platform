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
  const [selected, setSelected] = useState<Guardrail | null>(null);

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
    <div className="mx-auto max-w-6xl space-y-8">
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{selected.name}</h2>
                <p className="text-sm text-slate-500 mt-1">{selected.description}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700 border border-slate-200 whitespace-pre-wrap leading-relaxed">{selected.rule}</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Guardrails</h1>
          <p className="page-subtitle">Define constraints the agent must follow.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
        {/* Left Column: Existing */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Guardrail Library</h2>
          {guardrails.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
              <h3 className="text-sm font-medium text-slate-900">No guardrails yet</h3>
              <p className="mt-1 text-sm text-slate-500">Create your first guardrail using the form.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {guardrails.map(g => (
                <div key={g.id} onClick={() => setSelected(g)} className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md cursor-pointer hover:border-indigo-200">
                  <h3 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{g.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{g.description}</p>
                  <div className="mt-4 text-[13px] text-slate-600 leading-relaxed line-clamp-3 relative bg-slate-50 p-3 rounded-md border border-slate-100">
                    {g.rule}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Form */}
        <div className="lg:col-span-1 sticky top-8">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Create Guardrail
            </h2>
            <p className="mt-1 text-[13px] text-slate-500 mb-5">Set boundaries for your agent.</p>
            
            {error && <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>}
            
            <form onSubmit={createGuardrail} className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Name</label>
                <input required className="input-field w-full text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. No Medical Advice" />
              </div>
              
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Description</label>
                <input className="input-field w-full text-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Prevents prescribing medication" />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Rule</label>
                <textarea required className="input-field w-full text-sm h-32 resize-none" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="The agent must never give medical advice..." />
              </div>

              <div className="pt-2">
                <button type="submit" disabled={saving} className="btn-primary w-full justify-center py-2.5 shadow-sm">
                  {saving ? 'Creating...' : 'Create Guardrail'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
