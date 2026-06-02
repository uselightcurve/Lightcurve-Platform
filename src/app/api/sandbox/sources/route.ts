import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import {
  createSandboxSource,
  listSandboxSources,
  normalizeSandboxType,
} from '@/lib/sandboxReplicas';

export async function GET(req: Request) {
  try {
    const account = await requireAccount();
    const url = new URL(req.url);
    const type = normalizeSandboxType(url.searchParams.get('type'));
    const sources = await listSandboxSources(account.userId, type);
    return NextResponse.json({ sources }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Sandbox sources unavailable.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    const type = normalizeSandboxType(body.type);
    if (!type) return NextResponse.json({ error: 'Choose CRM or Calendar.' }, { status: 400 });
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const source = await createSandboxSource({
      ownerUserId: account.userId,
      type,
      name: String(body.name ?? ''),
      rows,
      schemaMapping: body.schemaMapping && typeof body.schemaMapping === 'object' ? body.schemaMapping : null,
      sourceKind: String(body.sourceKind ?? 'upload'),
    });
    return NextResponse.json({ source });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Sandbox source could not be saved.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
