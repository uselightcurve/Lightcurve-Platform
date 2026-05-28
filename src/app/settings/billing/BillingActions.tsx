'use client';

import { useState } from 'react';
import type { PlanId } from '@/lib/plans';

function ContactSalesModal({ onClose }: { onClose: () => void }) {
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch('/api/billing/contact-sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        message: form.get('message'),
      }),
    });
    setSent(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 p-6 backdrop-blur-sm">
      <form className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl" onSubmit={submit}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.02em] text-slate-900">Contact sales</h2>
            <p className="mt-1 text-sm text-slate-500">Scale includes unlimited usage, SLA, and enterprise support.</p>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700" onClick={onClose}>
            x
          </button>
        </div>

        {sent ? (
          <div className="mt-5 rounded-lg border border-[#c7e8d9] bg-[#edf7f2] p-4 text-sm text-[#245b4c]">
            Sales request received. We will follow up on SLA, volume, and security review.
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-800">Name</span>
              <input className="input-field" name="name" required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-800">What do you want to talk about?</span>
              <textarea className="input-field min-h-28 resize-none" name="message" placeholder="SLA, call volume, procurement, security review..." required />
            </label>
            <button type="submit" className="btn-primary w-full">Send request</button>
          </div>
        )}
      </form>
    </div>
  );
}

export function BillingActions({ planId, active }: { planId: PlanId; active: boolean }) {
  const [loading, setLoading] = useState(false);
  const [showSales, setShowSales] = useState(false);

  async function upgrade() {
    setLoading(true);
    try {
      const response = await fetch('/api/billing/checkout', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Checkout failed');
      window.location.href = data.checkoutUrl;
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Checkout failed');
    } finally {
      setLoading(false);
    }
  }

  if (planId === 'scale') {
    return (
      <>
        {showSales ? <ContactSalesModal onClose={() => setShowSales(false)} /> : null}
        <button className="mt-5 w-full btn-primary" onClick={() => setShowSales(true)}>
          Contact Sales
        </button>
      </>
    );
  }

  if (active) {
    return <button className="mt-5 w-full btn-secondary" disabled>Current plan</button>;
  }

  return (
    <button className="mt-5 w-full btn-primary" onClick={upgrade} disabled={loading || planId !== 'pro'}>
      {loading ? 'Opening checkout' : 'Upgrade to Pro'}
    </button>
  );
}
