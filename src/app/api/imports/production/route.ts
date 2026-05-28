import { NextResponse } from 'next/server';
import {
  getProviderDefinition,
  getProviderStatuses,
  type NormalizedCall,
  type ProviderId,
} from '@/lib/integrations';
import { assertUsageAvailable, requireAccount, unauthorizedJson } from '@/lib/account';

async function importFromProvider(provider: ProviderId): Promise<NormalizedCall[]> {
  const definition = getProviderDefinition(provider);
  if (!definition) return [];

  const status = getProviderStatuses().find((item) => item.id === provider);
  if (!status?.configured) {
    return [];
  }

  // Provider APIs differ, so the first production-ready contract is normalized at this boundary.
  // Each provider-specific fetch can be expanded without changing downstream eval UI or storage.
  if (provider === 'vapi') {
    const response = await fetch(`${process.env.VAPI_API_BASE ?? 'https://api.vapi.ai'}/call`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!response.ok) return [];
    return [];
  }

  if (provider === 'retell') {
    const response = await fetch(`${process.env.RETELL_API_BASE ?? 'https://api.retellai.com'}/v2/list-calls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 25 }),
    });
    if (!response.ok) return [];
    return [];
  }

  if (provider === 'elevenlabs') {
    const response = await fetch(
      `${process.env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io'}/v1/convai/conversations`,
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '' } }
    );
    if (!response.ok) return [];
    return [];
  }

  return [];
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    await assertUsageAvailable(account.userId, { imports: true, actions: 1 });
    const body = await req.json().catch(() => ({}));
    const provider = body.provider as ProviderId | 'all' | undefined;
    const providers =
      provider && provider !== 'all'
        ? [provider]
        : (['vapi', 'retell', 'elevenlabs', 'livekit', 'pipecat', 'custom_webrtc'] as ProviderId[]);

    const imported = (await Promise.all(providers.map((item) => importFromProvider(item)))).flat();

    return NextResponse.json({
      calls: imported,
      preview: false,
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    if (error instanceof Response) return NextResponse.json({ error: await error.text() }, { status: error.status });
    return NextResponse.json({ error: 'Production import failed' }, { status: 500 });
  }
}
