import { NextResponse } from 'next/server';
import { demoImportedCalls, toScenarioCandidate, type NormalizedCall } from '@/lib/integrations';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const call = (body.call as NormalizedCall | undefined) ?? demoImportedCalls[0];

  return NextResponse.json({
    scenario: toScenarioCandidate(call),
    preview: true,
  });
}
