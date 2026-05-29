import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scores } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const expData = await db.select().from(experiments).where(eq(experiments.id, id));
    if (!expData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const expRuns = await db.select().from(runs).where(eq(runs.experimentId, id));

    // Calculate average MOS and Task Completion
    let totalMos = 0, mosCount = 0;
    let totalTc = 0, tcCount = 0;

    for (const r of expRuns) {
      const runScores = await db.select().from(scores).where(eq(scores.runId, r.id));
      for (const s of runScores) {
        if (s.metricName === 'mos' && s.value) {
          totalMos += s.value;
          mosCount++;
        } else if (s.metricName === 'task_completed' && s.value) {
          totalTc += s.value;
          tcCount++;
        }
      }
    }

    return NextResponse.json({
      status: expData[0].status,
      mos: mosCount > 0 ? totalMos / mosCount : null,
      taskCompletion: tcCount > 0 ? totalTc / tcCount : null,
      runs: expRuns
    });
  } catch {
    return NextResponse.json({ error: 'Experiment store unavailable' }, { status: 503 });
  }
}
