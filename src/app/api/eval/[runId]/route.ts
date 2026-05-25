import { NextResponse } from 'next/server';
import { db } from '@/db';
import { runs, experiments, scores, traces, scenarios } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy_key');

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  // 1. Fetch Run and Scenario
  const runData = await db.select().from(runs).where(eq(runs.id, runId)).execute();
  if (!runData.length) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  const run = runData[0];

  const scenarioData = await db.select().from(scenarios).where(eq(scenarios.id, run.scenarioId!)).execute();
  const scenario = scenarioData[0];

  // 2. Transcribe (Stubbed since it's an async STT process in real life)
  
  // 3. MOS Service
  let mosValue = 0;
  if (process.env.MOS_SERVICE_URL && run.audioCallerUrl && run.audioAgentUrl) {
    try {
      const res = await fetch(process.env.MOS_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref_url: run.audioCallerUrl, deg_url: run.audioAgentUrl }),
      });
      if (res.ok) {
        const json = await res.json();
        mosValue = json.mos;
      }
    } catch (e) {
      console.error('MOS Service failed', e);
    }
  }

  // 4. Latency p50/p95
  const runTraces = await db.select().from(traces).where(eq(traces.runId, runId)).execute();
  const latencies = runTraces.map(t => t.totalLatencyMs || 0).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  // 6. Gemini 1.5 Pro Judge
  const transcriptStr = runTraces.map(t => `${t.speaker}: ${t.text}`).join('\n');
  const judgePrompt = `
You are a voice AI quality evaluator. Be strict and objective.

Transcript:
${transcriptStr}

Scenario goal: ${(scenario.persona as any).goal}
Success criteria: ${JSON.stringify(scenario.successCriteria)}

Score each criterion from 0.0 to 1.0.
Return ONLY valid JSON. No preamble. No markdown fences.

{
  "scores": [
    {
      "criterion_type": "task_completed",
      "score": 0.0,
      "rationale": "max 50 words explaining score"
    }
  ],
  "overall_suggestion": "one sentence improvement suggestion for the agent"
}
  `;

  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
  let judgeScores: any[] = [];
  try {
    const result = await model.generateContent(judgePrompt);
    let text = result.response.text();
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);
    judgeScores = parsed.scores || [];
  } catch (e) {
    console.error('Gemini judge failed', e);
  }

  // 7. Write scores
  if (mosValue > 0) {
    await db.insert(scores).values({
      runId, metricName: 'mos', value: mosValue, method: 'pesq', rationale: 'Computed via PESQ microservice'
    });
  }
  for (const s of judgeScores) {
    await db.insert(scores).values({
      runId, metricName: s.criterion_type, value: s.score, method: 'gemini-1.5-pro', rationale: s.rationale
    });
  }

  // 8. Update run
  await db.update(runs).set({ status: 'complete' }).where(eq(runs.id, runId));

  // 9. Recompute experiment aggregates
  const allRuns = await db.select().from(runs).where(eq(runs.experimentId, run.experimentId!));
  const isExperimentDone = allRuns.every(r => r.status === 'complete' || r.id === runId);
  
  if (isExperimentDone) {
    await db.update(experiments).set({
      status: 'completed',
      completedAt: new Date()
    }).where(eq(experiments.id, run.experimentId!));
  }

  return NextResponse.json({ success: true });
}
