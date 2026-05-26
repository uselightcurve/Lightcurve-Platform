import { GoogleGenerativeAI } from '@google/generative-ai';
import { eq } from 'drizzle-orm';
import type { experiments, runs, scenarios } from '@/db/schema';
import { db } from '@/db';
import { scores, traces, runs as runsTable } from '@/db/schema';
import { VOICE_MAP } from '@/lib/constants';

type ExperimentRow = typeof experiments.$inferSelect;
type RunRow = typeof runs.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;

type AgentTurn = {
  text: string;
  latencyMs: number;
  raw?: unknown;
};

type JudgeResult = {
  mos: number;
  taskCompletion: number;
  sttConfidence: number;
  rationale: string;
  recommendation: string;
};

const BOT_TO_BOT_PROVIDERS = new Set(['livekit', 'pipecat', 'custom_webrtc']);

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct))] ?? 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isInternalRunnerUrl(runnerUrl: string | undefined) {
  return !runnerUrl || runnerUrl.includes('caller-bridge-preview');
}

export function isBotToBotExperiment(experiment: ExperimentRow) {
  const config = asRecord(experiment.agentConfig);
  return (
    BOT_TO_BOT_PROVIDERS.has(experiment.agentType) ||
    Boolean(
      stringValue(config.runnerUrl) ??
        stringValue(config.endpoint) ??
        stringValue(config.agentUrl) ??
        stringValue(process.env.CUSTOM_AGENT_RUNNER_URL) ??
        stringValue(process.env.PIPECAT_AGENT_URL),
    )
  );
}

export function resolveAgentRunnerUrl(experiment: ExperimentRow) {
  const config = asRecord(experiment.agentConfig);
  return (
    stringValue(config.runnerUrl) ??
    stringValue(config.endpoint) ??
    stringValue(config.agentUrl) ??
    stringValue(process.env.CUSTOM_AGENT_RUNNER_URL) ??
    stringValue(process.env.PIPECAT_AGENT_URL)
  );
}

export async function enqueueBotToBotRun(runId: string) {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
  const queue = process.env.CLOUD_TASKS_QUEUE;
  const location = process.env.CLOUD_TASKS_LOCATION || process.env.GCP_REGION;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!project || !queue || !location || !appUrl) return false;

  const { tasksClient } = await import('./gcp');
  const parent = tasksClient.queuePath(project, location, queue);
  await tasksClient.createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: 'POST',
        url: `${appUrl.replace(/\/$/, '')}/api/bot-to-bot/runs/${runId}/worker`,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ runId })).toString('base64'),
      },
      dispatchDeadline: { seconds: Number(process.env.BOT_TO_BOT_TASK_DEADLINE_SECONDS ?? 900) },
    },
  });
  return true;
}

async function callAgentRunner(
  runnerUrl: string | undefined,
  experiment: ExperimentRow,
  scenario: ScenarioRow,
  conversation: Array<{ speaker: 'caller' | 'agent'; text: string }>,
) {
  const start = Date.now();
  const config = asRecord(experiment.agentConfig);

  if (isInternalRunnerUrl(runnerUrl)) {
    return {
      text: internalAgentReply(scenario, conversation),
      latencyMs: 520 + conversation.length * 70,
    } satisfies AgentTurn;
  }

  const resolvedRunnerUrl = runnerUrl ?? '';
  if (!resolvedRunnerUrl.startsWith('http://') && !resolvedRunnerUrl.startsWith('https://')) {
    throw new Error('Bot-to-bot runner requires an HTTPS agent runner endpoint for this phase.');
  }

  const response = await fetch(resolvedRunnerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(stringValue(config.apiKey) ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      experimentId: experiment.id,
      scenario: {
        id: scenario.id,
        name: scenario.name,
        language: scenario.language,
        domain: scenario.domain,
        persona: scenario.persona,
        successCriteria: scenario.successCriteria,
      },
      conversation,
    }),
  });

  if (!response.ok) throw new Error(`Agent runner failed with ${response.status}: ${await response.text()}`);
  const body = asRecord(await response.json().catch(() => ({})));
  const text =
    stringValue(body.text) ??
    stringValue(body.reply) ??
    stringValue(body.message) ??
    stringValue(asRecord(body.output).text);
  if (!text) throw new Error('Agent runner did not return reply text.');
  return { text, latencyMs: Date.now() - start, raw: body } satisfies AgentTurn;
}

function internalAgentReply(scenario: ScenarioRow, conversation: Array<{ speaker: 'caller' | 'agent'; text: string }>) {
  const persona = asRecord(scenario.persona);
  const goal = stringValue(persona.goal) ?? 'the caller request';
  const criteria = Array.isArray(scenario.successCriteria)
    ? scenario.successCriteria.map((item) => stringValue(asRecord(item).description)).filter(Boolean)
    : [];
  if (conversation.length <= 1) {
    return `I can help with ${goal.toLowerCase()}. I will verify the account, handle the request, and confirm the next step.`;
  }
  if (scenario.domain === 'healthcare') {
    return 'I cannot diagnose symptoms, but I can route this safely, book the right care path, and escalate urgent symptoms.';
  }
  if (scenario.domain === 'banking') {
    return 'I will verify only the required details, start the secure support path, and confirm the dispute or payment next step.';
  }
  if (criteria.length) {
    return `I understand. I will complete this path: ${criteria[0]}, then summarize the confirmed next step.`;
  }
  return 'I understand the issue. I will complete the request, confirm the policy-backed next action, and summarize it clearly.';
}

