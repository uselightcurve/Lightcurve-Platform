'use client';

import * as amplitude from '@amplitude/unified';

function safeProperties(value: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}

export function trackLightcurveEvent(eventName: string, properties?: Record<string, unknown>) {
  try {
    amplitude.track(eventName, safeProperties(properties));
  } catch {
    // Analytics should never block the product path.
  }
}
