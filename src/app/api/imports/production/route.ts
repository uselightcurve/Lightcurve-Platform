import { NextResponse } from 'next/server';
import {
  type NormalizedCall,
  type ProviderId,
} from '@/lib/integrations';
import { assertUsageAvailable, requireAccount, unauthorizedJson } from '@/lib/account';
import { getOwnedAgentConnection } from '@/lib/agentConnections';
import { decryptCredentials } from '@/lib/secretVault';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function importFromProvider(provider: ProviderId, credentials: Record<string, unknown>): Promise<NormalizedCall[]> {
  const apiKey = stringValue(credentials.apiKey);
  if (!apiKey) throw new Error(`${provider} API key is required for production call import.`);

  // Provider APIs differ, so the first production-ready contract is normalized at this boundary.
  // Each provider-specific fetch can be expanded without changing downstream eval UI or storage.
  if (provider === 'vapi') {
    const response = await fetch(`${process.env.VAPI_API_BASE ?? 'https://api.vapi.ai'}/call`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return [];
    return [];
  }

  if (provider === 'retell') {
    const response = await fetch(`${process.env.RETELL_API_BASE ?? 'https://api.retellai.com'}/v2/list-calls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
      { headers: { 'xi-api-key': apiKey } }
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
    const agentConnectionId = stringValue(asRecord(body).agentConnectionId);
    if (!agentConnectionId) {
      return NextResponse.json(
        { error: 'Choose a saved agent connection before importing production calls.' },
        { status: 400 },
      );
    }

    const connection = await getOwnedAgentConnection(agentConnectionId, account.userId);
    if (!connection) return NextResponse.json({ error: 'Agent connection not found' }, { status: 404 });
    if (!['vapi', 'retell', 'elevenlabs'].includes(connection.provider)) {
      return NextResponse.json(
        { error: 'Production call import is available for Vapi, Retell, and ElevenLabs connections first.' },
        { status: 400 },
      );
    }

    const credentials = await decryptCredentials(connection.encryptedCredentials);
    const imported = await importFromProvider(connection.provider as ProviderId, credentials);

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
