import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/dodo',
  '/api/integrations/status',
  '/api/release-gate(.*)',
  '/api/admin/credits',
  '/api/internal/scoring',
  '/api/sdk/(.*)',
  '/api/datasets(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|.*\\..*).*)',
    '/api/(.*)',
  ],
};
