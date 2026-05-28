import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { createProCheckout } from '@/lib/dodo';
import { trackServerEvent } from '@/lib/serverAnalytics';

export async function POST() {
  try {
    const account = await requireAccount();
    const checkout = await createProCheckout(account);
    if (!checkout.checkout_url) {
      return NextResponse.json({ error: 'Dodo did not return a checkout URL.' }, { status: 502 });
    }
    await trackServerEvent(account, 'Checkout Started', {
      plan: 'pro',
      provider: 'dodo',
      session_id: checkout.session_id,
    });
    return NextResponse.json({ checkoutUrl: checkout.checkout_url, sessionId: checkout.session_id });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create Dodo checkout', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout could not be created' },
      { status: 500 },
    );
  }
}
