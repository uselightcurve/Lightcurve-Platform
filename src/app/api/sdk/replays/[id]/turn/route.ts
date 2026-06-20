import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { datasetCases, replayJobs, runs } from '@/db/schema';
import { synthesizeCallerPcm } from '@/lib/gcp';
import { anonymizeBehaviorGraph } from '@/lib/humanDatasets';
import { requireSdkAccount, sdkUnauthorizedJson } from '@/lib/sdkAuth';
import { generateWithLightcurveModel } from '@/lib/vertex';

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeCallerText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'test.user@example.com')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '+1 555 010 2048')
    .slice(0, 500);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireSdkAccount(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const [row] = await db.select({ job: replayJobs, case: datasetCases })
      .from(replayJobs)
      .innerJoin(runs, eq(runs.id, replayJobs.runId))
      .innerJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .where(and(eq(replayJobs.id, id), eq(replayJobs.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Replay job not found.' }, { status: 404 });
    const graph = record(row.case.behaviorGraph);
    const observedPath = Array.isArray(graph.observedPath) ? graph.observedPath : Array.isArray(graph.nodes) ? graph.nodes : [];
    const node = observedPath.map(record).find((item) => item.id === body.nodeId && item.speaker === 'human');
    if (!node || typeof node.observedText !== 'string') {
      return NextResponse.json({ error: 'Human behavior node not found in the captured graph.' }, { status: 400 });
    }
    const baseline = safeCallerText(node.observedText);
    const previousAgentText = typeof body.previousAgentText === 'string' ? body.previousAgentText.slice(-1500) : '';
    const generated = await generateWithLightcurveModel('gemini-2.5-flash', `
Write the next caller utterance for a voice-agent evaluation. Return only the utterance.
It must preserve the exact intent and facts of the human-observed baseline, respond
naturally to the latest agent response, and stay inside the supplied behavior graph.
Do not add a new goal, fact, request, or persona. Keep it under 60 words.
Replay seed: ${row.job.replaySeed}
Behavior graph: ${JSON.stringify(anonymizeBehaviorGraph(graph))}
Human-observed baseline: ${baseline}
Latest agent response: ${previousAgentText || '[opening turn]'}
`);
    const text = safeCallerText(generated?.replace(/^['"]|['"]$/g, '').trim() || baseline);
    const audio = await synthesizeCallerPcm(text, row.case.language);
    return NextResponse.json({
      nodeId: node.id,
      text,
      audioBase64: audio.audio.toString('base64'),
      sampleRate: audio.sampleRate,
      channels: audio.channels,
    });
  } catch (error) {
    const unauthorized = sdkUnauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Replay turn could not be generated.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
