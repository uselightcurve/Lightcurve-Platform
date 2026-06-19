import type { ProviderId } from '@/lib/integrations';

export type NativeRunnerProvider = Extract<ProviderId, 'livekit' | 'pipecat' | 'custom_webrtc'>;

export const NATIVE_RUNNER_PROVIDERS = new Set<ProviderId>(['livekit', 'pipecat', 'custom_webrtc']);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SECRET_CONFIG_PATTERN = /(?:api[_-]?key|token|secret|password|private[_-]?key|credential|webhook)/i;

function isNativeRunnerProvider(provider: string): provider is NativeRunnerProvider {
  return NATIVE_RUNNER_PROVIDERS.has(provider as ProviderId);
}

function isLocalHttp(url: URL) {
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
}

export function nativeRunnerLabel(provider: string) {
  if (provider === 'livekit') return 'Lightcurve room runner endpoint';
  if (provider === 'pipecat') return 'Pipecat runner endpoint';
  if (provider === 'custom_webrtc') return 'Custom WebRTC runner endpoint';
  return 'agent runner endpoint';
}

export function validateNativeRunnerEndpoint(provider: string, endpoint: string | null | undefined) {
  const value = endpoint?.trim() ?? '';
  if (!isNativeRunnerProvider(provider)) return '';
  if (!value) return `${nativeRunnerLabel(provider)} is required for bot-to-bot sandbox mode.`;
  if (value.startsWith('sip:') || value.startsWith('wss:')) {
    return 'Use a compatible advanced runner endpoint for this path, or switch to Lightcurve room.';
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Enter a compatible advanced runner URL. Random text cannot be used as an agent endpoint.';
  }

  if (parsed.protocol === 'https:') return '';
  if (process.env.NODE_ENV !== 'production' && isLocalHttp(parsed)) return '';
  return `${nativeRunnerLabel(provider)} must use HTTPS in production.`;
}

export function getRunnerAuthToken(config: Record<string, unknown>) {
  const authToken = config.authToken ?? config.bearerToken ?? config.runnerToken;
  return typeof authToken === 'string' && authToken.trim() ? authToken.trim() : undefined;
}

export function sanitizeRunnerConfig(config: unknown) {
  if (!config || typeof config !== 'object') return {};
  return Object.fromEntries(
    Object.entries(config as Record<string, unknown>).filter(([key]) => !SECRET_CONFIG_PATTERN.test(key)),
  );
}

export function runnerResultCallbackUrl(runId: string) {
  const appUrl = process.env.RUNNER_RESULT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  return appUrl ? `${appUrl.replace(/\/$/, '')}/api/runner/runs/${runId}/result` : undefined;
}

export async function fetchNativeRunnerHealth(endpoint: string, authToken?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      signal: controller.signal,
    });
    const message = response.ok
      ? 'Runner endpoint responded.'
      : response.status === 405
        ? 'Runner endpoint is reachable and accepts POST-only run payloads.'
        : `Runner endpoint returned ${response.status}.`;
    return {
      ok: response.ok || response.status === 405,
      status: response.status,
      message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
