import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentConnections } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { credentialPreview, encryptCredentials } from '@/lib/secretVault';

const PROVIDERS = new Set(['vapi', 'retell', 'elevenlabs', 'livekit', 'pipecat', 'custom_webrtc']);
const ENDPOINT_TYPES = new Set(['webrtc', 'sip', 'provider_api', 'phone', 'replay_import']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function publicConnection(connection: typeof agentConnections.$inferSelect) {
  return {
    id: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    endpointType: connection.endpointType,
    endpoint: connection.endpoint,
    credentialsPreview: connection.credentialsPreview,
    healthStatus: connection.healthStatus,
    healthMessage: connection.healthMessage,
    lastTestedAt: connection.lastTestedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export async function GET() {
  try {
    const account = await requireAccount();
    const rows = await db
      .select()
      .from(agentConnections)
      .where(eq(agentConnections.ownerUserId, account.userId))
      .orderBy(desc(agentConnections.updatedAt));
    return NextResponse.json({ agentConnections: rows.map(publicConnection) });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to load agent connections', error);
    return NextResponse.json({ error: 'Agent connections unavailable' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    const body = await req.json();
    const provider = text(body.provider);
    const endpointType = text(body.endpointType);
    const credentials = asRecord(body.credentials);

    if (!PROVIDERS.has(provider)) return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    if (!ENDPOINT_TYPES.has(endpointType)) return NextResponse.json({ error: 'Unsupported endpoint type' }, { status: 400 });

    const encryptedCredentials = await encryptCredentials(credentials);
    const [connection] = await db
      .insert(agentConnections)
      .values({
        ownerUserId: account.userId,
        provider,
        displayName: text(body.displayName) || provider,
        endpointType,
        endpoint: text(body.endpoint) || null,
        encryptedCredentials,
        credentialsPreview: credentialPreview(credentials),
        healthStatus: 'untested',
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ agentConnection: publicConnection(connection) }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to create agent connection', error);
    const message = error instanceof Error ? error.message : 'Agent connection could not be created';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
