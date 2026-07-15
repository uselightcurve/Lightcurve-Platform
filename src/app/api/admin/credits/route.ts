import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { billingEvents, usageEvents, users } from '@/db/schema';
import { getBillingSummary } from '@/lib/account';

export const maxDuration = 60;

function bearer(request: Request) {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
}

function authorized(request: Request) {
  const token = process.env.ADMIN_CREDITS_TOKEN?.trim();
  return Boolean(token && bearer(request) === token);
}

function positiveNumber(value: unknown, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(max, number) : null;
}

function positiveInteger(value: unknown, max: number) {
  const number = positiveNumber(value, max);
  return number == null ? null : Math.round(number);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const minutes = positiveNumber(body.minutes, 100_000);
  const actions = positiveInteger(body.actions, 1_000_000);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  if (!email || minutes == null || actions == null) {
    return NextResponse.json({ error: 'Email, positive minutes, and positive actions are required.' }, { status: 400 });
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (!user) return NextResponse.json({ error: `No account found for ${email}.` }, { status: 404 });

  const auditId = `manual_credit_grant:${randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx.insert(usageEvents).values({
      ownerUserId: user.id,
      eventType: 'manual_credit_grant',
      minutes: -minutes,
      actions: -actions,
    });
    await tx.insert(billingEvents).values({
      id: auditId,
      eventType: 'manual_credit_grant',
      ownerUserId: user.id,
      payload: {
        email: user.email,
        minutes,
        actions,
        note,
        grantedAt: new Date().toISOString(),
      },
    });
  });

  const summary = await getBillingSummary(user.id);
  return NextResponse.json({
    ok: true,
    user,
    granted: { minutes, actions },
    auditId,
    credits: {
      minutes: summary.minutesCredits,
      actions: summary.actionsCredits,
    },
    remaining: {
      minutes: summary.minutesRemaining,
      actions: summary.actionsRemaining,
    },
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'Email is required.' }, { status: 400 });

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (!user) return NextResponse.json({ error: `No account found for ${email}.` }, { status: 404 });

  return NextResponse.json({ user, summary: await getBillingSummary(user.id) });
}