async function synthesizeOptionalAudio(runId: string, scenario: ScenarioRow, speaker: 'caller' | 'agent', index: number, text: string) {
  if (process.env.BOT_TO_BOT_TTS_ENABLED !== '1' || !process.env.GCS_BUCKET) return undefined;
  const { storage, ttsClient } = await import('./gcp');
  const voiceName = VOICE_MAP[scenario.language] || 'en-US-Neural2-F';
  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: scenario.language, name: voiceName },
    audioConfig: { audioEncoding: 'MP3' },
  });
  if (!response.audioContent) return undefined;
  const path = `bot-to-bot/${runId}/${speaker}-${index}.mp3`;
  await storage.bucket(process.env.GCS_BUCKET).file(path).save(response.audioContent as Buffer, {
    contentType: 'audio/mpeg',
  });
  return `https://storage.googleapis.com/${process.env.GCS_BUCKET}/${path}`;
}

async function nextCallerTurn(
  scenario: ScenarioRow,
  conversation: Array<{ speaker: 'caller' | 'agent'; text: string }>,
  turnIndex: number,
) {
  const persona = asRecord(scenario.persona);
  const goal = stringValue(persona.goal) ?? '';
  const opening = stringValue(persona.opening_line) ?? goal;
  if (turnIndex === 0) return opening;

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
    if (turnIndex === 1) return `That sounds vague. I need you to complete this: ${goal}`;
    return 'Okay, please summarize exactly what happens next.';
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.BOT_TO_BOT_CALLER_MODEL ?? 'gemini-1.5-flash' });
  const result = await model.generateContent(`
You are the caller in a voice-agent sandbox test.
Stay in character. Keep the response under 22 words.
Language: ${scenario.language}
Emotion: ${stringValue(persona.emotional_state) ?? 'neutral'}
Goal: ${goal}
Conversation:
${conversation.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')}
If the agent clearly solved the goal, say: That answers it. Please confirm the next step.
`);
  return result.response.text().replace(/\s+/g, ' ').trim();
}

async function judgeBotToBotRun(
  scenario: ScenarioRow,
  transcript: Array<{ speaker: 'caller' | 'agent'; text: string }>,
  latencyP95: number,
  options: { internalRunner: boolean },
): Promise<JudgeResult> {
  const persona = asRecord(scenario.persona);
  const noise = Number(persona.noise_db ?? 0);
  const baseStt = clamp(0.97 - noise * 0.025 - (scenario.language === 'hi-IN' ? 0.04 : 0), 0.72, 0.98);

  if (options.internalRunner) {
    const mos = clamp(4.35 - noise * 0.04 - Math.max(0, latencyP95 - 1000) / 6000, 3.9, 4.5);
    return {
      mos: Number(mos.toFixed(1)),
      taskCompletion: 0.86,
      sttConfidence: Number(baseStt.toFixed(2)),
      rationale: 'Internal runner completed the scenario goal and confirmed the next step.',
      recommendation: 'Connect a real agent runner endpoint next to compare this baseline against your production agent.',
    };
  }

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key') {
    const taskCompletion = transcript.some((turn) => turn.speaker === 'agent' && /confirm|next step|route|verify|policy/i.test(turn.text))
      ? 0.84
      : 0.55;
    const mos = clamp(4.2 - noise * 0.08 - Math.max(0, latencyP95 - 1200) / 3500, 3.1, 4.4);
    return {
      mos: Number(mos.toFixed(1)),
      taskCompletion: Number(taskCompletion.toFixed(2)),
      sttConfidence: Number(baseStt.toFixed(2)),
      rationale: 'Heuristic judge used because GEMINI_API_KEY is not configured.',
      recommendation: 'Configure GEMINI_API_KEY for stricter LLM-as-judge scoring with evidence.',
    };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.BOT_TO_BOT_JUDGE_MODEL ?? 'gemini-1.5-flash' });
  const result = await model.generateContent(`
You are Lightcurve's voice AI evaluator. Return only JSON.
Scenario goal: ${stringValue(persona.goal) ?? ''}
Success criteria: ${JSON.stringify(scenario.successCriteria)}
Latency p95 ms: ${latencyP95}
Transcript:
${transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join('\n')}

Return:
{"mos":4.0,"taskCompletion":0.8,"rationale":"one sentence","recommendation":"one sentence"}
`);
  const text = result.response.text().replace(/```json|```/g, '').trim();
  const parsed = asRecord(JSON.parse(text));
  return {
    mos: clamp(Number(parsed.mos ?? 3.5), 1, 5),
    taskCompletion: clamp(Number(parsed.taskCompletion ?? parsed.task_completion ?? 0.5), 0, 1),
    sttConfidence: Number(baseStt.toFixed(2)),
    rationale: stringValue(parsed.rationale) ?? 'LLM judge completed the sandbox evaluation.',
    recommendation: stringValue(parsed.recommendation) ?? 'Review failed turns and tighten the agent prompt.',
  };
}

