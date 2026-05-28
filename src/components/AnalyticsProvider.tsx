'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import * as amplitude from '@amplitude/unified';

const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY ?? 'f04e53094bb6c601f0a2c75f9fa2102c';
let amplitudeInitialized = false;

function safeProperties(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn, user } = useUser();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    if (!amplitudeInitialized) {
      void amplitude.initAll(apiKey, {
        analytics: { autocapture: true },
        sessionReplay: { sampleRate: 1 },
      });
      amplitudeInitialized = true;
    }
    initialized.current = true;
  }, []);

  useEffect(() => {
    if (!initialized.current || !isLoaded) return;

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
  }, [isLoaded, isSignedIn, user]);

  useEffect(() => {
    if (!initialized.current) return;

    const params = typeof window === 'undefined' ? '' : window.location.search;
    amplitude.track('Page Viewed', safeProperties({
      path: pathname,
      query_present: Boolean(params),
      page_group: pathname.split('/').filter(Boolean)[0] || 'overview',
    }));
  }, [pathname]);

  return children;
}
