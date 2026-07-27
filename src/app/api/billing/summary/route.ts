import { NextResponse } from 'next/server';
import { isMockMode } from '@/lib/mockData';
import { PLANS } from '@/lib/plans';

export async function GET() {
  if (isMockMode()) {
    return NextResponse.json({
      plan: PLANS.pro,
      minutesUsed: 47,
      minutesRemaining: PLANS.pro.minutesLimit === null ? null : PLANS.pro.minutesLimit - 47,
      minutesPercent: 1,
      actionsUsed: 284,
      actionsRemaining: PLANS.pro.actionsLimit === null ? null : PLANS.pro.actionsLimit - 284,
      actionsPercent: 1,
      fixesUsed: 8,
      fixesRemaining: PLANS.pro.fixesLimit === null ? null : PLANS.pro.fixesLimit - 8,
      fixesPercent: 1,
      callCount: 284,
      subscription: {
        status: 'active',
        currentPeriodEnd: new Date('2026-08-07').toISOString(),
        dodoCustomerId: 'demo_cust',
        dodoSubscriptionId: 'demo_sub',
      },
    });
  }
  try {
    const { getBillingSummary, requireAccount, unauthorizedJson } = await import('@/lib/account');
    const account = await requireAccount();
    const summary = await getBillingSummary(account.userId);

    return NextResponse.json({
      ...summary,
      subscription: {
        status: summary.subscription.status,
        currentPeriodEnd: summary.subscription.currentPeriodEnd,
        dodoCustomerId: summary.subscription.dodoCustomerId,
        dodoSubscriptionId: summary.subscription.dodoSubscriptionId,
      },
    });
  } catch (error) {
    const { unauthorizedJson } = await import('@/lib/account');
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load billing summary', error);
    return NextResponse.json({ error: 'Billing summary unavailable' }, { status: 500 });
  }
}
