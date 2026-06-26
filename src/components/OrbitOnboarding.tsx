'use client';

import { useState } from 'react';
import Link from 'next/link';

const ORBITS = [
  { id: 0, radius: 60, color: '#e2e8f0', stroke: '#cbd5e1', label: 'Setup & Wiring' },
  { id: 1, radius: 95, color: '#fef3c7', stroke: '#fde68a', label: 'Does the Job' },
  { id: 2, radius: 130, color: '#ffedd5', stroke: '#fed7aa', label: 'Plays by the Rules' },
  { id: 3, radius: 165, color: '#fce7f3', stroke: '#fbcfe8', label: 'Hard to Trick' },
  { id: 4, radius: 200, color: '#f3e8ff', stroke: '#e9d5ff', label: 'Speech Variations' },
  { id: 5, radius: 235, color: '#e0f2fe', stroke: '#bae6fd', label: 'Handles Real People' },
  { id: 6, radius: 270, color: '#dbeafe', stroke: '#bfdbfe', label: 'Works in Real World' },
  { id: 7, radius: 305, color: '#dcfce7', stroke: '#bbf7d0', label: 'Handles Chaos' },
];

const ORBIT_DETAILS = [
  {
    title: 'Structural Integrity',
    description: 'Is your agent plugged in and ready to talk? Let\'s connect the SDK with two lines of code so Lightcurve can start listening.',
    actionType: 'setup',
  },
  {
    title: 'Basic Competency',
    description: 'Can it actually do what it was hired for? We test if the agent successfully completes the happy-path objective.',
    actionType: 'test',
  },
  {
    title: 'Adherence to Playbook',
    description: 'Does the agent stay on script? We test if it follows your strict rules and boundaries without hallucinating.',
    actionType: 'test',
  },
  {
    title: 'Security & Jailbreaks',
    description: 'Can customers trick your agent into giving them free money? We throw aggressive prompts at your agent to make sure it holds the line.',
    actionType: 'test',
  },
  {
    title: 'Acoustic Resilience',
    description: 'What happens if a customer has a heavy accent, stutters, or uses slang? We test the STT pipeline to ensure understanding.',
    actionType: 'test',
  },
  {
    title: 'Conversational Dynamics',
    description: 'Real people interrupt, pause, and talk over you. We test barge-in handling and latency under pressure.',
    actionType: 'test',
  },
  {
    title: 'Environmental Chaos',
    description: 'Barking dogs, poor cell reception, driving in a tunnel. We test how the agent handles extreme background noise.',
    actionType: 'test',
  },
  {
    title: 'Total System Failure',
    description: 'What happens when your underlying LLM provider goes down? We simulate 502s to test graceful degradation.',
    actionType: 'test',
  }
];

export function OrbitOnboarding() {
  const [activeOrbit, setActiveOrbit] = useState(0);

  const detail = ORBIT_DETAILS[activeOrbit];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_2px_12px_rgb(0,0,0,0.02)]">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Know Your Orbits</h2>
          <p className="mt-1 text-sm text-slate-500">Click any orbit to explore what it tests and why it matters.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="flex h-2 w-2 rounded-full bg-slate-300" /> Outer orbits = harder to pass
        </div>
      </div>

      <div className="grid gap-12 lg:grid-cols-[1fr_400px]">
        {/* SVG Diagram Area */}
        <div className="relative flex items-end justify-center overflow-hidden pt-4 pb-2">
          <svg width="650" height="340" viewBox="-325 -320 650 340" className="overflow-visible">
            {/* Draw from outer to inner to ensure proper overlapping, but we want hover to be precise. 
                Using fill-opacity handles layering nicely. */}
            {[...ORBITS].reverse().map((orbit) => {
              const isActive = activeOrbit === orbit.id;
              // Arc path for semi-circle
              const path = `M -${orbit.radius} 0 A ${orbit.radius} ${orbit.radius} 0 0 1 ${orbit.radius} 0 L 0 0 Z`;
              return (
                <g key={orbit.id} className="cursor-pointer transition-all duration-300" onClick={() => setActiveOrbit(orbit.id)}>
                  <path
                    d={path}
                    fill={orbit.color}
                    fillOpacity={isActive ? 0.9 : 0.4}
                    stroke={isActive ? orbit.stroke : 'transparent'}
                    strokeWidth="2"
                    className="transition-all duration-300 hover:fill-opacity-75"
                  />
                  {/* Label path for text - placing slightly inside the top arc */}
                  <path
                    id={`path-${orbit.id}`}
                    d={`M -${orbit.radius - 8} 0 A ${orbit.radius - 8} ${orbit.radius - 8} 0 0 1 ${orbit.radius - 8} 0`}
                    fill="none"
                    stroke="none"
                  />
                  {orbit.radius > 60 && (
                    <text className="pointer-events-none select-none fill-slate-500 text-[10px] font-medium transition-all duration-300" opacity={isActive ? 1 : 0.6}>
                      <textPath href={`#path-${orbit.id}`} startOffset="50%" textAnchor="middle">
                        {orbit.label}
                      </textPath>
                    </text>
                  )}
                </g>
              );
            })}
            
            {/* Center Agent Node */}
            <circle cx="0" cy="0" r="30" fill="url(#agentGradient)" className="shadow-lg" />
            <text x="0" y="5" className="pointer-events-none select-none fill-slate-700 text-xs font-bold" textAnchor="middle">Agent</text>
            
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
          <div className="relative rounded-xl border border-slate-200 bg-[#fbfcfe] p-6 shadow-sm transition-all">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
              <span className="flex h-2 w-2 rounded-full" style={{ background: ORBITS[activeOrbit].stroke }} />
              Orbit {activeOrbit} · {ORBITS[activeOrbit].label}
            </div>
            
            <h3 className="text-lg font-bold text-slate-900">{detail.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{detail.description}</p>
            
            {detail.actionType === 'setup' ? (
              <div className="mt-6">
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">Node.js Pipecat Snippet</div>
                  <pre className="bg-white p-3 text-[11px] leading-relaxed text-slate-800 overflow-x-auto">
                    <code>
{`import { Lightcurve } from '@use-lightcurve/sdk';

const lightcurve = new Lightcurve({
  apiKey: process.env.LIGHTCURVE_API_KEY
});

// Wrap your agent
lightcurve.monitor(agent);`}
                    </code>
                  </pre>
                </div>
                <Link href="/settings/sdk" className="btn-primary mt-4 w-full justify-center shadow-sm">Get my API Key</Link>
              </div>
            ) : (
              <div className="mt-6">
                <Link href="/experiments/new" className="btn-secondary w-full justify-center shadow-sm">Run test scenario</Link>
              </div>
            )}
          </div>

          {/* Number Paginator */}
          <div className="mt-6 flex flex-wrap gap-2">
            {ORBITS.map((orbit) => (
              <button
                key={orbit.id}
                onClick={() => setActiveOrbit(orbit.id)}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                  activeOrbit === orbit.id
                    ? 'bg-slate-800 text-white shadow-md'
                    : 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {orbit.id}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
