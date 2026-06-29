'use client';

import { useEffect, useState } from 'react';

type Scenario = { id: string; name: string; type: string; prompt: string; updatedAt: string };

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('custom');
  const [prompt, setPrompt] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadScenarios = () => fetch('/api/scenarios').then((r) => r.json()).then((data) => {
    if (data.scenarios) setScenarios(data.scenarios);
  });
  const loadDatasets = () => fetch('/api/datasets').then(r => r.json()).then(data => {
    if (data.datasets) setDatasets(data.datasets);
  });

  useEffect(() => {
    loadScenarios();
    loadDatasets();
  }, []);

  async function createScenario(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, prompt, datasetId: datasetId || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Failed to create scenario');
      setName('');
      setType('custom');
      setPrompt('');
      setDatasetId('');
      loadScenarios();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Scenarios</h1>
          <p className="page-subtitle">Create custom edge cases and adversarial payloads to test your agent's resilience.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
        {/* Left Column: Existing Scenarios */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Scenario Library</h2>
          {scenarios.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <h3 className="text-sm font-medium text-slate-900">No scenarios yet</h3>
              <p className="mt-1 text-sm text-slate-500">Create your first scenario using the form.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {scenarios.map((s) => (
                <div key={s.id} className={`group relative rounded-xl border p-5 shadow-sm transition-all hover:shadow-md ${s.type === 'jailbreak' ? 'border-rose-200 bg-gradient-to-b from-rose-50/50 to-white' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{s.name}</h3>
                    <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${s.type === 'jailbreak' ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>{s.type}</span>
                  </div>
                  <div className="mt-4 text-[13px] text-slate-600 leading-relaxed line-clamp-4 relative">
                    {s.prompt}
                    {/* Fade out effect for long text */}
                    <div className={`absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t ${s.type === 'jailbreak' ? 'from-white/90' : 'from-white' } to-transparent pointer-events-none`}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Create Form */}
        <div className="lg:col-span-1 sticky top-8">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Create New Scenario
            </h2>
            <p className="mt-1 text-[13px] text-slate-500 mb-5">Define the persona and script for the caller.</p>
            
            {error && <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>}
            
            <form onSubmit={createScenario} className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Scenario Name</label>
                <input required className="input-field w-full text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Angry Customer" />
              </div>
              
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Scenario Type</label>
                <select className="input-field w-full text-sm" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="custom">Custom Persona</option>
                  <option value="jailbreak">Adversarial Jailbreak</option>
                </select>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Add to Dataset <span className="text-slate-400 font-normal">(Optional)</span></label>
                <select className="input-field w-full text-sm" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                  <option value="">None (Scenario only)</option>
                  {datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Prompt / Script</label>
                <textarea required className="input-field w-full text-sm h-32 resize-none" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Act like a very angry customer whose package is 2 weeks late..." />
              </div>

              <div className="pt-2">
                <button type="submit" disabled={saving} className="btn-primary w-full justify-center py-2.5 shadow-sm">
                  {saving ? 'Creating...' : 'Create Scenario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
