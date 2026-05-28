import { NextResponse } from 'next/server';
import { db } from '@/db';
import { experiments } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const url = new URL(req.url);
    const compareId = url.searchParams.get('compareId');
    
    if (!compareId) return NextResponse.json({ error: 'compareId is required' }, { status: 400 });

    const exp1 = await db.select().from(experiments).where(and(eq(experiments.id, id), eq(experiments.ownerUserId, account.userId)));
    const exp2 = await db.select().from(experiments).where(and(eq(experiments.id, compareId), eq(experiments.ownerUserId, account.userId)));

    return NextResponse.json({
      base: exp1[0],
      compare: exp2[0],
      diff: {}
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Compare failed' }, { status: 500 });
  }
}
