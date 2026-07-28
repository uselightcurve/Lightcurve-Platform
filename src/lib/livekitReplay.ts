import { AccessToken, LiveKitAPI } from 'livekit-server-sdk';

function livekitConfig() {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) {
    throw new Error('LiveKit replay dispatch is not configured.');
  }
  return { url, apiKey, apiSecret };
}

export function replayRoomName(jobId: string) {
  return `lightcurve-replay-${jobId}`;
}

export async function dispatchReplayAgent(params: {
  jobId: string;
  runId: string;
  agentName: string;
}) {
  const config = livekitConfig();
  const roomName = replayRoomName(params.jobId);
  const api = new LiveKitAPI({
    host: config.url,
    apiKey: config.apiKey,
    secret: config.apiSecret,
    requestTimeout: 15,
  });
  await api.agentDispatch.createDispatch(roomName, params.agentName, {
    metadata: JSON.stringify({
      source: 'lightcurve_replay',
      replayJobId: params.jobId,
      runId: params.runId,
    }),
  });
  return roomName;
}

export async function createReplayCallerCredentials(jobId: string, roomName: string) {
  const config = livekitConfig();
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `lightcurve-caller-${jobId}`,
    name: 'Lightcurve simulated caller',
    ttl: 15 * 60,
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return { url: config.url, roomName, token: await token.toJwt() };
}
