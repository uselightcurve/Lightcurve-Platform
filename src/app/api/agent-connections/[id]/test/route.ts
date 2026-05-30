import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentConnections } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { getOwnedAgentConnection } from '@/lib/agentConnections';
import { decryptCredentials } from '@/lib/secretVault';
import type { ProviderId } from '@/lib/integrations';
import {
  fetchNativeRunnerHealth,
  getRunnerAuthToken,
  NATIVE_RUNNER_PROVIDERS,
  validateNativeRunnerEndpoint,
} from '@/lib/nativeRunner';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function fetchHealth(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { ok: response.ok, status: response.status, message: response.ok ? 'Connection validated' : await response.text().catch(() => response.statusText) };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateConnection(connection: typeof agentConnections.$inferSelect) {
  const credentials = await decryptCredentials(connection.encryptedCredentials);
  const apiKey =
    stringValue(credentials.apiKey);
  const assistantId =
    stringValue(credentials.assistantId) ??
    stringValue(credentials.agentId);

  if (NATIVE_RUNNER_PROVIDERS.has(connection.provider as ProviderId)) {
    const problem = validateNativeRunnerEndpoint(connection.provider, connection.endpoint);
    if (problem) return { ok: false, message: problem };
    const result = await fetchNativeRunnerHealth(connection.endpoint!, getRunnerAuthToken(credentials));
    return { ok: result.ok, message: result.message };
  }

  if (connection.provider === 'vapi') {
    if (!apiKey) return { ok: false, message: 'Vapi API key is required.' };
    if (!assistantId) return { ok: false, message: 'Vapi assistant ID is required before this connection can run calls.' };
    const result = await fetchHealth(`https://api.vapi.ai/assistant/${assistantId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { ok: result.ok, message: result.ok ? 'Vapi assistant validated.' : `Vapi validation failed with ${result.status}.` };
  }

  if (connection.provider === 'retell') {
    if (!apiKey) return { ok: false, message: 'Retell API key is required.' };
    if (!assistantId) return { ok: false, message: 'Retell agent ID is required before this connection can run calls.' };
    const result = await fetchHealth(`https://api.retellai.com/get-agent/${assistantId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { ok: result.ok, message: result.ok ? 'Retell agent validated.' : `Retell validation failed with ${result.status}.` };
  }

  if (connection.provider === 'elevenlabs') {
    if (!apiKey) return { ok: false, message: 'ElevenLabs API key is required.' };
    const result = await fetchHealth('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    });
    return { ok: result.ok, message: result.ok ? 'ElevenLabs account validated.' : `ElevenLabs validation failed with ${result.status}.` };
  }

  return { ok: false, message: 'Unsupported provider.' };
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const connection = await getOwnedAgentConnection(id, account.userId);
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const result = await validateConnection(connection);
    const [updated] = await db
      .update(agentConnections)
      .set({
        healthStatus: result.ok ? 'healthy' : 'failed',
        healthMessage: result.message,
        lastTestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentConnections.id, id))
      .returning();

    return NextResponse.json({
      ok: result.ok,
      agentConnection: {
        ...asRecord(updated),
        encryptedCredentials: undefined,
      },
      message: result.message,
    }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
