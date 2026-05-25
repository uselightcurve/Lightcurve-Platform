'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getBillingSummary, type BillingSummary } from '@/lib/workspaceStore';

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function UsageRow({
  label,
  used,
  limit,
  remaining,
  percent,
}: {
  label: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number;
}) {
  const unlimited = limit === null;

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-slate-500">
        <span>{label}</span>
        <span className="tabular">
          {unlimited ? `${formatNumber(used)} used` : `${formatNumber(used)} of ${formatNumber(limit)}`}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_52px] items-center gap-2">
        <span className="h-1 overflow-hidden rounded-full bg-slate-200">
          <span className="block h-full rounded-full bg-[#2f5ae0]" style={{ width: unlimited ? '100%' : `${percent}%` }} />
        </span>
        <span className="text-right text-[11px] tabular text-slate-400">{unlimited ? 'Unlimited' : `${formatNumber(remaining ?? 0)} left`}</span>
      </div>
    </div>
  );
}

export function BillingUsageCard() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);

  useEffect(() => {
    const load = () => setSummary(getBillingSummary());
    load();
    window.addEventListener('lightcurve-workspace-updated', load);
    return () => window.removeEventListener('lightcurve-workspace-updated', load);
  }, []);

  if (!summary) {
    return <div className="h-[132px] rounded-lg border border-slate-200 bg-slate-50" />;
  }

  return (
    <Link href="/settings/billing" className="block rounded-lg border border-slate-200 bg-slate-50 p-3 transition-colors hover:border-slate-300 hover:bg-white">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">{summary.plan.name} plan</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{summary.plan.audience}</p>
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        <UsageRow
          label="Minutes"
          used={summary.minutesUsed}
          limit={summary.plan.minutesLimit}
          remaining={summary.minutesRemaining}
          percent={summary.minutesPercent}
        />
        <UsageRow
          label="Actions"
          used={summary.actionsUsed}
          limit={summary.plan.actionsLimit}
          remaining={summary.actionsRemaining}
          percent={summary.actionsPercent}
        />
      </div>
    </Link>
  );
}
