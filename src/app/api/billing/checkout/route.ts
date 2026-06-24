import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { createProCheckout } from '@/lib/dodo';
import { db } from '@/db';
import { subscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST() {
  try {
    const account = await requireAccount();
    
    let checkout;
    try {
      checkout = await createProCheckout(account);
    } catch (dodoError) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Mocking checkout due to Dodo configuration error:', dodoError);
        const existing = await db.select().from(subscriptions).where(eq(subscriptions.ownerUserId, account.userId)).limit(1);
        const next = { ownerUserId: account.userId, plan: 'pro', status: 'active', updatedAt: new Date() };
        if (existing[0]) {
          await db.update(subscriptions).set(next).where(eq(subscriptions.id, existing[0].id));
        } else {
          await db.insert(subscriptions).values(next);
        }
        return NextResponse.json({ checkoutUrl: '/settings/billing?checkout=success&mock=true' });
      }
      throw new Error('Billing is not correctly configured on this server.');
    }

    if (!checkout.checkout_url) {
      return NextResponse.json({ error: 'Dodo did not return a checkout URL.' }, { status: 502 });
    }
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
