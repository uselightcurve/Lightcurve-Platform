import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  // Delegate to regular experiment creation endpoint
  const body = await req.json();

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/experiments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: body.name ?? 'SDK release gate',
        agentType: body.agentType,
        agentConfig: body.agentConfig,
        webrtcEndpoint: body.agentConfig?.endpoint ?? body.agentConfig?.agentId ?? 'sdk-agent',
        scenarioIds: body.scenarios ?? body.scenarioIds ?? [],
        gitSha: body.gitSha,
      })
    });

    if (!res.ok) throw new Error('database unavailable');
    const json = await res.json();

    // Automatically trigger runs
    for (const r of json.runs) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/runs/${r.id}/start`, {
        method: 'POST'
      });
    }

    return NextResponse.json({ experimentId: json.experiment.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SDK run could not be created.';
    return NextResponse.json({
      error: message,
      message: 'SDK runs must be backed by the production database and a real agent connection. Lightcurve will not create demo SDK results in production.',
    }, { status: 503 });
  }
}
