'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import * as amplitude from '@amplitude/unified';

const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY ?? 'f04e53094bb6c601f0a2c75f9fa2102c';
let amplitudeReadyPromise: Promise<void> | null = null;

function initializeAmplitude() {
  if (!amplitudeReadyPromise) {
    amplitudeReadyPromise = amplitude.initAll(apiKey, {
      serverZone: 'US',
      analytics: { autocapture: true },
      sessionReplay: { sampleRate: 1 },
    });
  }

  return amplitudeReadyPromise;
}

function safeProperties(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn, user } = useUser();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    initializeAmplitude()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((error) => {
        console.warn('Amplitude failed to initialize', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !isLoaded) return;

    if (isSignedIn && user) {
      amplitude.setUserId(user.id);
      const identify = new amplitude.Identify();
      identify.set('email_domain', user.primaryEmailAddress?.emailAddress?.split('@')[1] ?? 'unknown');
      if (user.createdAt) identify.set('created_at', user.createdAt.toISOString());
      amplitude.identify(identify);
      amplitude.track('User Signed In', safeProperties({
        auth_provider: user.externalAccounts[0]?.provider ?? 'email',
      }));
    } else {
      amplitude.reset();
    }
  }, [isLoaded, isSignedIn, ready, user]);

  useEffect(() => {
    if (!ready) return;

    const params = typeof window === 'undefined' ? '' : window.location.search;
    amplitude.track('Page Viewed', safeProperties({
      path: pathname,
      query_present: Boolean(params),
      page_group: pathname.split('/').filter(Boolean)[0] || 'overview',
    }));
  }, [pathname, ready]);

  return children;
}
