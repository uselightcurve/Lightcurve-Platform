export const dynamic = 'force-dynamic';

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function responseXml(runId: string | null) {
  const text = runId
    ? `Lightcurve sandbox call connected for run ${runId}. Please answer as the customer-facing voice agent.`
    : 'Lightcurve sandbox call connected. Please answer as the customer-facing voice agent.';

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Speak>${escapeXml(text)}</Speak></Response>`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return new Response(responseXml(url.searchParams.get('runId')), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: Request) {
  return GET(req);
}
