import { createHmac } from 'crypto';
import type { experiments, scenarios } from '@/db/schema';
import { getRunnerAuthToken, validateNativeRunnerEndpoint } from '@/lib/nativeRunner';

type ExperimentRow = typeof experiments.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;
type LiveKitSandboxSession = ReturnType<typeof createLiveKitSandboxSession>;

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
      'Lightcurve test room is not configured yet. Add the room service secrets in Google Secret Manager, then redeploy.',
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
      'Lightcurve test room is ready. Connect the agent participant with the room URL and token below. Lightcurve joins as the synthetic caller and judge.',
  };
}

export function createLiveKitJoinOptions(session: LiveKitSandboxSession) {
  const envBlock = `LIGHTCURVE_ROOM=${session.roomName}
LIGHTCURVE_ROOM_URL=${session.liveKitUrl}
LIGHTCURVE_AGENT_TOKEN=${session.tokens.agent}`;

  return [
    {
      id: 'livekit_agents',
      label: 'Realtime agent SDK',
      summary: 'Use this when your agent runtime can join a realtime room.',
      steps: [
        'Copy the three environment values into your agent runner.',
        'Start your agent runner and connect as the agent participant.',
        'Return to Lightcurve; transcript, timing, and scores appear on this run.',
      ],
      code: `${envBlock}

# Python example
from livekit import rtc

room = rtc.Room()
await room.connect(
    os.environ["LIGHTCURVE_ROOM_URL"],
    os.environ["LIGHTCURVE_AGENT_TOKEN"],
)

# Start your voice-agent pipeline after the room connects.`,
    },
    {
      id: 'browser_webrtc',
      label: 'Custom WebRTC client',
      summary: 'Use this when your agent is controlled from a browser or Node WebRTC client.',
      steps: [
        'Use the room URL and token in your WebRTC client.',
        'Publish the agent audio track and subscribe to the caller audio track.',
        'Send the agent response audio back into the same room.',
      ],
      code: `${envBlock}

import { Room } from "livekit-client";

const room = new Room();
await room.connect(process.env.LIGHTCURVE_ROOM_URL!, process.env.LIGHTCURVE_AGENT_TOKEN!);

// Publish your agent microphone/output track here.
// Subscribe to Lightcurve caller audio and route it into your agent.`,
    },
    {
      id: 'hosted_provider',
      label: 'Hosted Vapi / Retell / ElevenLabs',
      summary: 'Use this only if the hosted agent can join an external realtime room.',
      steps: [
        'Point the hosted agent runtime or custom transport to the room URL.',
        'Use the token as the agent participant credential.',
        'If the provider only exposes phone/SIP, use Phone realism instead.',
      ],
      code: `${envBlock}

# Hosted-provider note:
# No provider API key is needed for Lightcurve room mode.
# The provider must support joining an external realtime room or custom transport.
# If it only answers phone numbers, switch the experiment to Phone realism.`,
    },
  ];
}

export async function requestAgentRunnerJoin(
  session: LiveKitSandboxSession,
  experiment: ExperimentRow,
) {
  const config = experiment.agentConfig && typeof experiment.agentConfig === 'object'
    ? experiment.agentConfig as Record<string, unknown>
    : {};
  const endpoint = typeof config.endpoint === 'string' ? config.endpoint.trim() : '';
  if (!endpoint) return false;

  const endpointProblem = validateNativeRunnerEndpoint('livekit', endpoint);
  if (endpointProblem) throw new Error(endpointProblem);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const authToken = getRunnerAuthToken(config);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        type: 'lightcurve.room.connect',
        room: {
          roomName: session.roomName,
          liveKitUrl: session.liveKitUrl,
          agentToken: session.tokens.agent,
        },
        scenario: session.scenario,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Agent SDK runner rejected the room connection with ${response.status}.`);
    }
    return true;
  } finally {
    clearTimeout(timeout);
  }
}
