'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import * as amplitude from '@amplitude/analytics-browser';

const apiKey = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;

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
    if (!apiKey || initialized.current) return;
    amplitude.init(apiKey, undefined, {
      autocapture: {
        pageViews: false,
        sessions: true,
        formInteractions: false,
        fileDownloads: false,
      },
    });
    initialized.current = true;
  }, []);

  useEffect(() => {
    if (!apiKey || !initialized.current || !isLoaded) return;

    if (isSignedIn && user) {
      amplitude.setUserId(user.id);
      const identify = new amplitude.Identify();
      identify.set('email_domain', user.primaryEmailAddress?.emailAddress?.split('@')[1] ?? 'unknown');
      if (user.createdAt) identify.set('created_at', user.createdAt.toISOString());
      amplitude.identify(identify);
    } else {
      amplitude.reset();
    }
  }, [isLoaded, isSignedIn, user]);

  useEffect(() => {
    if (!apiKey || !initialized.current) return;

    const params = typeof window === 'undefined' ? '' : window.location.search;
    amplitude.track('Page Viewed', safeProperties({
      path: pathname,
      query_present: Boolean(params),
      page_group: pathname.split('/').filter(Boolean)[0] || 'overview',
    }));
  }, [pathname]);

  return children;
}
