import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs } from '@/db/schema';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const [experiment] = await db.select().from(experiments).where(and(eq(experiments.id, id), eq(experiments.ownerUserId, account.userId))).limit(1);
    if (!experiment) return NextResponse.json({ error: 'Dataset run not found.' }, { status: 404 });
    const runRows = await db.select().from(runs).where(eq(runs.experimentId, experiment.id));
    return NextResponse.json({ ...experiment, experiment, runs: runRows });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Dataset run could not be loaded.' }, { status: 500 });
  }
}
