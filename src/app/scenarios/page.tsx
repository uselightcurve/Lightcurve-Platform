'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { DEMO_SCENARIOS } from '@/lib/demoData';
import { ScoreBar } from '@/components/PageActions';
import { demoDatasetSeeds, seedToScenario, type DatasetScenarioSeed } from '@/lib/datasetScenarios';
import { getScenarios, saveScenario } from '@/lib/workspaceStore';

type DemoScenario = {
  id: string;
  name: string;
  language: string;
  domain: string;
  persona: {
    name: string;
    age: number;
    accent: string;
    emotional_state: string;
    goal: string;
    noise_db: number;
    speed_wpm: number;
    interrupts: boolean;
    opening_line: string;
    code_switching?: boolean;
  };
  successCriteria: Array<{ type: string; description: string; weight: number }>;
  callerSeed: number;
  isPreset: boolean;
};

const scenarioSeed = DEMO_SCENARIOS as DemoScenario[];

const languageFlags: Record<string, string> = {
  'en-US': 'US',
  'en-GB': 'UK',
  'hi-IN': 'IN',
  'es-ES': 'ES',
};

const domainStyles: Record<string, string> = {
  retail: 'bg-[#eef2ff] text-[#2448bb] ring-[#cfd8ff]',
  ecommerce: 'bg-[#eef2ff] text-[#2448bb] ring-[#cfd8ff]',
  banking: 'bg-slate-100 text-slate-700 ring-slate-200',
  healthcare: 'bg-slate-100 text-slate-700 ring-slate-200',
  telecom: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const emotionStyles: Record<string, string> = {
  angry: 'bg-slate-100 text-slate-700 ring-slate-200',
  frustrated: 'bg-slate-100 text-slate-700 ring-slate-200',
  urgent: 'bg-slate-100 text-slate-700 ring-slate-200',
  nervous: 'bg-slate-100 text-slate-700 ring-slate-200',
  confused: 'bg-slate-100 text-slate-700 ring-slate-200',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  calm: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const lastMos: Record<string, number> = {
  angry_refund_call: 4.1,
  fraud_dispute_call: 4.3,
  urgent_clinic_booking: 3.9,
  internet_outage_credit: 3.2,
  plan_upgrade_hinglish: 3.4,
  elderly_bill_payment: 3.7,
};

function formatName(name: string) {
  return name.replace(/_/g, ' ');
}

function Pill({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${className}`}>
      {children}
    </span>
  );
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

export default function ScenariosPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [language, setLanguage] = useState('all');
  const [domain, setDomain] = useState('all');
  const [emotion, setEmotion] = useState('all');
  const [presetMode, setPresetMode] = useState<'all' | 'preset' | 'custom'>('all');
  const [forking, setForking] = useState<DemoScenario | null>(null);
  const [customForks, setCustomForks] = useState<DemoScenario[]>([]);
  const [showDatasetSeeds, setShowDatasetSeeds] = useState(false);
  const [datasetSeeds, setDatasetSeeds] = useState<DatasetScenarioSeed[]>(demoDatasetSeeds);

  const scenarios = [...customForks, ...scenarioSeed.filter((scenario) => !customForks.some((fork) => fork.id === scenario.id))];
  const languages = Array.from(new Set(scenarios.map((scenario) => scenario.language)));
  const domains = Array.from(new Set(scenarios.map((scenario) => scenario.domain)));
  const emotions = Array.from(new Set(scenarios.map((scenario) => scenario.persona.emotional_state)));

  const filtered = useMemo(() => {
    return scenarios.filter((scenario) => {
      const isCustom = !scenario.isPreset;
      const matchesMode =
        presetMode === 'all' || (presetMode === 'preset' && scenario.isPreset) || (presetMode === 'custom' && isCustom);
      return (
        matchesMode &&
        (language === 'all' || scenario.language === language) &&
        (domain === 'all' || scenario.domain === domain) &&
        (emotion === 'all' || scenario.persona.emotional_state === emotion)
      );
    });
  }, [domain, emotion, language, presetMode, scenarios]);

  useEffect(() => {
    const loaded = getScenarios() as DemoScenario[];
    const custom = loaded.filter((scenario) => !scenario.isPreset || scenario.id.startsWith('dataset-') || scenario.id.startsWith('custom-'));
    setCustomForks(custom);

    const forkId = new URLSearchParams(window.location.search).get('fork');
    if (forkId) {
      const target = loaded.find((scenario) => scenario.id === forkId) ?? scenarioSeed.find((scenario) => scenario.id === forkId);
      if (target) setForking(target);
    }
  }, []);

  function toggleScenario(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function saveFork() {
    if (!forking) return;
    const fork: DemoScenario = {
      ...forking,
      id: `custom-${forking.id}`,
      name: `${forking.name}_custom`,
      isPreset: false,
      persona: {
        ...forking.persona,
        name: `${forking.persona.name} fork`,
        emotional_state: forking.persona.emotional_state === 'angry' ? 'frustrated' : forking.persona.emotional_state,
        noise_db: Math.min((forking.persona.noise_db ?? 0) + 2, 12),
      },
    };
    saveScenario(fork);
    setCustomForks((current) => [fork, ...current.filter((item) => item.id !== fork.id)]);
    setForking(null);
  }

  async function loadDatasetSeeds() {
    const response = await fetch('/api/datasets/scenario-seeds');
    const data = await response.json();
    setDatasetSeeds(data.seeds?.length ? data.seeds : demoDatasetSeeds);
    setShowDatasetSeeds(true);
  }

  function approveDatasetSeed(seed: DatasetScenarioSeed) {
    const scenario = seedToScenario(seed);
    const fork: DemoScenario = {
      id: `dataset-${seed.id}`,
      name: scenario.name,
      language: scenario.language,
      domain: scenario.domain,
      persona: {
        name: scenario.persona.name,
        age: 35,
        accent: scenario.persona.accent,
        emotional_state: scenario.persona.emotional_state,
        goal: scenario.persona.goal,
        noise_db: scenario.persona.noise_db,
        speed_wpm: scenario.persona.speed_wpm,
        interrupts: scenario.persona.interrupts,
        opening_line: scenario.persona.opening_line,
        code_switching: scenario.persona.code_switching,
      },
      successCriteria: scenario.successCriteria,
      callerSeed: scenario.callerSeed,
      isPreset: false,
    };
    saveScenario(fork);
    setCustomForks((current) => [fork, ...current.filter((item) => item.id !== fork.id)]);
    setDatasetSeeds((current) => current.map((item) => (item.id === seed.id ? { ...item, reviewStatus: 'approved' } : item)));
  }

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1 className="page-title">Scenarios</h1>
        <p className="page-subtitle">Browse preset callers, fork edge cases, and run suites against your voice agent.</p>
      </div>

      <div className="card p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <FilterSelect label="Language" value={language} options={languages} onChange={setLanguage} />
            <FilterSelect label="Domain" value={domain} options={domains} onChange={setDomain} />
            <FilterSelect label="Emotional State" value={emotion} options={emotions} onChange={setEmotion} />
            <div className="flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(['all', 'preset', 'custom'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPresetMode(mode)}
                  className={`rounded-md px-3 py-1.5 text-xs capitalize ${
                    presetMode === mode ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
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
                Run as Suite ({selected.length})
              </a>
            )}
            <button className="btn-secondary" onClick={loadDatasetSeeds}>
              Dataset Seeds
            </button>
            <button className="btn-secondary opacity-50" disabled title="Fork a preset to customize">
              New Scenario
            </button>
          </div>
        </div>
      </div>

      {showDatasetSeeds && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-medium text-slate-950">Dataset scenario seeds</h2>
              <p className="mt-1 text-xs text-slate-500">
                Public or uploaded rows become reviewable voice scenarios with source and license metadata.
              </p>
            </div>
            <button className="btn-quiet" onClick={() => setShowDatasetSeeds(false)}>
              Close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 2xl:grid-cols-3">
            {datasetSeeds.map((seed) => (
              <article key={seed.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">{seed.source.provider} / {seed.source.dataset}</p>
                    <h3 className="mt-2 text-sm font-medium text-slate-950">{seed.intent.replace(/_/g, ' ')}</h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">
                    {seed.source.license}
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{seed.goal}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-600">
                  <span className="panel-soft px-2 py-2">{seed.language}</span>
                  <span className="panel-soft px-2 py-2">{seed.domain}</span>
                  <span className="panel-soft px-2 py-2">{seed.emotion}</span>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-slate-500">{Math.round(seed.confidence * 100)}% match</span>
                  <button
                    className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                    onClick={() => approveDatasetSeed(seed)}
                    disabled={seed.reviewStatus === 'approved'}
                  >
                    {seed.reviewStatus === 'approved' ? 'Approved' : 'Approve'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
        {filtered.map((scenario) => {
          const isSelected = selected.includes(scenario.id);
          const emotionKey = scenario.persona.emotional_state;
          const parentName = scenario.isPreset ? null : scenario.name.replace('_custom', '');

          return (
            <article
              key={scenario.id}
              className={`card flex min-h-[198px] flex-col p-3 ${isSelected ? 'ring-2 ring-[#cfd8ff]' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => toggleScenario(scenario.id)}
                  className={`h-4 w-4 rounded border ${isSelected ? 'border-[#2f5ae0] bg-[#2f5ae0]' : 'border-slate-300 bg-white'}`}
                  aria-label={`Select ${scenario.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{languageFlags[scenario.language] ?? scenario.language.slice(0, 2).toUpperCase()}</span>
                    <span>{scenario.language}</span>
                    {scenario.isPreset && <span title="Preset scenario">lock</span>}
                  </div>
                  <h2 className="mt-1.5 text-sm font-medium leading-tight text-slate-950">{formatName(scenario.name)}</h2>
                </div>
                <Pill className={domainStyles[scenario.domain] ?? 'bg-slate-100 text-slate-700 ring-slate-200'}>
                  {scenario.domain}
                </Pill>
              </div>

              <div className="mt-2.5">
                <Pill className={emotionStyles[emotionKey] ?? emotionStyles.neutral}>{emotionKey}</Pill>
              </div>

              <p className="mt-2.5 line-clamp-2 text-sm leading-5 text-slate-600">{scenario.persona.goal}</p>
              {parentName && <p className="mt-2 text-xs text-slate-500">Forked from {parentName}</p>}

              <div className="mt-3 grid grid-cols-3 gap-1.5 text-xs text-slate-600">
                <div className="panel-soft px-2 py-1.5">{scenario.persona.noise_db ?? 0} dB noise</div>
                <div className="panel-soft px-2 py-1.5">{scenario.persona.interrupts ? 'Interrupts' : 'No interrupts'}</div>
                <div className="panel-soft px-2 py-1.5">{scenario.persona.code_switching ? 'Code switch' : 'Single language'}</div>
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                <div className="min-w-28 flex-1">
                  {lastMos[scenario.name] ? (
                    <ScoreBar value={lastMos[scenario.name]} max={4.5} />
                  ) : (
                    <span className="text-xs text-slate-400">Not run yet</span>
                  )}
                </div>
                <button onClick={() => setForking(scenario)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">
                  Fork
                </button>
                <a href={`/experiments/new?scenario=${scenario.id}`} className="btn-primary min-h-8 px-3 py-1.5 text-xs">
                  Run
                </a>
              </div>
            </article>
          );
        })}
      </div>

      {forking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20 p-6">
          <div className="grid w-[920px] grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="bg-slate-50 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-950">Parent scenario</h2>
                <span className="text-xs text-slate-500">Read only</span>
              </div>
              <div className="mt-5 space-y-4 opacity-70">
                {[
                  ['Language', forking.language],
                  ['Persona', forking.persona.name],
                  ['Emotion', forking.persona.emotional_state],
                  ['Goal', forking.persona.goal],
                  ['Noise', `${forking.persona.noise_db ?? 0} dB`],
                ].map(([label, value]) => (
                  <Fragment key={label}>
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{value}</p>
                  </Fragment>
                ))}
              </div>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-950">Fork scenario</h2>
                <button onClick={() => setForking(null)} className="text-slate-400 hover:text-slate-900">
                  x
                </button>
              </div>
              <div className="mt-5 space-y-3">
                <label className="block text-xs text-slate-500">
                  Language
                  <select className="select-field mt-1 bg-[#f7f9ff]" defaultValue={forking.language}>
                    <option>{forking.language}</option>
                    <option>hi-IN</option>
                    <option>en-US</option>
                  </select>
                </label>
                <label className="block text-xs text-slate-500">
                  Persona Name
                  <input className="input-field mt-1 bg-[#f7f9ff]" defaultValue={`${forking.persona.name} fork`} />
                </label>
                <label className="block text-xs text-slate-500">
                  Emotional State
                  <select className="select-field mt-1 bg-[#f7f9ff]" defaultValue={forking.persona.emotional_state}>
                    <option>angry</option>
                    <option>calm</option>
                    <option>frustrated</option>
                    <option>neutral</option>
                  </select>
                </label>
                <label className="block text-xs text-slate-500">
                  Goal
                  <textarea className="input-field mt-1 h-20 bg-[#f7f9ff]" defaultValue={forking.persona.goal} />
                </label>
                <label className="block text-xs text-slate-500">
                  Noise Level
                  <input className="mt-2 w-full accent-[#2f5ae0]" type="range" min="0" max="12" defaultValue={forking.persona.noise_db ?? 0} />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" defaultChecked={Boolean(forking.persona.code_switching)} />
                  Code-switching
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setForking(null)} className="btn-secondary">
                  Cancel
                </button>
                <button onClick={saveFork} className="btn-primary">
                  Save Fork
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
