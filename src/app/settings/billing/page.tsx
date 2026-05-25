'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BILLING_PLANS,
  createBillingInvoice,
  formatBillingAmount,
  getBillingSummary,
  savePaymentMethod,
  selectBillingPlan,
  type BillingPlan,
  type BillingPlanId,
  type BillingSummary,
} from '@/lib/workspaceStore';

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function UsageMeter({
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
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="tabular text-slate-500">
          {unlimited ? `${formatNumber(used)} used / unlimited` : `${formatNumber(used)} used / ${formatNumber(remaining ?? 0)} left`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-[#2f5ae0]" style={{ width: unlimited ? '100%' : `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs tabular text-slate-400">
        {unlimited ? `${formatNumber(used)} used, unlimited included` : `${formatNumber(used)} of ${formatNumber(limit)}`}
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  active,
  onSelect,
  onContactSales,
}: {
  plan: BillingPlan;
  active: boolean;
  onSelect: (planId: BillingPlanId) => void;
  onContactSales: () => void;
}) {
  const isScale = plan.id === 'scale';

  return (
    <div className={`rounded-lg border bg-white p-4 ${active ? 'border-[#2f5ae0] ring-2 ring-[#dfe6ff]' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-medium text-slate-900">{plan.name}</p>
          <p className="mt-1 text-xs text-slate-500">{plan.audience}</p>
        </div>
        {active ? <span className="status-pill-running">Active</span> : null}
      </div>
      <div className="mt-4 space-y-2 text-sm text-slate-600">
        {plan.features.map((feature) => (
          <div key={feature} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f5ae0]" />
            <span>{feature}</span>
          </div>
        ))}
      </div>
      <button
        className={`mt-5 w-full ${active ? 'btn-secondary' : 'btn-primary'}`}
        onClick={() => (isScale ? onContactSales() : onSelect(plan.id))}
      >
        {active ? 'Current plan' : isScale ? 'Contact Sales' : `Switch to ${plan.name}`}
      </button>
    </div>
  );
}

function ContactSalesModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-sm">
      <form
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.02em] text-slate-900">Contact sales</h2>
            <p className="mt-1 text-sm text-slate-500">Tell us what you need for Scale.</p>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-800">Work email</span>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className="input-field" type="email" defaultValue="ayush@company.com" required />
              <span className="inline-flex items-center rounded-md border border-[#c7e8d9] bg-[#edf7f2] px-2 text-xs text-[#245b4c]">
                Verified
              </span>
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-800">Name</span>
            <input className="input-field" defaultValue="Ayush Saxena" required />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-800">What do you want to talk about?</span>
            <textarea className="input-field min-h-28 resize-none" placeholder="SLA, call volume, procurement, security review..." required />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Send request
          </button>
        </div>
      </form>
    </div>
  );
}

export default function BillingSettingsPage() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [notice, setNotice] = useState('');
  const [showSalesModal, setShowSalesModal] = useState(false);

  const refresh = () => setSummary(getBillingSummary());

  useEffect(() => {
    refresh();
    window.addEventListener('lightcurve-workspace-updated', refresh);
    return () => window.removeEventListener('lightcurve-workspace-updated', refresh);
  }, []);

  function choosePlan(planId: BillingPlanId) {
    selectBillingPlan(planId);
    const plan = BILLING_PLANS.find((item) => item.id === planId);
    setNotice(`${plan?.name ?? 'Plan'} selected for this workspace.`);
  }

  function addPaymentMethod() {
    savePaymentMethod();
    setNotice('Payment method added.');
  }

  function billWorkspace() {
    const invoice = createBillingInvoice();
    setNotice(`${invoice.id} created for ${formatBillingAmount(invoice.amountCents)}.`);
  }

  function submitSalesRequest() {
    setShowSalesModal(false);
    setNotice('Sales request sent. We will follow up on Scale, SLA, and unlimited usage.');
  }

  if (!summary) {
    return (
      <div className="space-y-5">
        <div className="page-header">
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Review plan usage, invoices, and payment settings.</p>
        </div>
        <div className="card h-48 animate-pulse bg-slate-50" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {showSalesModal ? <ContactSalesModal onClose={() => setShowSalesModal(false)} onSubmit={submitSalesRequest} /> : null}

      <div className="page-header">
        <h1 className="page-title">Billing</h1>
        <p className="page-subtitle">Review plan usage, invoices, and payment settings.</p>
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
                  {summary.plan.id === 'scale' ? 'Custom' : formatBillingAmount(summary.invoiceAmountCents)}
                </p>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-base font-medium text-slate-900">{summary.plan.name} plan</p>
                    <p className="mt-1 text-sm text-slate-500">{summary.plan.audience}</p>
                  </div>
                  <span className="status-pill-running">Active</span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <UsageMeter
                    label="Minutes"
                    used={summary.minutesUsed}
                    limit={summary.plan.minutesLimit}
                    remaining={summary.minutesRemaining}
                    percent={summary.minutesPercent}
                  />
                  <UsageMeter
                    label="Actions"
                    used={summary.actionsUsed}
                    limit={summary.plan.actionsLimit}
                    remaining={summary.actionsRemaining}
                    percent={summary.actionsPercent}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {BILLING_PLANS.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    active={plan.id === summary.plan.id}
                    onSelect={choosePlan}
                    onContactSales={() => setShowSalesModal(true)}
                  />
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Payment method</p>
                    <p className="mt-1 text-sm leading-5 text-slate-500">
                      {summary.paymentMethod ?? 'No payment method on file.'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button className="toolbar-button" onClick={addPaymentMethod}>
                      {summary.paymentMethod ? 'Update payment method' : 'Add payment method'}
                    </button>
                    <button className="toolbar-button toolbar-button-primary" onClick={billWorkspace}>
                      Bill workspace
                    </button>
                  </div>
                </div>
              </div>

              {notice ? (
                <div className="rounded-lg border border-[#cfd8ff] bg-[#f6f8ff] px-4 py-3 text-sm text-[#2448bb]">
                  {notice}
                </div>
              ) : null}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold tracking-[-0.02em] text-slate-900">Invoices</h2>
            </div>
            <table className="data-table">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="table-header px-4 py-3 text-left">Invoice</th>
                  <th className="table-header px-4 py-3 text-left">Date</th>
                  <th className="table-header px-4 py-3 text-left">Plan</th>
                  <th className="table-header px-4 py-3 text-left">Amount</th>
                  <th className="table-header px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-4 py-3 text-slate-800">{invoice.id}</td>
                    <td className="px-4 py-3 text-slate-600">{invoice.date}</td>
                    <td className="px-4 py-3 text-slate-600">{invoice.planName}</td>
                    <td className="px-4 py-3 text-slate-600">{formatBillingAmount(invoice.amountCents)}</td>
                    <td className="px-4 py-3 text-slate-600">{invoice.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
