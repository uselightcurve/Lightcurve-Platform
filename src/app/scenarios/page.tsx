'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LibraryScenario as StoredScenario } from '@/lib/realScenarioLibrary';

const languageFlags: Record<string, string> = {
  'en-US': 'US',
  'en-GB': 'UK',
  'hi-IN': 'IN',
  'es-ES': 'ES',
};

const domainStyles: Record<string, string> = {
  ecommerce: 'bg-[#eef2ff] text-[#2448bb] ring-[#cfd8ff]',
  banking: 'bg-slate-100 text-slate-700 ring-slate-200',
  healthcare: 'bg-slate-100 text-slate-700 ring-slate-200',
  telecom: 'bg-slate-100 text-slate-700 ring-slate-200',
  general: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const emotionStyles: Record<string, string> = {
  angry: 'bg-slate-100 text-slate-700 ring-slate-200',
  frustrated: 'bg-slate-100 text-slate-700 ring-slate-200',
  urgent: 'bg-slate-100 text-slate-700 ring-slate-200',
  nervous: 'bg-slate-100 text-slate-700 ring-slate-200',
  confused: 'bg-slate-100 text-slate-700 ring-slate-200',
  neutral: 'bg-slate-50 text-slate-600 ring-slate-200',
  calm: 'bg-slate-50 text-slate-600 ring-slate-200',
};

const defaultCustomScenario = {
  name: '',
  language: 'en-US',
  domain: 'ecommerce',
  emotion: 'frustrated',
  personaName: 'Customer',
  goal: '',
  openingLine: '',
  expectedOutcome: '',
};

const PAGE_SIZE = 48;

function formatName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${className}`}>{children}</span>;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="min-w-36 text-xs text-slate-500">
      <span className="mb-1 block">{label}</span>
      <select className="select-field py-1.5" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function scenarioMatchesQuery(scenario: StoredScenario, query: string) {
  if (!query.trim()) return true;
  const value = `${scenario.name} ${scenario.domain} ${scenario.language} ${scenario.persona.emotional_state} ${scenario.persona.goal} ${scenario.persona.opening_line}`.toLowerCase();
  return value.includes(query.trim().toLowerCase());
}

export default function ScenariosPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [language, setLanguage] = useState('all');
  const [domain, setDomain] = useState('all');
  const [emotion, setEmotion] = useState('all');
  const [query, setQuery] = useState('');
  const [libraryMode, setLibraryMode] = useState<'all' | 'library' | 'custom'>('all');
  const [scenarios, setScenarios] = useState<StoredScenario[]>([]);
  const [forking, setForking] = useState<StoredScenario | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [customScenario, setCustomScenario] = useState(defaultCustomScenario);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadScenarios() {
      setLoadError('');
      try {
        const response = await fetch('/api/scenarios', { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to load scenario library.');
        const payload = await response.json();
        const loaded = (Array.isArray(payload) ? payload : payload.scenarios ?? []) as StoredScenario[];
        if (cancelled) return;
        setScenarios(loaded);

        const forkId = new URLSearchParams(window.location.search).get('fork');
        if (forkId) {
          const target = loaded.find((scenario) => scenario.id === forkId);
          if (target) setForking(target);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Unable to load scenarios.');
      }
    }

    loadScenarios();
    return () => {
      cancelled = true;
    };
  }, []);

  const languages = useMemo(() => Array.from(new Set(scenarios.map((scenario) => scenario.language))).sort(), [scenarios]);
  const domains = useMemo(() => Array.from(new Set(scenarios.map((scenario) => scenario.domain))).sort(), [scenarios]);
  const emotions = useMemo(
    () => Array.from(new Set(scenarios.map((scenario) => scenario.persona.emotional_state))).sort(),
    [scenarios],
  );

  const filtered = useMemo(() => {
    return scenarios.filter((scenario) => {
      const isCustom = !scenario.isPreset;
      const matchesMode =
        libraryMode === 'all' || (libraryMode === 'library' && scenario.isPreset) || (libraryMode === 'custom' && isCustom);
      return (
        matchesMode &&
        scenarioMatchesQuery(scenario, query) &&
        (language === 'all' || scenario.language === language) &&
        (domain === 'all' || scenario.domain === domain) &&
        (emotion === 'all' || scenario.persona.emotional_state === emotion)
      );
    });
  }, [domain, emotion, language, libraryMode, query, scenarios]);

  useEffect(() => {
    setPage(1);
  }, [domain, emotion, language, libraryMode, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleScenarios = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleScenario(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function listenScenario(scenario: StoredScenario) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    if (speakingId === scenario.id) {
      setSpeakingId(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(scenario.persona.opening_line || scenario.persona.goal);
    utterance.lang = scenario.language;
    utterance.rate = Math.min(1.2, Math.max(0.75, (scenario.persona.speed_wpm || 140) / 150));
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(scenario.id);
    window.speechSynthesis.speak(utterance);
  }

  async function saveFork() {
    if (!forking) return;
    setLoadError('');
    try {
      const response = await fetch(`/api/scenarios/${forking.id}/fork`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to fork scenario.');
      }
      const payload = await response.json();
      const fork = (payload.scenario ?? payload) as StoredScenario;
      setScenarios((current) => [fork, ...current.filter((scenario) => scenario.id !== fork.id)]);
      setForking(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to fork scenario.');
    }
  }

  async function saveCustomScenario() {
    if (!customScenario.name.trim() || !customScenario.goal.trim()) return;
    const openingLine = customScenario.openingLine.trim() || customScenario.goal.trim();
    const scenario = {
      name: customScenario.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      language: customScenario.language,
      domain: customScenario.domain,
      persona: {
        name: customScenario.personaName.trim() || 'Customer',
        age: 36,
        accent: customScenario.language.split('-')[1] ?? customScenario.language,
        emotional_state: customScenario.emotion,
        goal: customScenario.goal.trim(),
        noise_db: customScenario.emotion === 'angry' || customScenario.emotion === 'frustrated' ? 5 : 2,
        speed_wpm: customScenario.emotion === 'angry' ? 166 : 140,
        interrupts: ['angry', 'frustrated', 'urgent'].includes(customScenario.emotion),
        opening_line: openingLine,
        code_switching: customScenario.language === 'hi-IN',
      },
      successCriteria: [
        {
          type: 'task_completed',
          description: customScenario.expectedOutcome.trim() || 'Agent completes the customer goal without inventing facts.',
          weight: 0.5,
        },
        { type: 'tone_appropriate', description: `Agent handles ${customScenario.emotion} caller state naturally.`, weight: 0.2 },
        { type: 'language_match', description: `Agent responds appropriately in ${customScenario.language}.`, weight: 0.15 },
        { type: 'no_hallucination', description: 'Agent does not invent unavailable facts.', weight: 0.15 },
      ],
      callerSeed: Date.now() % 100000,
    };
    setLoadError('');
    try {
      const response = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(scenario),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Unable to save scenario.');
      }
      const payload = await response.json();
      const savedScenario = (payload.scenario ?? payload) as StoredScenario;
      setScenarios((current) => [savedScenario, ...current.filter((item) => item.id !== savedScenario.id)]);
      setCustomScenario(defaultCustomScenario);
      setShowCreate(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to save scenario.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1 className="page-title">Scenarios</h1>
        <p className="page-subtitle">Real-world caller library for sandboxing voice agents before production.</p>
      </div>
      {loadError && (
        <div className="rounded-lg border border-[#efcfcc] bg-[#fbf3f2] px-4 py-3 text-sm text-[#8f3d3b]">{loadError}</div>
      )}

      <div className="card p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-end gap-2">
            <label className="min-w-[260px] flex-1 text-xs text-slate-500">
              <span className="mb-1 block">Search</span>
              <input
                className="input-field py-1.5"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scenarios, goals, domains"
              />
            </label>
            <FilterSelect label="Language" value={language} options={languages} onChange={setLanguage} />
            <FilterSelect label="Domain" value={domain} options={domains} onChange={setDomain} />
            <FilterSelect label="Emotion" value={emotion} options={emotions} onChange={setEmotion} />
            <div className="flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(['all', 'library', 'custom'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setLibraryMode(mode)}
                  className={`rounded-md px-3 py-1.5 text-xs capitalize ${
                    libraryMode === mode ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {selected.length >= 2 && (
              <a className="btn-secondary" href={`/experiments/new?scenarios=${selected.join(',')}`}>
                Run suite ({selected.length})
              </a>
            )}
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              Create Scenario
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {filtered.length} scenarios matched from {scenarios.length} total
        </span>
        <span>
          Page {page} of {pageCount}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
        {visibleScenarios.map((scenario) => {
          const isSelected = selected.includes(scenario.id);
          const emotionKey = scenario.persona.emotional_state;

          return (
            <article
              key={scenario.id}
              className={`card flex min-h-[218px] flex-col p-4 ${isSelected ? 'ring-2 ring-[#cfd8ff]' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => toggleScenario(scenario.id)}
                  className={`mt-0.5 h-4 w-4 rounded border ${isSelected ? 'border-[#2f5ae0] bg-[#2f5ae0]' : 'border-slate-300 bg-white'}`}
                  aria-label={`Select ${scenario.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{languageFlags[scenario.language] ?? scenario.language.slice(0, 2).toUpperCase()}</span>
                    <span>{scenario.language}</span>
                    <span>{scenario.persona.name}</span>
                  </div>
                  <h2 className="mt-1.5 text-sm font-medium leading-tight text-slate-950">{formatName(scenario.name)}</h2>
                </div>
                <Pill className={domainStyles[scenario.domain] ?? domainStyles.general}>{scenario.domain}</Pill>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Pill className={emotionStyles[emotionKey] ?? emotionStyles.neutral}>{emotionKey}</Pill>
                <Pill className="bg-slate-50 text-slate-600 ring-slate-200">{scenario.persona.noise_db ?? 0} dB noise</Pill>
                <Pill className="bg-slate-50 text-slate-600 ring-slate-200">
                  {scenario.persona.interrupts ? 'interrupts' : 'no interrupts'}
                </Pill>
                {scenario.persona.code_switching && <Pill className="bg-slate-50 text-slate-600 ring-slate-200">code switch</Pill>}
              </div>

              <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-600">{scenario.persona.goal}</p>
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Caller opening line</p>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-700">{scenario.persona.opening_line}</p>
              </div>

              <div className="mt-auto flex items-center justify-end gap-2 pt-4">
                <button onClick={() => listenScenario(scenario)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">
                  {speakingId === scenario.id ? 'Stop' : 'Listen'}
                </button>
                <button onClick={() => setForking(scenario)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">
                  Fork
                </button>
                <button onClick={() => router.push(`/experiments/new?scenario=${scenario.id}`)} className="btn-primary min-h-8 px-3 py-1.5 text-xs">
                  Run
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="card flex items-center justify-between px-4 py-3">
        <p className="text-xs text-slate-500">
          Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <button
            className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 p-6 backdrop-blur-sm">
          <div className="w-[720px] rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-slate-950">Create test scenario</h2>
                <p className="mt-1 text-xs text-slate-500">Capture a customer-specific call your agent must handle.</p>
              </div>
              <button onClick={() => setShowCreate(false)} className="btn-quiet">Close</button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500">
                Scenario name
                <input
                  className="input-field mt-1"
                  value={customScenario.name}
                  onChange={(event) => setCustomScenario((current) => ({ ...current, name: event.target.value }))}
                  placeholder="refund escalation after failed delivery"
                />
              </label>
              <label className="text-xs text-slate-500">
                Persona name
                <input
                  className="input-field mt-1"
                  value={customScenario.personaName}
                  onChange={(event) => setCustomScenario((current) => ({ ...current, personaName: event.target.value }))}
                />
              </label>
              <FilterSelect label="Language" value={customScenario.language} options={['en-US', 'hi-IN', 'es-ES', 'en-GB']} onChange={(value) => setCustomScenario((current) => ({ ...current, language: value }))} />
              <FilterSelect label="Domain" value={customScenario.domain} options={['ecommerce', 'banking', 'telecom', 'healthcare', 'general']} onChange={(value) => setCustomScenario((current) => ({ ...current, domain: value }))} />
              <FilterSelect label="Emotion" value={customScenario.emotion} options={['angry', 'frustrated', 'urgent', 'nervous', 'confused', 'neutral']} onChange={(value) => setCustomScenario((current) => ({ ...current, emotion: value }))} />
              <div />
              <label className="col-span-2 text-xs text-slate-500">
                Customer goal
                <textarea
                  className="input-field mt-1 h-20"
                  value={customScenario.goal}
                  onChange={(event) => setCustomScenario((current) => ({ ...current, goal: event.target.value }))}
                  placeholder="The caller wants a refund but does not have the order number ready."
                />
              </label>
              <label className="col-span-2 text-xs text-slate-500">
                Opening line
                <input
                  className="input-field mt-1"
                  value={customScenario.openingLine}
                  onChange={(event) => setCustomScenario((current) => ({ ...current, openingLine: event.target.value }))}
                  placeholder="I have called twice and still do not have my refund."
                />
              </label>
              <label className="col-span-2 text-xs text-slate-500">
                Expected outcome
                <input
                  className="input-field mt-1"
                  value={customScenario.expectedOutcome}
                  onChange={(event) => setCustomScenario((current) => ({ ...current, expectedOutcome: event.target.value }))}
                  placeholder="Agent verifies safely, explains next step, and avoids false guarantees."
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveCustomScenario}>Save Scenario</button>
            </div>
          </div>
        </div>
      )}

      {forking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 p-6 backdrop-blur-sm">
          <div className="w-[720px] rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-slate-950">Fork scenario</h2>
                <p className="mt-1 text-xs text-slate-500">Create a custom version for your product, policy, or market.</p>
              </div>
              <button onClick={() => setForking(null)} className="btn-quiet">Close</button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Original scenario</p>
                <p className="mt-2 text-sm font-medium text-slate-950">{formatName(forking.name)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{forking.persona.goal}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">Custom fork</p>
                <p className="mt-2 text-sm font-medium text-slate-950">{formatName(`${forking.name} custom`)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Increases noise slightly and keeps the same release criteria so you can test a harder variant.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setForking(null)} className="btn-secondary">Cancel</button>
              <button onClick={saveFork} className="btn-primary">Save Fork</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
