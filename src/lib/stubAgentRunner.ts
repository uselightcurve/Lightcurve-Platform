import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { experiments, runs, scenarios, scores, traces, usageEvents } from '@/db/schema';
import { describeLightcurveModel, generateWithLightcurveModelResult } from '@/lib/vertex';

type ExperimentRow = typeof experiments.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;

type TranscriptTurn = {
  speaker: 'caller' | 'agent';
  text: string;
  latencyMs?: number;
};

type StubJudge = {
  mos: number;
  taskCompletion: number;
  captureAccuracy: number;
  method: string;
  rationale: string;
  recommendation: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function personaOf(scenario: ScenarioRow) {
  return asRecord(scenario.persona);
}

function criteriaOf(scenario: ScenarioRow) {
  return Array.isArray(scenario.successCriteria) ? scenario.successCriteria : [];
}

function callerLine(scenario: ScenarioRow, turnIndex: number) {
  const persona = personaOf(scenario);
  const opening = stringValue(persona.opening_line, stringValue(persona.goal, 'I need help with this issue.'));
  const emotion = stringValue(persona.emotional_state, 'neutral');
  const interruptions = Boolean(persona.interrupts);
  const followUps = [
    interruptions ? 'Please do not put me through another loop. I need a clear answer.' : 'Can you confirm what you are going to do next?',
    emotion === 'angry' || emotion === 'frustrated'
      ? 'I have already explained this once, so please be specific.'
      : 'Can you repeat back the important details before moving on?',
    'What happens if your system gives a different answer than what you just told me?',
  ];
  return turnIndex === 0 ? opening : followUps[(turnIndex - 1) % followUps.length];
}

async function generateStubReply(experiment: ExperimentRow, scenario: ScenarioRow, transcript: TranscriptTurn[]) {
  const config = asRecord(experiment.agentConfig);
  const instructions = stringValue(config.instructions, 'Be concise, follow policy, verify details, and confirm the next step.');
  const knowledge = stringValue(config.knowledge, 'Use only the provided scenario facts. If unsure, ask a clarifying question.');
  const toolMocks = stringValue(config.toolMocks, 'CRM, calendar, payments, ticketing, and knowledge-base tools may be unavailable or conflicting.');
  const confirmationRules = stringValue(config.confirmationRules, 'Confirm critical values such as email, phone number, appointment time, amount, and next action.');
  const escalationPolicy = stringValue(config.escalationPolicy, 'Escalate when policy is unclear, the caller disputes account facts, or a tool result conflicts with the caller.');
  const prompt = [
    'You are a low-cost hosted agent replica for a customer voice AI agent.',
    'Respond as the target agent would, using the supplied instructions. Do not mention that you are a replica or test harness.',
    'Keep the reply voice-call friendly: one or two sentences.',
    '',
    `Agent instructions: ${instructions}`,
    `Knowledge/policy notes: ${knowledge}`,
    `Confirmation rules: ${confirmationRules}`,
    `Escalation policy: ${escalationPolicy}`,
    `Sandbox tool conditions: ${toolMocks}`,
    `Scenario: ${scenario.name}`,
    `Domain: ${scenario.domain ?? 'general'}`,
    `Caller goal: ${stringValue(personaOf(scenario).goal, 'Resolve the caller issue.')}`,
    `Success criteria: ${JSON.stringify(criteriaOf(scenario)).slice(0, 2000)}`,
    `Transcript so far: ${JSON.stringify(transcript).slice(0, 4000)}`,
    '',
    'Return only the next agent utterance.',
  ].join('\n');

  const generated = await generateWithLightcurveModelResult(
    process.env.STUB_AGENT_MODEL ?? process.env.BOT_TO_BOT_CALLER_MODEL ?? 'gemini-2.5-flash-lite',
    prompt,
  );

  if (generated.text?.trim()) return generated.text.trim().replace(/^["']|["']$/g, '').slice(0, 700);
  const lastCaller = [...transcript].reverse().find((turn) => turn.speaker === 'caller')?.text ?? 'that';
  return `I can help with that. I will verify the details, follow the policy, and confirm the next step for: ${lastCaller.slice(0, 110)}.`;
}

async function judgeStubRun(
  experiment: ExperimentRow,
  scenario: ScenarioRow,
  transcript: TranscriptTurn[],
  latencyP95: number,
): Promise<StubJudge> {
  const config = asRecord(experiment.agentConfig);
  const prompt = [
    'You are Lightcurve, judging a pre-production voice-agent sandbox run.',
    'Score strictly. This is a low-cost testing text/audio proxy before provider-backed realism checks.',
    'Return compact JSON only with keys: mos, taskCompletion, captureAccuracy, rationale, recommendation.',
    'mos is 1.0-5.0. taskCompletion and captureAccuracy are 0.0-1.0.',
    '',
    `Scenario: ${scenario.name}`,
    `Caller goal: ${stringValue(personaOf(scenario).goal, '')}`,
    `Success criteria: ${JSON.stringify(criteriaOf(scenario)).slice(0, 3000)}`,
    `Agent instructions: ${stringValue(config.instructions, '')}`,
    `Knowledge/policy notes: ${stringValue(config.knowledge, '')}`,
    `Confirmation rules: ${stringValue(config.confirmationRules, '')}`,
    `Escalation policy: ${stringValue(config.escalationPolicy, '')}`,
    `Tool mock conditions: ${stringValue(config.toolMocks, '')}`,
    `Latency p95 ms: ${latencyP95}`,
    `Transcript: ${JSON.stringify(transcript).slice(0, 7000)}`,
  ].join('\n');

  const generated = await generateWithLightcurveModelResult(
    process.env.STUB_AGENT_JUDGE_MODEL ?? process.env.BOT_TO_BOT_JUDGE_MODEL ?? 'gemini-2.5-flash',
    prompt,
  );
  const judgeMethod = describeLightcurveModel(generated);
  const parsed = parseJsonObject(generated.text);
  if (parsed) {
    return {
      mos: clamp(Number(parsed.mos ?? 3.4), 1, 5),
      taskCompletion: clamp(Number(parsed.taskCompletion ?? 0.55), 0, 1),
      captureAccuracy: clamp(Number(parsed.captureAccuracy ?? 0.75), 0, 1),
      method: judgeMethod,
      rationale: stringValue(parsed.rationale, `Judged with ${judgeMethod}.`),
      recommendation: stringValue(parsed.recommendation, 'Tighten the prompt around verification and next-step confirmation.'),
    };
  }

  const agentText = transcript.filter((turn) => turn.speaker === 'agent').map((turn) => turn.text.toLowerCase()).join(' ');
  const confirms = /\b(confirm|verify|repeat|next step|escalat|refund|book|cancel|policy|lookup|check)\b/.test(agentText);
  const vague = /\b(maybe|probably|not sure|i guess|might)\b/.test(agentText);
  const taskCompletion = clamp((confirms ? 0.82 : 0.58) - (vague ? 0.18 : 0), 0, 1);
  const mos = clamp(3.45 + taskCompletion * 0.75 - Math.max(0, latencyP95 - 1600) / 4000, 1, 5);
  return {
    mos,
    taskCompletion,
    captureAccuracy: confirms ? 0.86 : 0.62,
    method: 'heuristic-fallback',
    rationale: 'Fallback judge used because Vertex AI/Gemini did not return structured JSON.',
    recommendation: confirms
      ? 'Run a provider-backed realism check for audio quality and interruption handling.'
      : 'Prompt the agent to verify captured details and give a concrete next action before ending the call.',
  };
}

export function isStubAgentExperiment(experiment: Pick<ExperimentRow, 'agentType' | 'agentConfig'>) {
  return experiment.agentType === 'stub_agent' || asRecord(experiment.agentConfig).mode === 'stub_agent';
}

export async function executeStubAgentRun(
  runId: string,
  experiment: ExperimentRow,
  run: RunRow,
  scenario: ScenarioRow,
) {
  const startedAt = new Date();
  await db
    .update(runs)
    .set({
      status: 'running',
      provider: 'stub_agent',
      externalCallId: `stub_${runId}`,
      externalStatus: 'stub_running',
      startedAt,
      failureSummary: null,
    })
    .where(eq(runs.id, runId));
  await db.update(experiments).set({ status: 'running' }).where(eq(experiments.id, experiment.id));

  await db.delete(traces).where(eq(traces.runId, runId));
  await db.delete(scores).where(eq(scores.runId, runId));

  const maxTurns = Math.max(2, Math.min(8, Number(process.env.STUB_AGENT_MAX_TURNS ?? 4)));
  const transcript: TranscriptTurn[] = [];
  const traceRows: Array<typeof traces.$inferInsert> = [];
  const latencies: number[] = [];

  for (let index = 0; index < maxTurns; index += 1) {
    const callerText = callerLine(scenario, index);
    transcript.push({ speaker: 'caller', text: callerText });
    traceRows.push({
      runId,
      turnIndex: traceRows.length,
      speaker: 'caller',
      text: callerText,
      sttConfidence: 1,
      totalLatencyMs: 0,
    });

    const replyStartedAt = Date.now();
    const agentText = await generateStubReply(experiment, scenario, transcript);
    const latencyMs = clamp(Date.now() - replyStartedAt + 260, 420, 2600);
    latencies.push(latencyMs);
    transcript.push({ speaker: 'agent', text: agentText, latencyMs });
    traceRows.push({
      runId,
      turnIndex: traceRows.length,
      speaker: 'agent',
      text: agentText,
      sttConfidence: 0.98,
      totalLatencyMs: latencyMs,
    });
  }

  if (traceRows.length) await db.insert(traces).values(traceRows);

  const latencyP95 = percentile(latencies, 95);
  const judged = await judgeStubRun(experiment, scenario, transcript, latencyP95);
  const passed = judged.mos >= 3.8 && judged.taskCompletion >= 0.8;
  const endedAt = new Date();
  const simulatedMinutes = Number(Math.max(0.35, transcript.length * 0.16).toFixed(3));
  const durationMs = Math.max(1, Math.round(simulatedMinutes * 60_000));
  const failureSummary = passed ? null : `Agent replica gate failed: MOS ${judged.mos.toFixed(1)}, task ${Math.round(judged.taskCompletion * 100)}%. ${judged.recommendation}`;

  await db.insert(scores).values([
    {
      runId,
      metricName: 'mos',
      value: Number(judged.mos.toFixed(2)),
      method: `agent-replica:${judged.method}:audio-proxy`,
      rationale: judged.rationale,
    },
    {
      runId,
      metricName: 'task_completed',
      value: Number(judged.taskCompletion.toFixed(3)),
      method: `agent-replica:${judged.method}`,
      rationale: judged.recommendation,
    },
    {
      runId,
      metricName: 'capture_overall',
      value: Number(judged.captureAccuracy.toFixed(3)),
      method: `agent-replica:${judged.method}:capture-judge`,
      rationale: 'Measures whether the agent captured, confirmed, or safely clarified critical details.',
    },
    {
      runId,
      metricName: 'latency_p95',
      value: latencyP95,
      method: 'agent-replica-simulated-latency',
      rationale: 'Proxy latency for low-cost testing before provider-backed realtime runs.',
    },
  ]);

  const updatedRun = await db
    .update(runs)
    .set({
      status: passed ? 'complete' : 'failed',
      provider: 'stub_agent',
      externalStatus: passed ? 'stub_completed' : 'stub_failed',
      turnCount: transcript.length,
      durationMs,
      failureSummary,
      endedAt,
    })
    .where(eq(runs.id, runId))
    .returning();

  const existingUsage = await db
    .select()
    .from(usageEvents)
    .where(and(eq(usageEvents.sourceRunId, runId), eq(usageEvents.eventType, 'stub_agent_run_completed')))
    .limit(1);
  if (!existingUsage.length && run.ownerUserId && passed) {
    await db.insert(usageEvents).values({
      ownerUserId: run.ownerUserId,
      eventType: 'stub_agent_run_completed',
      minutes: simulatedMinutes,
      actions: Math.max(1, transcript.length),
      sourceRunId: runId,
      sourceExperimentId: run.experimentId,
    });
  }

  if (run.experimentId) {
    const siblingRuns = await db.select().from(runs).where(eq(runs.experimentId, run.experimentId));
    const allTerminal = siblingRuns.every((item) => item.id === runId || item.status === 'complete' || item.status === 'failed');
    if (allTerminal) {
      const finalRuns = siblingRuns.map((item) => (item.id === runId ? updatedRun[0] : item));
      const failed = finalRuns.some((item) => item.status === 'failed');
      await db
        .update(experiments)
        .set({ status: failed ? 'failed' : 'completed', completedAt: new Date() })
        .where(eq(experiments.id, run.experimentId));
    }
  }

  return {
    run: updatedRun[0],
    transcript,
    scores: judged,
  };
}
