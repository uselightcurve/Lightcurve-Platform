'use client';

import { useEffect, useState } from 'react';

type Playbook = { id: string; name: string; instructions: string; updatedAt: string };

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="page-title">Playbooks</h1>
        <p className="page-subtitle">Write the main instructions and persona for your agent.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Create New Playbook</h2>
        {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={createPlaybook} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-slate-700">Name
            <input required className="input-field mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Healthcare Intake" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Instructions
            <textarea required className="input-field mt-1 h-32" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="You are a helpful assistant..." />
          </label>
          <button type="submit" disabled={saving} className="btn-primary w-full justify-center">{saving ? 'Saving...' : 'Create Playbook'}</button>
        </form>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Existing Playbooks</h2>
        {playbooks.length === 0 ? (
          <p className="text-sm text-slate-500">No playbooks found.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {playbooks.map(pb => (
              <div key={pb.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-900">{pb.name}</h3>
                <p className="mt-2 text-sm text-slate-600 line-clamp-3">{pb.instructions}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
