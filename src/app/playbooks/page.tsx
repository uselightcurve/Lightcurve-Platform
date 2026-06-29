'use client';

import { useEffect, useState } from 'react';

type Playbook = { id: string; name: string; instructions: string; updatedAt: string };

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Playbook | null>(null);

  const loadPlaybooks = () => fetch('/api/playbooks').then((r) => r.json()).then((data) => {
    if (data.playbooks) setPlaybooks(data.playbooks);
  });

  useEffect(() => {
    loadPlaybooks();
  }, []);

  async function createPlaybook(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/playbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, instructions }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Failed to create playbook');
      setName('');
      setInstructions('');
      loadPlaybooks();
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
              <h2 className="text-xl font-semibold text-slate-900">{selected.name}</h2>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{selected.instructions}</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Playbooks</h1>
          <p className="page-subtitle">Write the main instructions and persona for your agent.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
        {/* Left Column: Existing */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Playbook Library</h2>
          {playbooks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
              </div>
              <h3 className="text-sm font-medium text-slate-900">No playbooks yet</h3>
              <p className="mt-1 text-sm text-slate-500">Create your first playbook using the form.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {playbooks.map(pb => (
                <div key={pb.id} onClick={() => setSelected(pb)} className="group relative rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:shadow-md cursor-pointer hover:border-indigo-200">
                  <h3 className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">{pb.name}</h3>
                  <div className="mt-4 text-[13px] text-slate-600 leading-relaxed line-clamp-4 relative">
                    {pb.instructions}
                    <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
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
              Create Playbook
            </h2>
            <p className="mt-1 text-[13px] text-slate-500 mb-5">Define your agent's core instructions.</p>
            
            {error && <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{error}</div>}
            
            <form onSubmit={createPlaybook} className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-slate-700 mb-1">Playbook Name</label>
                <input required className="input-field w-full text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Healthcare Intake" />
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[13px] font-medium text-slate-700">Instructions</label>
                  <label className="cursor-pointer text-[12px] font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Upload File
                    <input type="file" accept=".txt,.md,.mdx" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const text = await file.text();
                        setInstructions(text);
                        e.target.value = '';
                      }
                    }} />
                  </label>
                </div>
                <textarea required className="input-field w-full text-sm h-48 resize-none" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="You are a helpful assistant..." />
              </div>

              <div className="pt-2">
                <button type="submit" disabled={saving} className="btn-primary w-full justify-center py-2.5 shadow-sm">
                  {saving ? 'Creating...' : 'Create Playbook'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
