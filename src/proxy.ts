import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/clerk-proxy(.*)',
  '/api/webhooks/dodo',
  '/api/integrations/status',
  '/api/release-gate(.*)',
  '/api/sdk(.*)',
  '/api/eval(.*)',
  '/api/bot-to-bot/runs/(.*)/worker',
  '/api/runner/runs/(.*)/result',
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
