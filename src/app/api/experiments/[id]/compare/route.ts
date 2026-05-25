import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, scores, runs } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const compareId = url.searchParams.get('compareId');
  
  if (!compareId) return NextResponse.json({ error: 'compareId is required' }, { status: 400 });

  const exp1 = await db.select().from(experiments).where(eq(experiments.id, id));
  const exp2 = await db.select().from(experiments).where(eq(experiments.id, compareId));

  return NextResponse.json({
    base: exp1[0],
    compare: exp2[0],
    diff: {} // In MVP, UI handles diffing aggregateScores
  });
}
