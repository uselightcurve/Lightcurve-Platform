import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs, scenarios } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { createLiveKitJoinOptions, createLiveKitSandboxSession, isLightcurveHostedLiveKit } from '@/lib/livekitSandbox';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const [run] = await db.select().from(runs).where(and(eq(runs.id, id), eq(runs.ownerUserId, account.userId))).limit(1);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const [experiment] = run.experimentId
      ? await db.select().from(experiments).where(and(eq(experiments.id, run.experimentId), eq(experiments.ownerUserId, account.userId))).limit(1)
      : [];
    if (!experiment || !isLightcurveHostedLiveKit(experiment)) {
      return NextResponse.json({ error: 'Run is not a Lightcurve test-room sandbox.' }, { status: 400 });
    }

    const [scenario] = run.scenarioId
      ? await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId)).limit(1)
      : [];
    if (!scenario) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });

    const session = createLiveKitSandboxSession(id, experiment, scenario);
    return NextResponse.json({
      roomName: session.roomName,
      liveKitUrl: session.liveKitUrl,
      agentToken: session.tokens.agent,
      callerToken: session.tokens.caller,
      instructions: session.instructions,
      joinOptions: createLiveKitJoinOptions(session),
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Lightcurve room session unavailable';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
