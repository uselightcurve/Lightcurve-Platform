import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments, runs, scenarios } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { DEMO_EXPERIMENTS, DEMO_SCENARIOS } from '@/lib/demoData';

export async function GET() {
  try {
    const data = await db.select().from(experiments).orderBy(desc(experiments.createdAt));
    return NextResponse.json({ experiments: data });
  } catch (error) {
    console.error('Failed to load experiments', error);
    return NextResponse.json({ experiments: DEMO_EXPERIMENTS, preview: true });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await db.insert(scenarios).values(DEMO_SCENARIOS).onConflictDoNothing();
    const exp = await db.insert(experiments).values({
      name: body.name,
      agentType: body.agentType,
      agentConfig: body.agentConfig,
      webrtcEndpoint: body.webrtcEndpoint,
      scenarioIds: body.scenarioIds,
      gitSha: body.gitSha,
    }).returning();

    const expId = exp[0].id;
    const createdRuns = [];
    for (const sid of body.scenarioIds) {
      const r = await db.insert(runs).values({
        experimentId: expId,
        scenarioId: sid,
        status: 'pending'
      }).returning();
      createdRuns.push(r[0]);
    }

    return NextResponse.json({ experiment: exp[0], runs: createdRuns });
  } catch (error) {
    console.error('Failed to create experiment', error);
    return NextResponse.json(
      { error: 'Experiment store is unavailable. Configure DATABASE_URL to create live sandbox runs.' },
      { status: 503 }
    );
  }
}
