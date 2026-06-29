'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const ORBITS = [
  { id: 0, radius: 60, color: '#f1f5f9', activeColor: '#64748b', label: 'SDK Integration' },
  { id: 1, radius: 95, color: '#fef3c7', activeColor: '#d97706', label: 'Agent Playbooks' },
  { id: 2, radius: 130, color: '#ffedd5', activeColor: '#ea580c', label: 'Voice Datasets' },
  { id: 3, radius: 165, color: '#fce7f3', activeColor: '#db2777', label: 'Safety & Guardrails' },
  { id: 4, radius: 200, color: '#f3e8ff', activeColor: '#9333ea', label: 'Jailbreaks & Scenarios' },
  { id: 5, radius: 235, color: '#e0f2fe', activeColor: '#0284c7', label: 'Dialect & VAD Stress' },
  { id: 6, radius: 270, color: '#dbeafe', activeColor: '#2563eb', label: 'First Evaluation' },
  { id: 7, radius: 305, color: '#dcfce7', activeColor: '#16a34a', label: 'Actionable Fixes' },
];

const ORBIT_DETAILS = [
  {
    title: 'Zero to Hero: SDK Initialization',
    description: 'Every great agent needs to be plugged in. Verify your SDK is installed and successfully streaming live audio data. Once we can see the bits, we can build the magic.',
    actionType: 'setup',
  },
  {
    title: 'Define the Core Playbook',
    description: 'What is your agent actually supposed to do? Create a Playbook to define the primary instructions, persona, and overarching goals. This is your agent\'s brain.',
    actionType: 'test',
    actionLabel: 'Create your first Playbook',
    link: '/playbooks'
  },
  {
    title: 'Ground in Reality: Datasets',
    description: 'We don\'t test in a vacuum. Upload real human call audio or record in the Playground to create behavioral Datasets. We\'ll preserve the human intent to use for testing.',
    actionType: 'test',
    actionLabel: 'Upload a Voice Dataset',
    link: '/datasets'
  },
  {
    title: 'Establish the Guardrails',
    description: 'Keep your agent on the rails. Define strict boundaries—what it should never say, off-topic subjects to avoid, and unauthorized promises it cannot make.',
    actionType: 'test',
    actionLabel: 'Set up Guardrails',
    link: '/guardrails'
  },
  {
    title: 'Prepare for Chaos: Jailbreaks',
    description: 'Users will try to break it. Define custom adversarial Scenarios and Jailbreaks to inject payloads and test if the agent leaks prompts or disobeys its Playbook.',
    actionType: 'test',
    actionLabel: 'Define custom Scenarios',
    link: '/scenarios'
  },
  {
    title: 'Environmental Stress Testing',
    description: 'Real life is noisy. We\'ll interrupt the agent mid-sentence, throw heavy accents at it, and inject simulated packet loss to ensure your VAD and ASR degrade gracefully.',
    actionType: 'test',
    actionLabel: 'Explore the Playground',
    link: '/playground'
  },
  {
    title: 'Launch the Evaluation',
    description: 'It\'s time for the crucible. Combine your Playbook, Guardrails, Scenarios, and Datasets into a massive, parallel automated experiment to score your agent\'s true resilience.',
    actionType: 'test',
    actionLabel: 'Run an Automated Test',
    link: '/experiments/new'
  },
  {
    title: 'From Failure to Action',
    description: 'When things break, we don\'t just give you a red X. Review the run report to see exactly what went wrong and get an Actionable Fix to patch your agent\'s prompt instantly.',
    actionType: 'test',
    actionLabel: 'View Recent Runs',
    link: '/experiments'
  }
];

