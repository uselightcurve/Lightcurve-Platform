import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { buildSandboxPanel } from '@/lib/sandboxReplicas';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const environment = await buildSandboxPanel(id, account.userId);
    return NextResponse.json({ environment }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Sandbox environment unavailable.';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
