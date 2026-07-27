import { NextResponse } from 'next/server';
import { processDueScoringJobs } from '@/lib/replayScoring';

async function authorized(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!bearer) return false;
  if (process.env.SCORING_INGEST_TOKEN && bearer === process.env.SCORING_INGEST_TOKEN) return true;
  return false;
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
