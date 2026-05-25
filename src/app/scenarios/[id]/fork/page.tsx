'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

const PATCH_FIELDS = [
  { path: '/language', label: 'Language', placeholder: 'e.g. es-ES' },
  { path: '/persona/name', label: 'Persona name', placeholder: 'e.g. Maria' },
  { path: '/persona/accent', label: 'Accent', placeholder: 'e.g. Spanish' },
  { path: '/persona/emotional_state', label: 'Emotional state', placeholder: 'e.g. frustrated' },
  { path: '/persona/goal', label: 'Goal', placeholder: 'Describe the caller\'s objective…', multiline: true },
];

export default function ForkScenario() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [parent, setParent] = useState<any>(null);
  const [name, setName] = useState('');
  const [patches, setPatches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/scenarios')
      .then(r => r.json())
      .then(d => {
        const s = (d.scenarios ?? []).find((s: any) => s.id === id);
        setParent(s);
        if (s) setName(`${s.name}_fork`);
      });
  }, [id]);

  const setPatch = (path: string, value: string) => {
    setPatches(prev => ({ ...prev, [path]: value }));
  };

  const handleFork = async () => {
    setLoading(true);
    const patch = Object.entries(patches)
      .filter(([, v]) => v.trim())
      .map(([path, value]) => ({ op: 'replace', path, value }));

    await fetch(`/api/scenarios/${id}/fork`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, patch }),
    });
    setLoading(false);
    router.push('/scenarios');
  };

  const getParentValue = (path: string) => {
    if (!parent) return '';
    const parts = path.replace(/^\//, '').split('/');
    let val: any = parent;
    for (const p of parts) val = val?.[p];
    return val ? String(val) : '';
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/scenarios" className="hover:text-gray-700">Scenarios</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Fork</span>
      </div>

      <div className="page-header">
        <h1 className="page-title">Fork scenario</h1>
        <p className="page-subtitle">
          Inherit all fields from the parent and override only what you need.
          Grey fields are inherited — edit to override.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-8 max-w-4xl">
        {/* Parent reference */}
        <div>
          <div className="section-label mb-3">Parent (read-only)</div>
          {parent ? (
            <div className="card p-5 space-y-3 bg-gray-50 border-dashed">
              <div>
                <div className="text-xs text-gray-400 mb-0.5">Name</div>
                <div className="text-sm font-medium text-gray-500">{parent.name}</div>
              </div>
              {PATCH_FIELDS.map(f => (
                <div key={f.path}>
                  <div className="text-xs text-gray-400 mb-0.5">{f.label}</div>
                  <div className="text-sm text-gray-500">{getParentValue(f.path) || '—'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-5 text-sm text-gray-400">Loading…</div>
          )}
        </div>

        {/* Fork editor */}
        <div>
          <div className="section-label mb-3">Your fork (editable)</div>
          <div className="card p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fork name *</label>
              <input
                type="text"
                className="input-field"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            {PATCH_FIELDS.map(f => (
              <div key={f.path}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {f.label}
                  <span className="text-gray-400 font-normal ml-1">(leave blank to inherit)</span>
                </label>
                {f.multiline ? (
                  <textarea
                    rows={3}
                    className="input-field resize-none"
                    placeholder={`Inheriting: ${getParentValue(f.path) || '—'}`}
                    onChange={e => setPatch(f.path, e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    className="input-field"
                    placeholder={`Inheriting: ${getParentValue(f.path) || '—'}`}
                    onChange={e => setPatch(f.path, e.target.value)}
                  />
                )}
              </div>
            ))}

            <div className="flex gap-3 pt-2">
              <Link href="/scenarios" className="btn-secondary flex-1 text-center">
                Cancel
              </Link>
              <button
                onClick={handleFork}
                disabled={!name || loading}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {loading ? 'Creating…' : 'Create fork'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
