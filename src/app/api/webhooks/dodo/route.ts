import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { billingEvents, subscriptions, users } from '@/db/schema';
import { getDodoClient } from '@/lib/dodo';

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function eventId(headers: Headers, payload: Record<string, any>) {
  return headers.get('webhook-id') ?? headers.get('svix-id') ?? payload.id ?? `${payload.type}-${payload.timestamp}`;
}

async function resolveOwnerUserId(data: Record<string, any>) {
  const metadata = asRecord(data.metadata);
  const userId = metadata.clerkUserId ?? metadata.clerk_user_id ?? metadata.ownerUserId;
  if (typeof userId === 'string' && userId) return userId;

  const email = data.customer?.email ?? data.customer_email;
  if (typeof email === 'string' && email) {
    const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return found[0]?.id;
  }
  return undefined;
}

function periodDate(value: unknown) {
  return typeof value === 'string' && value ? new Date(value) : undefined;
}

async function syncSubscription(eventType: string, data: Record<string, any>, ownerUserId: string) {
  const activeTypes = new Set(['subscription.active', 'subscription.updated', 'subscription.renewed']);
  const lockedTypes = new Set(['subscription.on_hold', 'subscription.failed', 'subscription.cancelled', 'subscription.expired']);
  const plan = activeTypes.has(eventType) ? 'pro' : lockedTypes.has(eventType) ? 'starter' : undefined;
  if (!plan) return;

  const now = new Date();
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerUserId, ownerUserId))
    .limit(1);

  const next = {
    ownerUserId,
    plan,
    status: data.status ?? (plan === 'pro' ? 'active' : 'inactive'),
    dodoCustomerId: data.customer?.customer_id ?? data.customer_id,
    dodoSubscriptionId: data.subscription_id,
    currentPeriodStart: periodDate(data.previous_billing_date),
    currentPeriodEnd: periodDate(data.next_billing_date),
    updatedAt: now,
  };

  if (existing[0]) {
    await db.update(subscriptions).set(next).where(eq(subscriptions.id, existing[0].id));
  } else {
    await db.insert(subscriptions).values(next);
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  let event: any;

  try {
    const client = getDodoClient();
    event = client.webhooks.unwrap(body, {
      headers: Object.fromEntries(req.headers.entries()),
      key: process.env.DODO_WEBHOOK_KEY ?? process.env.DODO_PAYMENTS_WEBHOOK_KEY,
    });
  } catch (error) {
    console.error('Dodo webhook verification failed', error);
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  const payload = asRecord(event);
  const id = eventId(req.headers, payload);
  const type = String(payload.type ?? 'unknown');
  const data = asRecord(payload.data);
  const ownerUserId = await resolveOwnerUserId(data);

  try {
    await db.insert(billingEvents).values({
      id,
      eventType: type,
      ownerUserId,
      payload,
    });
  } catch {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (ownerUserId) {
    await syncSubscription(type, data, ownerUserId);
  }

  return NextResponse.json({ ok: true });
}
