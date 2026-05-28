import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { trackServerEvent } from '@/lib/serverAnalytics';

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    console.log('Scale sales request', {
      userId: account.userId,
      email: account.email,
      name: body.name ?? account.name,
      message: body.message,
    });
    await trackServerEvent(account, 'Contact Sales Submitted', {
      plan: 'scale',
      message_length: typeof body.message === 'string' ? body.message.length : 0,
      has_name: Boolean(body.name ?? account.name),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Sales request could not be saved' }, { status: 500 });
  }
}
