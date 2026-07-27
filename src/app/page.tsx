'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScoreBar, StatusChip } from '@/components/PageActions';
import { OverviewMetricGrid } from '@/components/OverviewMetricGrid';
import { OrbitOnboarding } from '@/components/OrbitOnboarding';

const ONBOARDING_PROGRESS_KEY = 'lightcurve_onboarding_progress';
const ONBOARDING_COMPLETED_KEY = 'lightcurve_onboarding_completed';

type OverviewResponse = {
  panels: {
    calls: { value: number; series: number[] };
    mos: { value: number; series: number[] };
    task: { value: number; series: number[] };
    latency: { value: number; series: number[] };
    failures: { value: number; series: number[] };
    experiments: { value: number; series: number[] };
  };
  recentExperiments: Array<{ id: string; name: string; status: string | null; mos: number | null; date: string }>;
  failingCases: Array<{ runId: string; experimentId: string | null; name: string; reason: string; score: number }>;
};

type OnboardingResponse = {
  userId: string;
  sdkEverRegistered: boolean;
  onlineRuntimeCount: number;
};

function emptyOverview(): OverviewResponse {
  return {
    panels: {
      calls: { value: 0, series: [0] },
      mos: { value: 0, series: [0] },
      task: { value: 0, series: [0] },
      latency: { value: 0, series: [0] },
      failures: { value: 0, series: [0] },
      experiments: { value: 0, series: [0] },
    },
    recentExperiments: [],
    failingCases: [],
  };
}

const demoOverview: OverviewResponse = {
  panels: {
    calls: { value: 284, series: [28, 34, 41, 38, 52, 47, 44] },
    mos: { value: 4.1, series: [3.8, 3.9, 4.0, 4.1, 4.2, 4.1, 4.1] },
    task: { value: 87, series: [78, 80, 83, 85, 88, 87, 87] },
    latency: { value: 1240, series: [1.6, 1.5, 1.4, 1.3, 1.2, 1.3, 1.2] },
    failures: { value: 12, series: [3, 2, 1, 2, 1, 2, 1] },
    experiments: { value: 9, series: [1, 2, 3, 5, 6, 8, 9] },
  },
  recentExperiments: [
    { id: 'exp-001', name: 'Guardrail Test: Medical Advice', status: 'completed', mos: 4.2, date: 'Jul 6, 2026' },
    { id: 'exp-002', name: 'Booking Flow - Multi-room', status: 'completed', mos: 3.9, date: 'Jul 5, 2026' },
    { id: 'exp-003', name: 'Angry Customer Scenario', status: 'failed', mos: 2.8, date: 'Jul 5, 2026' },
    { id: 'exp-004', name: 'Accent Stress Test - Indian EN', status: 'completed', mos: 4.0, date: 'Jul 4, 2026' },
    { id: 'exp-005', name: 'Jailbreak Sweep - v3', status: 'running', mos: null, date: 'Jul 7, 2026' },
  ],
  failingCases: [
    { runId: 'run-001', experimentId: 'exp-003', name: 'Angry Customer - Refund Demand', reason: 'Agent failed to de-escalate and offered unauthorised refund.', score: 0.21 },
    { runId: 'run-002', experimentId: 'exp-002', name: 'Multi-room Booking - Child Pricing', reason: 'Incorrect occupancy pricing - child age surcharge skipped.', score: 0.34 },
    { runId: 'run-003', experimentId: 'exp-001', name: 'Prescription Request', reason: 'Agent prescribed medication without a valid doctor license.', score: 0.12 },
  ],
};

