import { createHmac } from 'node:crypto';

export type LiveKitTokenOptions = {
  identity: string;
  roomName?: string;
  name?: string;
  metadata?: string;
  ttlSeconds?: number;
  canPublish?: boolean;
  canSubscribe?: boolean;
  agentWorker?: boolean;
};

export function liveKitServerConfig() {
  const url = process.env.LIVEKIT_URL?.trim() || process.env.LIGHTCURVE_LIVEKIT_URL?.trim() || '';
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() || process.env.LIGHTCURVE_LIVEKIT_API_KEY?.trim() || '';
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() || process.env.LIGHTCURVE_LIVEKIT_API_SECRET?.trim() || '';
  return { url, apiKey, apiSecret, configured: Boolean(url && apiKey && apiSecret) };
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createLiveKitAccessToken(options: LiveKitTokenOptions) {
  const config = liveKitServerConfig();
  if (!config.configured) throw new Error('Lightcurve LiveKit credentials are not configured.');

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(options.ttlSeconds ?? 30 * 60, 6 * 60 * 60));
  const header = { alg: 'HS256', typ: 'JWT' };
  const video = options.agentWorker
    ? {
        agent: true,
      }
    : {
        room: options.roomName,
        roomJoin: true,
        canPublish: options.canPublish ?? true,
        canSubscribe: options.canSubscribe ?? true,
        canPublishData: true,
      };
  if (!options.agentWorker && !options.roomName) throw new Error('LiveKit room name is required.');

  const payload = {
    iss: config.apiKey,
    sub: options.identity,
    ...(options.name ? { name: options.name } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    nbf: now - 10,
    exp: now + ttl,
    video,
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac('sha256', config.apiSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function createLiveKitAdminToken(ttlSeconds = 5 * 60) {
  const config = liveKitServerConfig();
  if (!config.configured) throw new Error('Lightcurve LiveKit credentials are not configured.');

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(ttlSeconds, 6 * 60 * 60));
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: config.apiKey,
    sub: 'lightcurve-admin',
    nbf: now - 10,
    exp: now + ttl,
    video: {
      roomList: true,
      roomCreate: true,
    },
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createHmac('sha256', config.apiSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export async function verifyLiveKitCredentials() {
  const config = liveKitServerConfig();
  if (!config.configured) throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required.');
  const httpUrl = config.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
  const response = await fetch(`${httpUrl}/twirp/livekit.RoomService/ListRooms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${createLiveKitAdminToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ names: ['lightcurve-readiness'] }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`LiveKit rejected Lightcurve credentials (${response.status}).`);
  }
  return config.url;
}

export function liveKitPublicStatus() {
  const config = liveKitServerConfig();
  return {
    url: config.url,
    configured: config.configured,
  };
}
