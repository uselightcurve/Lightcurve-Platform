import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { createSandboxEnvironment, normalizeSandboxType } from '@/lib/sandboxReplicas';

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json().catch(() => ({}));
    const type = normalizeSandboxType(body.type);
    if (!type) return NextResponse.json({ error: 'Choose CRM or Calendar.' }, { status: 400 });

    const panel = await createSandboxEnvironment({
      ownerUserId: account.userId,
      type,
      runId: typeof body.runId === 'string' && body.runId ? body.runId : null,
      sourceId: typeof body.sourceId === 'string' && body.sourceId ? body.sourceId : null,
      caseData: body.caseData && typeof body.caseData === 'object' ? body.caseData : null,
    });

    return NextResponse.json({ environment: panel });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Sandbox environment could not be created.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
