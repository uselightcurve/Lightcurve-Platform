import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scores } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const expData = await db.select().from(experiments).where(eq(experiments.id, id));
  if (!expData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  
  const expRuns = await db.select().from(runs).where(eq(runs.experimentId, id));
  
  const allScores = [];
  for (const r of expRuns) {
    const rScores = await db.select().from(scores).where(eq(scores.runId, r.id));
    allScores.push(...rScores);
  }

  return NextResponse.json({ experiment: expData[0], runs: expRuns, scores: allScores });
}