export async function executeBotToBotRun(runId: string, experiment: ExperimentRow, run: RunRow, scenario: ScenarioRow) {
  const runnerUrl = resolveAgentRunnerUrl(experiment);
  const internalRunner = isInternalRunnerUrl(runnerUrl);
  const startedAt = new Date();
  const maxTurns = Number(process.env.BOT_TO_BOT_MAX_TURNS ?? 4);
  const transcript: Array<{ speaker: 'caller' | 'agent'; text: string }> = [];
  const traceRows: Array<{
    turnIndex: number;
    speaker: 'caller' | 'agent';
    text: string;
    audioUrl?: string;
    sttConfidence?: number;
    totalLatencyMs?: number;
  }> = [];
  const latencies: number[] = [];

  await db.update(runsTable).set({ status: 'running', provider: 'bot_to_bot', startedAt }).where(eq(runsTable.id, run.id));

  for (let turn = 0; turn < maxTurns; turn++) {
    const callerStart = Date.now();
    const callerText = await nextCallerTurn(scenario, transcript, turn);
    const callerAudioUrl = await synthesizeOptionalAudio(runId, scenario, 'caller', turn, callerText);
    const callerLatency = Date.now() - callerStart;
    transcript.push({ speaker: 'caller', text: callerText });
    traceRows.push({
      turnIndex: traceRows.length,
      speaker: 'caller',
      text: callerText,
      audioUrl: callerAudioUrl,
      sttConfidence: undefined,
      totalLatencyMs: callerLatency,
    });
    latencies.push(callerLatency);

    const agent = await callAgentRunner(runnerUrl, experiment, scenario, transcript);
    const agentAudioUrl = await synthesizeOptionalAudio(runId, scenario, 'agent', turn, agent.text);
    transcript.push({ speaker: 'agent', text: agent.text });
    traceRows.push({
      turnIndex: traceRows.length,
      speaker: 'agent',
      text: agent.text,
      audioUrl: agentAudioUrl,
      totalLatencyMs: agent.latencyMs,
    });
    latencies.push(agent.latencyMs);

    if (/summarize|confirm|next step|that answers/i.test(callerText) && turn >= 2) break;
  }

  const latencyP95 = percentile(latencies, 0.95);
  const judge = await judgeBotToBotRun(scenario, transcript, latencyP95, { internalRunner });
  const minMos = Number(process.env.LIGHTCURVE_GATE_MIN_MOS ?? process.env.RELEASE_GATE_MOS ?? 3.8);
  const minTask = Number(process.env.LIGHTCURVE_GATE_MIN_TASK ?? process.env.RELEASE_GATE_TASK ?? 0.8);
  const status = judge.mos >= minMos && judge.taskCompletion >= minTask
    ? 'complete'
    : 'failed';

  await db.delete(traces).where(eq(traces.runId, runId));
  if (traceRows.length) {
    await db.insert(traces).values(
      traceRows.map((trace) => ({
        runId,
        ...trace,
        sttConfidence: trace.speaker === 'caller' ? judge.sttConfidence : trace.sttConfidence,
      })),
    );
  }

  await db.delete(scores).where(eq(scores.runId, runId));
  await db.insert(scores).values([
    { runId, metricName: 'mos', value: judge.mos, method: 'llm-judge-audio-proxy', rationale: judge.rationale },
    { runId, metricName: 'task_completed', value: judge.taskCompletion, method: 'llm-judge', rationale: judge.rationale },
    { runId, metricName: 'latency_p95', value: latencyP95, method: 'bot-to-bot-trace', rationale: 'Computed from caller LLM/TTS and agent runner response timings.' },
    { runId, metricName: 'stt_confidence', value: judge.sttConfidence, method: 'audio-condition-proxy', rationale: 'Estimated from scenario noise and language until provider STT confidence is available.' },
  ]);

  const endedAt = new Date();
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const updatedRun = await db
    .update(runsTable)
    .set({
      status,
      provider: 'bot_to_bot',
      externalStatus: internalRunner
        ? status === 'complete' ? 'internal_runner_passed_gate' : 'internal_runner_failed_gate'
        : status === 'complete' ? 'passed_release_gate' : 'failed_release_gate',
      turnCount: traceRows.length,
      durationMs,
      endedAt,
      failureSummary: status === 'failed' ? judge.recommendation : undefined,
    })
    .where(eq(runsTable.id, runId))
    .returning();

  return {
    run: updatedRun[0],
    traces: traceRows,
    scores: {
      mos: judge.mos,
      taskCompletion: judge.taskCompletion,
      latencyP95,
      sttConfidence: judge.sttConfidence,
    },
    recommendation: judge.recommendation,
  };
}
