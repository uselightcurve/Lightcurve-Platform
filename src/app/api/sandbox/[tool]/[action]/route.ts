import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { applySandboxAction, normalizeSandboxType } from '@/lib/sandboxReplicas';

export async function POST(req: Request, { params }: { params: Promise<{ tool: string; action: string }> }) {
  try {
    const account = await requireAccount();
    const { tool, action } = await params;
    const normalizedTool = normalizeSandboxType(tool);
    if (!normalizedTool) {
      return NextResponse.json({ error: 'Only CRM, Calendar, and Reservation sandbox tools are available in this release.' }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const environmentId = typeof body.environmentId === 'string' ? body.environmentId : '';
    if (!environmentId) {
      return NextResponse.json({ error: 'Create a sandbox environment before calling tools.' }, { status: 400 });
    }

    const environment = await applySandboxAction({
      ownerUserId: account.userId,
      environmentId,
      tool: normalizedTool,
      action,
      input: body,
    });

    return NextResponse.json({ environment });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Sandbox tool unavailable.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
