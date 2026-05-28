import { NextResponse } from 'next/server';
import { toScenarioCandidate, type NormalizedCall } from '@/lib/integrations';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function POST(req: Request) {
  try {
    await requireAccount();
    const body = await req.json().catch(() => ({}));
    const call = body.call as NormalizedCall | undefined;
    if (!call) return NextResponse.json({ error: 'Call payload is required' }, { status: 400 });

    return NextResponse.json({
      scenario: toScenarioCandidate(call),
      preview: false,
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Scenario could not be created' }, { status: 500 });
  }
}
