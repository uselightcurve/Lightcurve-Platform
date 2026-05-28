import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';

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
    return NextResponse.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Sales request could not be saved' }, { status: 500 });
  }
}
