import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { Resend } from 'resend';

const resend = new Resend('re_3qTQarEF_4va5nW7LTA4XzzzKm85t4vJ6');

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    
    const senderName = body.name ?? account.name;
    const message = body.message;

    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'ayush@uselightcurve.com',
      subject: `New Scale Plan Request from ${senderName}`,
      html: `<p><strong>User:</strong> ${senderName} (${account.email})</p><p><strong>Message:</strong></p><p>${message}</p>`
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Sales request could not be saved' }, { status: 500 });
  }
}
