import Link from 'next/link';
import { getBillingSummary, requireAccount } from '@/lib/account';
import { PLANS, type Plan } from '@/lib/plans';
import { BillingActions } from './BillingActions';

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function formatAmount(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function UsageMeter({
  label,
  used,
  limit,
  percent,
}: {
  label: string;
  used: number;
  limit: number | null;
  percent: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="tabular text-slate-500">
          {limit === null ? `${formatNumber(used)} used / unlimited` : `${formatNumber(used)} of ${formatNumber(limit)}`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-[#2f5ae0]" style={{ width: limit === null ? '100%' : `${percent}%` }} />
      </div>
    </div>
  );
}

function PlanCard({ plan, active }: { plan: Plan; active: boolean }) {
  return (
    <div className={`rounded-lg border bg-white p-4 ${active ? 'border-[#2f5ae0] ring-2 ring-[#dfe6ff]' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-medium text-slate-900">{plan.name}</p>
          <p className="mt-1 text-xs text-slate-500">{plan.audience}</p>
        </div>
        {active ? <span className="status-pill-running">Active</span> : null}
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-slate-950">{plan.priceLabel}</p>
      <div className="mt-4 space-y-2 text-sm text-slate-600">
        {plan.features.map((feature) => (
          <div key={feature} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f5ae0]" />
            <span>{feature}</span>
          </div>
        ))}
      </div>
      <BillingActions planId={plan.id} active={active} />
    </div>
  );
}

export default async function BillingSettingsPage() {
  const account = await requireAccount();
  const summary = await getBillingSummary(account.userId);
  const activePlan = summary.plan.id;

  return (
    <div className="space-y-5">
      <div className="page-header">
        <h1 className="page-title">Billing</h1>
        <p className="page-subtitle">Review free-tier usage. Pro checkout stays disabled until payment webhooks are verified.</p>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-5">
        <aside className="card p-2">
          <Link href="/settings/profile" className="flex h-9 items-center rounded-md px-3 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Your profile
          </Link>
          <Link href="/settings/billing" className="flex h-9 items-center rounded-md bg-slate-100 px-3 text-sm font-medium text-slate-900">
            Billing
          </Link>
        </aside>

        <section className="space-y-4">
          <div className="card overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold tracking-[-0.02em] text-slate-900">Plan and usage</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {summary.plan.name} plan for {summary.plan.audience.toLowerCase()}.
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">Current bill</p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.02em] text-slate-900">
                  {summary.plan.id === 'scale' ? 'Custom' : formatAmount(summary.plan.monthlyCents)}
                </p>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-base font-medium text-slate-900">{summary.plan.name} plan</p>
                    <p className="mt-1 text-sm text-slate-500">Subscription status: {summary.subscription.status}</p>
                  </div>
                  <span className="status-pill-running">Active</span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <UsageMeter label="Minutes" used={summary.minutesUsed} limit={summary.plan.minutesLimit} percent={summary.minutesPercent} />
                  <UsageMeter label="Actions" used={summary.actionsUsed} limit={summary.plan.actionsLimit} percent={summary.actionsPercent} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {Object.values(PLANS).map((plan) => (
                  <PlanCard key={plan.id} plan={plan} active={plan.id === activePlan} />
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-sm font-medium text-slate-900">Payment management</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  Tomorrow's pilot runs on Starter limits only. Pro checkout will be enabled after the Dodo product and webhook are verified end to end.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
