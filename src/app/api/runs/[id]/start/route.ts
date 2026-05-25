import { NextResponse } from 'next/server';
import { db } from '@/db';
import { runs, scenarios } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createRoom } from '@/lib/daily';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runData = await db.select().from(runs).where(eq(runs.id, id));
  if (!runData.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  
  const run = runData[0];
  
  // Set to running
  await db.update(runs).set({ status: 'running', startedAt: new Date() }).where(eq(runs.id, id));
  
  const scenarioData = await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId!));
  const scenario = scenarioData[0];

  // 1. Create Daily Room
  let dailyRoomUrl = '';
  try {
    const room = await createRoom(id);
    dailyRoomUrl = room.url;
    await db.update(runs).set({ dailyRoomUrl }).where(eq(runs.id, id));
  } catch (e) {
    console.error('Failed to create Daily room', e);
  }

  // Run the loop in background (not awaiting intentionally, or dispatch to worker)
  // In a true serverless environment, this should be sent to a worker or Cloud Run instance
  // For MVP, we simulate it here.
  const { runSyntheticCallerLoop } = await import('@/lib/syntheticCaller');
  runSyntheticCallerLoop(id, dailyRoomUrl, scenario).catch(console.error);

  return NextResponse.json({ success: true, status: 'running' });
}
