'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DatasetsPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [cases, setCases] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function createDatasetGroup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);

    try {
      const caseNames = cases
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);

      if (!name.trim()) throw new Error('Give the dataset group a name.');
      if (!caseNames.length) throw new Error('Add at least one case to the group.');

      const response = await fetch('/api/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          cases: caseNames,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Dataset group could not be created.');
      if (!body.dataset?.id) throw new Error('Dataset group was created, but could not be opened.');

      setNotice('Dataset group created.');
      router.push(`/datasets/${body.dataset.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dataset group could not be created.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Datasets</h1>
        <p className="page-subtitle">Create a dataset group with a clear name and the cases you want to evaluate.</p>
      </div>

      <form onSubmit={createDatasetGroup} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Create Dataset Group</h2>
          <p className="mt-1 text-sm text-slate-500">Group related evaluation cases together so every run has the right scope.</p>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="block text-sm font-medium text-slate-700">
            Group name
            <input
              className="input-field mt-2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Billing escalation checks"
              disabled={saving}
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Description
            <textarea
              className="input-field mt-2 min-h-20"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this group should validate"
              disabled={saving}
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Cases
            <textarea
              className="input-field mt-2 min-h-40"
              value={cases}
              onChange={(event) => setCases(event.target.value)}
              placeholder={'Customer asks for a refund outside policy\nCaller gives the wrong account number\nAgent needs to escalate a billing dispute'}
              disabled={saving}
            />
            <span className="mt-2 block text-xs text-slate-500">Add one case per line.</span>
          </label>
        </div>

        <button type="submit" disabled={saving} className="btn-primary mt-5">
          {saving ? 'Creating group...' : 'Create group'}
        </button>
      </form>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
    </div>
  );
}
