import { NextResponse } from 'next/server';
import { db } from '@/db';
import { runs, traces, scores } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runData = await db.select().from(runs).where(eq(runs.id, id));
  if (!runData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  
  const runTraces = await db.select().from(traces).where(eq(traces.runId, id));
  const runScores = await db.select().from(scores).where(eq(scores.runId, id));

  return NextResponse.json({ run: runData[0], traces: runTraces, scores: runScores });
}
