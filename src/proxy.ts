import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { clerkPublishableKey } from '@/lib/clerkEnv';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/dodo',
  '/api/integrations/status',
  '/api/release-gate(.*)',
  '/api/admin/credits',
  '/api/internal/scoring',
  '/api/internal/readiness',
  '/api/sdk/(.*)',
  '/api/datasets(.*)',
]);

export default clerkMiddleware(
  async (auth, req) => {
    if (process.env.MOCK_MODE !== 'true' && !isPublicRoute(req)) {
      await auth.protect();
    }
  },
  { publishableKey: clerkPublishableKey() },
);

export const config = {
  matcher: [
    '/((?!_next|.*\\..*).*)',
    '/api/(.*)',
  ],
};
