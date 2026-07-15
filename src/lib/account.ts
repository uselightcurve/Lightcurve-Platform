import { auth, currentUser } from '@clerk/nextjs/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { runs, subscriptions, usageEvents, users } from '@/db/schema';
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

  const usageRows = await db
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.ownerUserId, userId));

  const runLinkedUsageIds = Array.from(
    new Set(usageRows.map((event) => event.sourceRunId).filter((id): id is string => Boolean(id))),
  );
  const completedRunIds = new Set<string>();
  if (runLinkedUsageIds.length) {
    const completedRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.ownerUserId, userId), eq(runs.status, 'complete'), inArray(runs.id, runLinkedUsageIds)));
    completedRuns.forEach((run) => completedRunIds.add(run.id));
  }

  const billableUsageRows = usageRows.filter((event) => !event.sourceRunId || completedRunIds.has(event.sourceRunId));
  const minutesUsed = billableUsageRows.reduce((sum, event) => sum + Math.max(0, Number(event.minutes ?? 0)), 0);
  const actionsUsed = billableUsageRows.reduce((sum, event) => sum + Math.max(0, Number(event.actions ?? 0)), 0);
  const minutesCredits = billableUsageRows.reduce((sum, event) => sum + Math.max(0, -Number(event.minutes ?? 0)), 0);
  const actionsCredits = billableUsageRows.reduce((sum, event) => sum + Math.max(0, -Number(event.actions ?? 0)), 0);
  const fixesUsed = billableUsageRows.reduce((sum, event) => sum + (event.eventType === 'fix_generated' ? 1 : 0), 0);
  const effectiveMinutesLimit = plan.minutesLimit === null ? null : plan.minutesLimit + minutesCredits;
  const effectiveActionsLimit = plan.actionsLimit === null ? null : plan.actionsLimit + actionsCredits;
  const minutesRemaining = effectiveMinutesLimit === null ? null : Math.max(0, effectiveMinutesLimit - minutesUsed);
  const actionsRemaining = effectiveActionsLimit === null ? null : Math.max(0, effectiveActionsLimit - actionsUsed);
  const fixesRemaining = plan.fixesLimit === null ? null : Math.max(0, plan.fixesLimit - fixesUsed);

  return {
    plan,
    subscription,
    minutesUsed,
    actionsUsed,
    minutesCredits,
    actionsCredits,
    fixesUsed,
    minutesRemaining,
    actionsRemaining,
    fixesRemaining,
    minutesPercent: effectiveMinutesLimit === null || effectiveMinutesLimit === 0 ? 0 : Math.min(100, Math.round((minutesUsed / effectiveMinutesLimit) * 100)),
    actionsPercent: effectiveActionsLimit === null || effectiveActionsLimit === 0 ? 0 : Math.min(100, Math.round((actionsUsed / effectiveActionsLimit) * 100)),
    fixesPercent: plan.fixesLimit === null ? 0 : Math.min(100, Math.round((fixesUsed / plan.fixesLimit) * 100)),
  };
}

export async function assertUsageAvailable(
  userId: string,
  required: { actions?: number; minutes?: number },
) {
  const summary = await getBillingSummary(userId);
  if (
    summary.plan.actionsLimit !== null &&
    !summary.plan.overageEnabled &&
    summary.actionsUsed + (required.actions ?? 0) > summary.plan.actionsLimit + summary.actionsCredits
  ) {
    throw new Response('Eval action limit reached. Upgrade to Pro to continue.', { status: 402 });
  }
  if (
    summary.plan.minutesLimit !== null &&
    !summary.plan.overageEnabled &&
    summary.minutesUsed + (required.minutes ?? 0) > summary.plan.minutesLimit + summary.minutesCredits
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

export type { PlanId };
