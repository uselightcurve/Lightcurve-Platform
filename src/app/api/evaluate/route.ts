import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { buildModelOrbitEvaluation } from '@/lib/modelOrbit';
import { evaluateStoredConversation } from '@/lib/modelOrbitBackend';
import { isMockMode, mockRunDetail, mockRuns } from '@/lib/mockData';

function mockEvaluation(runId: string | null) {
  const selectedRunId = runId || mockRuns[0]?.id;
  const detail = selectedRunId ? mockRunDetail(selectedRunId) : null;
  if (!detail) return null;
  return {
    run: {
      id: detail.run.id,
      name: detail.case?.name ?? 'Voice call',
      experiment: detail.experiment?.name ?? 'Automated test',
      status: detail.run.status,
    },
    evaluation: buildModelOrbitEvaluation({
      transcript: detail.traces,
      traces: detail.traces,
      graph: detail.case?.behaviorGraph,
    }),
    storedAt: new Date().toISOString(),
    cached: false,
  };
}

export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get('runId');
  if (isMockMode()) {
    const result = mockEvaluation(runId);
    return result ? NextResponse.json(result) : NextResponse.json({ error: 'Call not found.' }, { status: 404 });
  }
  try {
    const account = await requireAccount();
    if (!runId) return NextResponse.json({ error: 'Choose a call first.' }, { status: 400 });
    return NextResponse.json(await evaluateStoredConversation({ ownerUserId: account.userId, runId }));
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evaluation is unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const runId = typeof body.runId === 'string' ? body.runId : null;
  if (isMockMode()) {
    const result = mockEvaluation(runId);
    return result ? NextResponse.json(result) : NextResponse.json({ error: 'Call not found.' }, { status: 404 });
  }
  try {
    const account = await requireAccount();
    if (!runId) return NextResponse.json({ error: 'Choose a call first.' }, { status: 400 });
    return NextResponse.json(await evaluateStoredConversation({ ownerUserId: account.userId, runId, force: true }));
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evaluation could not be refreshed.' }, { status: 500 });
  }
}

