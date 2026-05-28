import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentConnections } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { getOwnedAgentConnection } from '@/lib/agentConnections';
import { credentialPreview, encryptCredentials } from '@/lib/secretVault';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : undefined;
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const existing = await getOwnedAgentConnection(id, account.userId);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const credentials = asRecord(body.credentials);
    const hasCredentials = Object.keys(credentials).length > 0;
    const encryptedCredentials = hasCredentials
      ? await encryptCredentials(credentials)
      : existing.encryptedCredentials;

    const [updated] = await db
      .update(agentConnections)
      .set({
        displayName: text(body.displayName) ?? existing.displayName,
        endpointType: text(body.endpointType) ?? existing.endpointType,
        endpoint: text(body.endpoint) ?? existing.endpoint,
        encryptedCredentials,
        credentialsPreview: hasCredentials ? credentialPreview(credentials) : existing.credentialsPreview,
        healthStatus: hasCredentials || body.endpoint ? 'untested' : existing.healthStatus,
        healthMessage: hasCredentials || body.endpoint ? null : existing.healthMessage,
        updatedAt: new Date(),
      })
      .where(eq(agentConnections.id, id))
      .returning();

    return NextResponse.json({ agentConnection: publicConnection(updated) });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to update agent connection', error);
    return NextResponse.json({ error: 'Agent connection could not be updated' }, { status: 500 });
  }
}
