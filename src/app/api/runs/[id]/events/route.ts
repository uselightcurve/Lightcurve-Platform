import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { runs, scores, traces } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

async function loadSnapshot(runId: string, ownerUserId: string) {
  const [run] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.ownerUserId, ownerUserId)))
    .limit(1);
  if (!run) return null;

  const [traceRows, scoreRows] = await Promise.all([
    db.select().from(traces).where(eq(traces.runId, runId)).orderBy(asc(traces.turnIndex)),
    db.select().from(scores).where(eq(scores.runId, runId)),
  ]);

  return { run, traces: traceRows, scores: scoreRows };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireAccount();
    const { id } = await params;
    const wantsSse = req.headers.get('accept')?.includes('text/event-stream');

    if (!wantsSse) {
      const snapshot = await loadSnapshot(id, account.userId);
      if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(snapshot);
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        for (let i = 0; i < 30; i += 1) {
          const snapshot = await loadSnapshot(id, account.userId);
          if (!snapshot) {
            send('error', { error: 'Not found' });
            break;
          }
          send('snapshot', snapshot);
          if (snapshot.run.status === 'complete' || snapshot.run.status === 'failed') break;
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('Failed to stream run events', error);
    return NextResponse.json({ error: 'Run events unavailable' }, { status: 503 });
  }
}
