import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentConnections, experiments } from '@/db/schema';
import { decryptCredentials } from '@/lib/secretVault';

type ExperimentRow = typeof experiments.$inferSelect;

const SECRET_CONFIG_KEYS = new Set([
  'apiKey',
  'authToken',
  'bearerToken',
  'secret',
  'password',
  'privateKey',
  'webhookSecret',
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function sanitizeAgentConfig(config: unknown) {
  return Object.fromEntries(
    Object.entries(asRecord(config)).filter(([key]) => !SECRET_CONFIG_KEYS.has(key)),
  );
}

export async function getOwnedAgentConnection(id: string, ownerUserId: string) {
  const rows = await db
    .select()
    .from(agentConnections)
    .where(and(eq(agentConnections.id, id), eq(agentConnections.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0];
}

export async function hydrateExperimentAgentConfig(experiment: ExperimentRow): Promise<ExperimentRow> {
  if (!experiment.agentConnectionId || !experiment.ownerUserId) return experiment;

  const connection = await getOwnedAgentConnection(experiment.agentConnectionId, experiment.ownerUserId);
  if (!connection) return experiment;

  const credentials = await decryptCredentials(connection.encryptedCredentials);
  const config = {
    ...credentials,
    ...asRecord(experiment.agentConfig),
    endpoint: connection.endpoint ?? asRecord(experiment.agentConfig).endpoint,
    endpointType: connection.endpointType,
    provider: connection.provider,
    agentConnectionId: connection.id,
  };

  return {
    ...experiment,
    agentType: connection.provider,
    webrtcEndpoint: connection.endpoint ?? experiment.webrtcEndpoint,
    agentConfig: config,
  };
}
