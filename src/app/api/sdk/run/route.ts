import { NextResponse } from 'next/server';

function appOrigin(req: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

function forwardedHeaders(req: Request) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const cookie = req.headers.get('cookie');
  const authorization = req.headers.get('authorization');
  if (cookie) headers.Cookie = cookie;
  if (authorization) headers.Authorization = authorization;
  return headers;
}

async function readPayload(res: Response) {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return res.json().catch(() => ({}));
  }
  return res.text().catch(() => '');
}

export async function POST(req: Request) {
  const body = await req.json();
  const origin = appOrigin(req);
  const headers = forwardedHeaders(req);
  const scenarioIds = Array.isArray(body.scenarioIds) ? body.scenarioIds : body.scenarios ?? [];

  try {
    const res = await fetch(`${origin}/api/experiments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: body.name ?? 'SDK release gate',
        agentType: body.agentType,
        agentConfig: body.agentConfig,
        webrtcEndpoint: body.agentConfig?.endpoint ?? body.agentConfig?.agentId ?? 'sdk-agent',
        scenarioIds,
        scenarioOverrides: body.scenarioOverrides,
        agentConnectionId: body.agentConnectionId,
        gitSha: body.gitSha,
      })
    });

    if (!res.ok) {
      return NextResponse.json(await readPayload(res), { status: res.status });
    }
    const json = await res.json();

    const startedRuns = [];
    for (const r of json.runs ?? []) {
      const startRes = await fetch(`${origin}/api/runs/${r.id}/start`, {
        method: 'POST',
        headers,
      });
      startedRuns.push({
        runId: r.id,
        ok: startRes.ok,
        status: startRes.status,
        result: await readPayload(startRes),
      });
    }

    return NextResponse.json({
      experimentId: json.experiment.id,
      experiment: json.experiment,
      runs: json.runs ?? [],
      startedRuns,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SDK run could not be created.';
    return NextResponse.json({
      error: message,
      message: 'SDK runs must be backed by the production database and an authenticated Lightcurve account. Lightcurve will not create demo SDK results in production.',
    }, { status: 503 });
  }
}
