import { NextResponse } from 'next/server';
import { processDueScoringJobs } from '@/lib/replayScoring';
import { OAuth2Client } from 'google-auth-library';

async function authorized(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!bearer) return false;
  if (process.env.SCORING_INGEST_TOKEN && bearer === process.env.SCORING_INGEST_TOKEN) return true;
  const email = process.env.SCORING_SCHEDULER_SERVICE_ACCOUNT;
  const audience = process.env.NEXT_PUBLIC_APP_URL;
  if (!email || !audience) return false;
  try {
    const ticket = await new OAuth2Client().verifyIdToken({ idToken: bearer, audience });
    const payload = ticket.getPayload();
    return payload?.email === email && payload.email_verified === true;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!await authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const limit = typeof body.limit === 'number' ? body.limit : 5;
  const results = await processDueScoringJobs(limit);
  return NextResponse.json({ processed: results.length, results });
}
