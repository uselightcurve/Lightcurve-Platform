import { createHmac } from 'crypto';
import type { experiments, scenarios } from '@/db/schema';

type ExperimentRow = typeof experiments.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload: Record<string, unknown>, secret: string) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  return `${encodedHeader}.${encodedPayload}.${base64Url(signature)}`;
}

function requireLiveKitConfig() {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) {
    throw new Error(
      'LiveKit low-cost room is not configured yet. Add LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in Google Secret Manager, then redeploy.',
    );
  }
  return { url, apiKey, apiSecret };
}

function liveKitToken(params: {
  apiKey: string;
  apiSecret: string;
  roomName: string;
  identity: string;
  name: string;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? 60 * 60;
  return signJwt(
    {
      iss: params.apiKey,
      sub: params.identity,
      name: params.name,
      nbf: now - 10,
      exp: now + ttl,
      video: {
        room: params.roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    },
    params.apiSecret,
  );
}

export function isLightcurveHostedLiveKit(experiment: ExperimentRow) {
  if (experiment.agentType !== 'livekit') return false;
  const config = experiment.agentConfig && typeof experiment.agentConfig === 'object'
    ? experiment.agentConfig as Record<string, unknown>
    : {};
  return config.mode === 'lightcurve_hosted_room';
}

export function createLiveKitSandboxSession(runId: string, experiment: ExperimentRow, scenario: ScenarioRow) {
  const config = requireLiveKitConfig();
  const roomName = `lightcurve-${runId}`;
  const callerIdentity = `lightcurve-caller-${runId.slice(0, 8)}`;
  const agentIdentity = `customer-agent-${runId.slice(0, 8)}`;

  return {
    provider: 'livekit' as const,
    roomName,
    liveKitUrl: config.url,
    externalStatus: 'livekit_room_ready',
    scenario: {
      id: scenario.id,
      name: scenario.name,
      language: scenario.language,
      domain: scenario.domain,
    },
    tokens: {
      caller: liveKitToken({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        roomName,
        identity: callerIdentity,
        name: 'Lightcurve synthetic caller',
      }),
      agent: liveKitToken({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        roomName,
        identity: agentIdentity,
        name: 'Customer voice agent',
      }),
    },
    instructions:
      'LiveKit room is ready. Connect the customer agent as the agent participant and the Lightcurve runner as the synthetic caller to begin low-cost WebRTC testing.',
  };
}