function SetupSnippetView({ onComplete, isCompleted }: { onComplete: () => void; isCompleted: boolean }) {
  const [lang, setLang] = useState<'node' | 'python'>('node');

  return (
    <div className="mt-6">
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex border-b border-slate-200 bg-white">
          <button
            onClick={() => setLang('node')}
            className={`flex-1 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${lang === 'node' ? 'border-b-2 border-indigo-500 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Node.js
          </button>
          <button
            onClick={() => setLang('python')}
            className={`flex-1 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${lang === 'python' ? 'border-b-2 border-indigo-500 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Python
          </button>
        </div>
        <pre className="p-4 text-[13px] leading-relaxed text-slate-800 overflow-x-auto min-h-[160px]">
          <code>
{lang === 'node' ? `import { Lightcurve } from '@use-lightcurve/sdk';

const lightcurve = new Lightcurve({
  apiKey: process.env.LIGHTCURVE_API_KEY
});

// Wrap your agent
lightcurve.monitor(agent);` : `from lightcurve import Lightcurve
import os

lightcurve = Lightcurve(
    api_key=os.environ.get("LIGHTCURVE_API_KEY")
)

# Wrap your agent
lightcurve.monitor(agent)`}
          </code>
        </pre>
      </div>
      <div className="mt-5 flex gap-3">
        <Link href="/settings/sdk" className="btn-secondary flex-1 justify-center text-[15px] py-2.5 border-slate-200 text-slate-700 bg-white hover:bg-slate-50">Get my API Key</Link>
        <button 
          onClick={onComplete} 
          className={`flex-1 justify-center text-[15px] py-2.5 rounded-md font-medium transition-colors ${
            isCompleted 
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
              : 'bg-[#2f5ae0] text-white hover:bg-[#2448bb] shadow-sm'
          }`}
        >
          {isCompleted ? '✓ Setup Complete' : 'Mark as Installed'}
        </button>
      </div>
    </div>
  );
}

export function OrbitOnboarding({ onReachEnd }: { onReachEnd?: () => void } = {}) {
  const [activeOrbit, setActiveOrbit] = useState(0);
  const [completedOrbits, setCompletedOrbits] = useState<number[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('lightcurve_onboarding_progress');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setCompletedOrbits(parsed);
        const max = Math.max(...parsed);
        if (max >= 0 && max < ORBITS.length - 1) {
          setActiveOrbit(max + 1);
        }
      } catch (e) {}
    }
  }, []);

  const handleComplete = (id: number) => {
    const newCompleted = Array.from(new Set([...completedOrbits, id]));
    setCompletedOrbits(newCompleted);
    localStorage.setItem('lightcurve_onboarding_progress', JSON.stringify(newCompleted));
    if (id < ORBITS.length - 1) {
      setActiveOrbit(id + 1);
    }
  };

  const highestUnlocked = 99; // Demo mode: unlock all orbits

  useEffect(() => {
    if ((completedOrbits.includes(7) || activeOrbit === 7) && onReachEnd) {
      onReachEnd();
    }
  }, [completedOrbits, activeOrbit, onReachEnd]);

  const detail = ORBIT_DETAILS[activeOrbit];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-8">
        <h2 className="text-xl font-bold tracking-tight text-slate-900">Evaluation Orbits</h2>
        <p className="mt-1 text-sm text-slate-500">Progressive difficulty tiers for testing your voice agents.</p>
      </div>

      <div className="grid gap-12 lg:grid-cols-[1fr_400px]">
        {/* SVG Diagram Area - Superbryn style but polished */}
        <div className="relative flex items-end justify-center overflow-hidden pt-4 pb-2">
          <svg width="650" height="340" viewBox="-325 -320 650 340" className="overflow-visible">
            {/* Draw from outer to inner to ensure proper overlapping */}
            {[...ORBITS].reverse().map((orbit) => {
              const isActive = activeOrbit === orbit.id;
              const isLocked = orbit.id > highestUnlocked;
              const isCompleted = completedOrbits.includes(orbit.id);
              // Arc path for semi-circle
              const path = `M -${orbit.radius} 0 A ${orbit.radius} ${orbit.radius} 0 0 1 ${orbit.radius} 0 L 0 0 Z`;
              
              return (
                <g 
                  key={orbit.id} 
                  className={`transition-all duration-300 ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`} 
                  onClick={() => !isLocked && setActiveOrbit(orbit.id)}
                >
                  <path
                    d={path}
                    fill={isActive ? orbit.activeColor : orbit.color}
                    fillOpacity={isLocked ? 0.25 : (isActive ? 1 : 0.6)}
                    stroke="#ffffff"
                    strokeWidth="3"
                    className={`transition-all duration-300 ${isLocked ? '' : 'hover:fill-opacity-90'}`}
                  />
                  {/* Label path for text - placing slightly inside the top arc */}
                  <path
                    id={`path-${orbit.id}`}
                    d={`M -${orbit.radius - 12} 0 A ${orbit.radius - 12} ${orbit.radius - 12} 0 0 1 ${orbit.radius - 12} 0`}
                    fill="none"
                    stroke="none"
                  />
                  {orbit.radius > 60 && (
                    <text className={`pointer-events-none select-none text-[11px] font-semibold tracking-wide transition-all duration-300 ${isActive ? 'fill-white' : 'fill-slate-600'}`} opacity={isLocked ? 0.3 : (isActive ? 1 : 0.8)}>
                      <textPath href={`#path-${orbit.id}`} startOffset="50%" textAnchor="middle">
                        {orbit.label}
                      </textPath>
                    </text>
                  )}
                </g>
              );
            })}
            
            {/* Center Agent Node */}
            <circle cx="0" cy="0" r="30" fill="url(#agentGradient)" stroke="#ffffff" strokeWidth="3" className="shadow-lg" />
            <text x="0" y="4" className="pointer-events-none select-none fill-slate-700 text-[11px] font-bold tracking-wide" textAnchor="middle">AGENT</text>
            
            {/* Gradients & Defs */}
            <defs>
              <radialGradient id="agentGradient" cx="50%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#e2e8f0" />
              </radialGradient>
            </defs>
          </svg>
        </div>

        {/* Info Card Area */}
        <div className="flex flex-col justify-center">
          <div className="relative rounded-lg border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgb(0,0,0,0.03)] transition-all">
            <div className="mb-4 inline-flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200">
              <span className="flex h-1.5 w-1.5 rounded-full" style={{ background: ORBITS[activeOrbit].activeColor }} />
              Orbit {activeOrbit} · {ORBITS[activeOrbit].label}
              {completedOrbits.includes(activeOrbit) && <span className="ml-1 text-emerald-600">✓</span>}
            </div>
            
            <h3 className="text-xl font-bold tracking-tight text-slate-900">{detail.title}</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{detail.description}</p>
            
            {detail.actionType === 'setup' ? (
              <SetupSnippetView 
                onComplete={() => handleComplete(0)} 
                isCompleted={completedOrbits.includes(0)} 
              />
            ) : (
              <div className="mt-8 flex gap-3">
                <Link 
                  href={detail.link || '/experiments/new'} 
                  onClick={() => handleComplete(activeOrbit)}
                  className="btn-primary flex-1 justify-center text-[15px] py-2.5"
                >
                  {detail.actionLabel || 'Run test scenario'}
                </Link>
                {completedOrbits.includes(activeOrbit) && activeOrbit < ORBITS.length - 1 && (
                  <button onClick={() => setActiveOrbit(activeOrbit + 1)} className="btn-secondary px-4 hover:bg-slate-50 text-slate-600">Next →</button>
                )}
              </div>
            )}
          </div>

          {/* Number Paginator */}
          <div className="mt-6 flex flex-wrap gap-2 justify-center">
            {ORBITS.map((orbit) => {
              const isLocked = orbit.id > highestUnlocked;
              const isCompleted = completedOrbits.includes(orbit.id);
              return (
                <button
                  key={orbit.id}
                  onClick={() => !isLocked && setActiveOrbit(orbit.id)}
                  disabled={isLocked}
                  className={`flex h-8 w-8 items-center justify-center rounded-md text-[13px] font-medium transition-all ${
                    activeOrbit === orbit.id
                      ? 'bg-slate-900 text-white shadow-sm'
                      : isLocked
                        ? 'bg-slate-50 text-slate-300 cursor-not-allowed border border-slate-100'
                        : isCompleted
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {orbit.id}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
