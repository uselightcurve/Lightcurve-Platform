import { NextResponse } from 'next/server';
import {
  demoImportedCalls,
  getProviderDefinition,
  getProviderStatuses,
  type NormalizedCall,
  type ProviderId,
} from '@/lib/integrations';

async function importFromProvider(provider: ProviderId): Promise<NormalizedCall[]> {
  const definition = getProviderDefinition(provider);
  if (!definition) return [];

  const status = getProviderStatuses().find((item) => item.id === provider);
  if (!status?.configured) {
    return demoImportedCalls.filter((call) => call.provider === provider);
  }

  // Provider APIs differ, so the first production-ready contract is normalized at this boundary.
  // Each provider-specific fetch can be expanded without changing downstream eval UI or storage.
  if (provider === 'vapi') {
    const response = await fetch(`${process.env.VAPI_API_BASE ?? 'https://api.vapi.ai'}/call`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    });
    if (!response.ok) return [];
    return demoImportedCalls.filter((call) => call.provider === provider);
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
    return demoImportedCalls.filter((call) => call.provider === provider);
  }

  if (provider === 'elevenlabs') {
    const response = await fetch(
      `${process.env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io'}/v1/convai/conversations`,
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '' } }
    );
    if (!response.ok) return [];
    return demoImportedCalls.filter((call) => call.provider === provider);
  }

  return demoImportedCalls.filter((call) => call.provider === provider);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = body.provider as ProviderId | 'all' | undefined;
  const providers =
    provider && provider !== 'all'
      ? [provider]
      : (['vapi', 'retell', 'elevenlabs', 'livekit', 'pipecat', 'custom_webrtc'] as ProviderId[]);

  const imported = (await Promise.all(providers.map((item) => importFromProvider(item)))).flat();

  return NextResponse.json({
    calls: imported.length ? imported : demoImportedCalls,
    preview: imported.length === 0 || getProviderStatuses().some((item) => !item.configured),
  });
}
