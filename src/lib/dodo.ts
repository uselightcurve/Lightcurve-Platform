import DodoPayments from 'dodopayments';

type DodoEnvironment = 'test_mode' | 'live_mode';

function dodoEnvironment(): DodoEnvironment {
  if (process.env.DODO_ENVIRONMENT === 'live_mode') return 'live_mode';
  if (process.env.DODO_ENVIRONMENT === 'test_mode') return 'test_mode';
  
  // Auto-detect based on key prefix
  if (process.env.DODO_PAYMENTS_API_KEY?.startsWith('live_') || process.env.DODO_PAYMENTS_API_KEY?.startsWith('sk_live_')) {
    return 'live_mode';
  }
  return 'test_mode';
}

export function getDodoClient() {
  if (!process.env.DODO_PAYMENTS_API_KEY) {
    throw new Error('DODO_PAYMENTS_API_KEY is not configured.');
  }
  return new DodoPayments({
    bearerToken: process.env.DODO_PAYMENTS_API_KEY,
    webhookKey: process.env.DODO_WEBHOOK_KEY ?? process.env.DODO_PAYMENTS_WEBHOOK_KEY,
    environment: dodoEnvironment(),
  });
}

export async function createProCheckout(params: {
  userId: string;
  email: string;
  name: string;
}) {
  if (!process.env.DODO_PRO_PRODUCT_ID) {
    throw new Error('DODO_PRO_PRODUCT_ID is not configured.');
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.uselightcurve.com').replace(/\/$/, '');
  const returnUrl = process.env.DODO_RETURN_URL ?? `${appUrl}/settings/billing`;
  const client = getDodoClient();

  return client.checkoutSessions.create({
    product_cart: [{ product_id: process.env.DODO_PRO_PRODUCT_ID, quantity: 1 }],
    customer: {
      email: params.email,
      name: params.name || params.email,
    },
    return_url: returnUrl,
    cancel_url: `${appUrl}/settings/billing?checkout=cancelled`,
    metadata: {
      clerkUserId: params.userId,
      plan: 'pro',
      app: 'lightcurve',
    },
    feature_flags: {
      allow_customer_editing_email: false,
      allow_customer_editing_name: true,
      redirect_immediately: true,
    },
  });
}