const demoOnboarding: OnboardingResponse = {
  userId: 'mock_demo_user',
  sdkEverRegistered: true,
  onlineRuntimeCount: 1,
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function statusFor(status: string | null) {
  if (status === 'completed' || status === 'complete' || status === 'pass') return 'pass';
  if (status === 'failed' || status === 'fail') return 'fail';
  if (status === 'running') return 'running';
  return 'pending';
}

export default function Home() {
  const [overview, setOverview] = useState<OverviewResponse>(() => demoOverview);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onboarding, setOnboarding] = useState<OnboardingResponse | null>(demoOnboarding);
  const [onboardingFinishedLocally, setOnboardingFinishedLocally] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsLocalhost(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    }
    const load = async () => {
      const onboardingResponse = await fetchWithTimeout('/api/onboarding', { cache: 'no-store' });
      if (!onboardingResponse.ok) {
        setLoading(false);
        return;
      }
      const onboardingBody = await onboardingResponse.json();
      setOnboarding(onboardingBody);
      try {
        const completedKey = `${ONBOARDING_COMPLETED_KEY}:${onboardingBody.userId}`;
        const progressKey = `${ONBOARDING_PROGRESS_KEY}:${onboardingBody.userId}`;
        if (localStorage.getItem(completedKey) === 'true') {
          setOnboardingFinishedLocally(true);
        } else {
          const stored = localStorage.getItem(progressKey);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.includes(7)) {
              localStorage.setItem(completedKey, 'true');
              setOnboardingFinishedLocally(true);
            }
          }
        }
      } catch (e) {}
      if (!onboardingBody.sdkEverRegistered) {
        setError('');
        setLoading(false);
        return;
      }
      const response = await fetchWithTimeout('/api/overview', { cache: 'no-store' });
      if (!response.ok) {
        setLoading(false);
        return;
      }
      setOverview(await response.json());
      setError('');
      setLoading(false);
    };
    load().catch(() => {
      setError('');
      setLoading(false);
    });
    
  }, []);

  const showOverview = onboarding?.sdkEverRegistered || onboardingFinishedLocally;

  const completeOnboardingLocally = useCallback(() => {
    if (onboarding?.userId) {
      localStorage.setItem(`${ONBOARDING_COMPLETED_KEY}:${onboarding.userId}`, 'true');
    }
    setOnboardingFinishedLocally(true);
  }, [onboarding?.userId]);

  const panels = useMemo(() => [
    {
      title: 'Calls',
      value: overview.panels.calls.value.toString(),
      href: '/experiments',
      icon: 'bubble',
      variant: 'line' as const,
      series: overview.panels.calls.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Avg MOS',
      value: overview.panels.mos.value ? overview.panels.mos.value.toFixed(1) : '-',
      href: '/experiments',
      icon: 'target',
      variant: 'line' as const,
      series: overview.panels.mos.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Task completion',
      value: overview.panels.task.value ? `${Math.round(overview.panels.task.value)}%` : '-',
      href: '/experiments',
      icon: 'check',
      variant: 'line' as const,
      series: overview.panels.task.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Latency p95',
      value: overview.panels.latency.value ? `${(overview.panels.latency.value / 1000).toFixed(1)}s` : '-',
      href: '/experiments',
      icon: 'clock',
      variant: 'line' as const,
      series: overview.panels.latency.series,
      labels: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    },
    {
      title: 'Failure topics',
      value: overview.panels.failures.value.toString(),
      href: '/experiments?tab=imports',
      icon: 'topic',
      variant: 'bars' as const,
      series: overview.panels.failures.series,
      labels: ['refund', 'billing', 'clinic', 'plan', 'outage', 'routing', 'payment'],
    },
    {
      title: 'Experiments',
      value: overview.panels.experiments.value.toString(),
      href: '/experiments',
      icon: 'flask',
      variant: 'line' as const,
      series: overview.panels.experiments.series,
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    },
  ], [overview]);

  return (
    <div className="space-y-4">
      {showOverview && (
        <div className="page-header">
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">Overview of your sandbox agent performance and recent test results.</p>
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {!loading && onboarding && !showOverview ? <div className="mb-6"><OrbitOnboarding storageKeySuffix={onboarding.userId} onReachEnd={completeOnboardingLocally} /></div> : null}

      {showOverview && onboarding?.onlineRuntimeCount === 0 && !onboarding.sdkEverRegistered ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>You&apos;ve explored all evaluation orbits. Start your sandbox testing environment with the SDK to record real data.</span>
          <Link href="/settings/sdk" className="font-medium underline">SDK setup</Link>
        </div>
      ) : showOverview && onboarding?.onlineRuntimeCount === 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Your SDK is installed but the test agent is currently offline. Start your application to record or replay calls.</span>
          <Link href="/settings/sdk" className="font-medium underline">SDK status</Link>
        </div>
      ) : null}

      {showOverview ? <><div className="flex flex-wrap items-center gap-2">
        <Link href="/playground" className="btn-primary">Open Sandbox</Link>
        <Link href="/experiments/new" className="btn-secondary">Create experiment</Link>
      </div>

      <OverviewMetricGrid panels={panels} />

      {!loading && !overview.recentExperiments.length && !overview.failingCases.length ? (
        <section className="card p-8 text-center">
          <h2 className="text-base font-medium text-slate-950">No sandbox runs yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Enable the SDK, record one sandbox call in the Playground, and Lightcurve will build your first replayable dataset.
          </p>
          <Link href="/experiments/new" className="btn-primary mt-5 inline-flex">Create first experiment</Link>
        </section>
      ) : (
        <div className="grid grid-cols-[1.25fr_0.75fr] gap-4">
          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Recent experiments</h2>
            </div>
            <table className="data-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="table-header px-4 py-3 text-left">Name</th>
                  <th className="table-header px-4 py-3 text-left">Status</th>
                  <th className="table-header px-4 py-3 text-left">MOS</th>
                  <th className="table-header px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {overview.recentExperiments.map((experiment) => (
                  <tr key={experiment.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 text-slate-800">{experiment.name}</td>
                    <td className="px-4 py-3"><StatusChip status={statusFor(experiment.status)} /></td>
                    <td className="min-w-[150px] px-4 py-3">
                      {experiment.mos ? <ScoreBar value={experiment.mos} max={4.5} /> : <span className="text-sm text-slate-400">Pending</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{experiment.date}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/experiments/${experiment.id}`} className="btn-secondary min-h-8 text-xs">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">Failing cases</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {overview.failingCases.length ? overview.failingCases.map((item) => (
                <div key={item.runId} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm text-slate-800">{item.name}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
                    <div className="mt-2">
                      <ScoreBar value={item.score} />
                    </div>
                  </div>
                  <Link href="/experiments/new" className="btn-secondary min-h-8 self-start text-xs">Re-run</Link>
                </div>
              )) : (
                <div className="px-4 py-8 text-sm text-slate-500">No failed cases yet.</div>
              )}
            </div>
          </section>
        </div>
      )}</> : null}
    </div>
  );
}
