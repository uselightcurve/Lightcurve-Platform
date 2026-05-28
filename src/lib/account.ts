import { auth, currentUser } from '@clerk/nextjs/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { subscriptions, usageEvents, users } from '@/db/schema';
import { planFor, type PlanId } from '@/lib/plans';

export type AccountContext = {
  userId: string;
  email: string;
  name: string;
};

export async function requireAccount(): Promise<AccountContext> {
  const { userId } = await auth();
  if (!userId) {
    throw new Response('Unauthorized', { status: 401 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  if (!email) {
    throw new Response('User email is required', { status: 400 });
  }
  const name = user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ') ?? '';
  const now = new Date();

  await db
    .insert(users)
    .values({ id: userId, email, name, updatedAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { email, name, updatedAt: now },
    });

  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerUserId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  if (!existing.length) {
    await db.insert(subscriptions).values({
      ownerUserId: userId,
      plan: 'starter',
      status: 'active',
    });
  }

  return { userId, email, name };
}

export function unauthorizedJson(error: unknown) {
  if (error instanceof Response && error.status === 401) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof Response) {
    return Response.json({ error: error.statusText || 'Request failed' }, { status: error.status });
  }
  return null;
}

export async function getBillingSummary(userId: string) {
  const subscriptionRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerUserId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  const subscription = subscriptionRows[0] ?? {
    plan: 'starter',
    status: 'active',
    dodoCustomerId: null,
    dodoSubscriptionId: null,
    currentPeriodEnd: null,
  };
  const plan = planFor(subscription.plan);

  const [usage] = await db
    .select({
      minutesUsed: sql<number>`coalesce(sum(${usageEvents.minutes}), 0)`,
      actionsUsed: sql<number>`coalesce(sum(${usageEvents.actions}), 0)`,
    })
    .from(usageEvents)
    .where(eq(usageEvents.ownerUserId, userId));

  const minutesUsed = Number(usage?.minutesUsed ?? 0);
  const actionsUsed = Number(usage?.actionsUsed ?? 0);
  const minutesRemaining = plan.minutesLimit === null ? null : Math.max(0, plan.minutesLimit - minutesUsed);
  const actionsRemaining = plan.actionsLimit === null ? null : Math.max(0, plan.actionsLimit - actionsUsed);

  return {
    plan,
    subscription,
    minutesUsed,
    actionsUsed,
    minutesRemaining,
    actionsRemaining,
    minutesPercent: plan.minutesLimit === null ? 0 : Math.min(100, Math.round((minutesUsed / plan.minutesLimit) * 100)),
    actionsPercent: plan.actionsLimit === null ? 0 : Math.min(100, Math.round((actionsUsed / plan.actionsLimit) * 100)),
  };
}

export async function assertUsageAvailable(
  userId: string,
  required: { actions?: number; minutes?: number; imports?: boolean },
) {
  const summary = await getBillingSummary(userId);
  if (required.imports && !summary.plan.importsEnabled) {
    throw new Response('Upgrade to Pro to import production calls.', { status: 402 });
  }
  if (
    summary.plan.actionsLimit !== null &&
    !summary.plan.overageEnabled &&
    summary.actionsUsed + (required.actions ?? 0) > summary.plan.actionsLimit
  ) {
    throw new Response('Eval action limit reached. Upgrade to Pro to continue.', { status: 402 });
  }
  if (
    summary.plan.minutesLimit !== null &&
    !summary.plan.overageEnabled &&
    summary.minutesUsed + (required.minutes ?? 0) > summary.plan.minutesLimit
  ) {
    throw new Response('Sandbox minute limit reached. Upgrade to Pro to continue.', { status: 402 });
  }
}

export async function recordUsageEvent(params: {
  userId: string;
  eventType: string;
  actions?: number;
  minutes?: number;
  sourceRunId?: string;
  sourceExperimentId?: string;
}) {
  await db.insert(usageEvents).values({
    ownerUserId: params.userId,
    eventType: params.eventType,
    actions: params.actions ?? 0,
    minutes: params.minutes ?? 0,
    sourceRunId: params.sourceRunId,
    sourceExperimentId: params.sourceExperimentId,
  });
}

export function ownerFilter<TColumn>(column: TColumn, userId: string) {
  return and(eq(column as any, userId));
}

export type { PlanId };
