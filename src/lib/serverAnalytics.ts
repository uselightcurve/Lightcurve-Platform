import type { AccountContext } from '@/lib/account';

type AnalyticsIdentity = Pick<AccountContext, 'userId'> | string | null | undefined;

const AMPLITUDE_ENDPOINTS = {
  us: 'https://api2.amplitude.com/2/httpapi',
  eu: 'https://api.eu.amplitude.com/2/httpapi',
} as const;

function amplitudeEndpoint() {
  return process.env.AMPLITUDE_REGION === 'eu' ? AMPLITUDE_ENDPOINTS.eu : AMPLITUDE_ENDPOINTS.us;
}

function userIdFrom(identity: AnalyticsIdentity) {
  if (!identity) return undefined;
  if (typeof identity === 'string') return identity;
  return identity.userId;
}

function safeProperties(properties: Record<string, unknown>) {
  const blocked = new Set(['apiKey', 'api_key', 'authorization', 'password', 'secret', 'token']);
  return Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => {
      if (blocked.has(key.toLowerCase())) return false;
      return value !== undefined && value !== null && value !== '';
    }),
  );
}

export async function trackServerEvent(
  identity: AnalyticsIdentity,
  eventType: string,
  properties: Record<string, unknown> = {},
) {
  const apiKey = process.env.AMPLITUDE_API_KEY ?? process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  const user_id = userIdFrom(identity);
  if (!apiKey || !user_id) return;

  try {
    const response = await fetch(amplitudeEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        events: [
          {
            user_id,
            event_type: eventType,
            event_properties: safeProperties(properties),
            time: Date.now(),
            platform: 'web',
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn('Amplitude event rejected', eventType, response.status);
    }
  } catch (error) {
    console.warn('Amplitude event failed', eventType, error);
  }
}
