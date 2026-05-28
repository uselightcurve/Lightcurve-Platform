import { NextResponse } from 'next/server';
import { getBillingSummary, requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET() {
  try {
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
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load billing summary', error);
    return NextResponse.json({ error: 'Billing summary unavailable' }, { status: 500 });
  }
}
