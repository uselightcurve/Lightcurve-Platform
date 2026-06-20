import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  captureEvents,
  captureSessions,
  datasetCases,
  datasetCaseVersions,
  datasets,
} from '@/db/schema';
import { generateWithLightcurveModel } from '@/lib/vertex';

type TranscriptTurn = {
  speaker: 'human' | 'agent';
  text: string;
  startedAtMs?: number;
  endedAtMs?: number;
};

function asTurns(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const speaker = row.speaker === 'agent' ? 'agent' : row.speaker === 'human' || row.speaker === 'caller' ? 'human' : null;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!speaker || !text) return [];
    return [{
      speaker,
      text,
      startedAtMs: typeof row.startedAtMs === 'number' ? row.startedAtMs : undefined,
      endedAtMs: typeof row.endedAtMs === 'number' ? row.endedAtMs : undefined,
    }];
  });
}

function redactText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[PHONE]')
    .replace(/\b\d{8,}\b/g, '[NUMBER]');
}

function parseModelJson(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed as Record<string, unknown> & { nodes: unknown[]; edges: unknown[] };
  } catch {
    return null;
  }
}

async function buildBehaviorGraph(
  turns: TranscriptTurn[],
  events: Array<typeof captureEvents.$inferSelect>,
  outcome: unknown,
): Promise<Record<string, unknown>> {
  const observedNodes = turns.map((turn, index) => ({
    id: `turn_${index + 1}`,
    kind: turn.speaker === 'human' ? 'human_behavior' : 'agent_response',
    speaker: turn.speaker,
    observedText: turn.text,
    intent: turn.speaker === 'human' ? 'preserve_observed_intent' : undefined,
    startedAtMs: turn.startedAtMs,
    endedAtMs: turn.endedAtMs,
  }));
  const observedEdges = observedNodes.slice(1).map((node, index) => ({
    from: observedNodes[index].id,
    to: node.id,
    condition: 'observed_transition',
  }));
  const shared = {
    schema: 'lightcurve.human_behavior_graph.v1',
    source: 'human_playground_call',
    observedPath: observedNodes,
    timing: events
      .filter((event) => ['speech_started', 'speech_stopped', 'interruption'].includes(event.eventType))
      .map((event) => ({ type: event.eventType, speaker: event.speaker, atMs: event.timestampMs })),
    tools: events
      .filter((event) => event.eventType.startsWith('tool_'))
      .map((event) => ({ type: event.eventType, atMs: event.timestampMs, payload: event.payload })),
    terminalOutcome: outcome ?? 'review_required',
    replayPolicy: {
      preserveIntent: true,
      preserveFacts: true,
      allowParaphrase: true,
      allowTimingVariation: true,
      allowInterruptionVariation: true,
      unconstrainedCallerGeneration: false,
    },
  };

  const redactedTranscript = turns.map((turn) => `${turn.speaker}: ${redactText(turn.text)}`).join('\n');
  const modelResult = await generateWithLightcurveModel('gemini-2.5-flash', `
Convert this real human-to-agent voice call into a constrained behavioral test graph.
Return JSON only with: nodes, edges, humanGoal, facts, pressurePoints, terminalOutcomes,
variationAxes, and successCriteria. Nodes need id, kind, speaker, intentOrResponseClass,
state, and constraints. Edges need from, to, and condition. Preserve observed human
behavior and facts. Add alternate branches only when they are direct behavioral
variations of the observed call. Never invent a new caller goal or an unconstrained
persona. PII placeholders must remain placeholders.

Transcript:
${redactedTranscript}
`);
  const inferred = parseModelJson(modelResult);
  if (!inferred) return { ...shared, nodes: observedNodes, edges: observedEdges, derivation: 'observed_fallback' };
  return { ...inferred, ...shared, derivation: 'model_enriched_redacted' };
}

export async function ensurePlaygroundDataset(ownerUserId: string) {
  const [existing] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.ownerUserId, ownerUserId), eq(datasets.name, 'Playground Captures')))
    .limit(1);
  if (existing) return existing;

  const [created] = await db.insert(datasets).values({
    ownerUserId,
    name: 'Playground Captures',
    description: 'Human-grounded voice cases captured in the Playground.',
    visibility: 'private',
    sourceType: 'playground_capture',
  }).returning();
  return created;
}

export async function deriveCaseFromCapture(params: {
  ownerUserId: string;
  captureSessionId: string;
  datasetId?: string;
  name?: string;
  language?: string;
  domain?: string;
}) {
  const [capture] = await db
    .select()
    .from(captureSessions)
    .where(and(
      eq(captureSessions.id, params.captureSessionId),
      eq(captureSessions.ownerUserId, params.ownerUserId),
    ))
    .limit(1);
  if (!capture) throw new Error('Capture session not found.');

  const targetDataset = params.datasetId
    ? (await db.select().from(datasets).where(and(
        eq(datasets.id, params.datasetId),
        eq(datasets.ownerUserId, params.ownerUserId),
      )).limit(1))[0]
    : await ensurePlaygroundDataset(params.ownerUserId);
  if (!targetDataset) throw new Error('Dataset not found.');

  const events = await db
    .select()
    .from(captureEvents)
    .where(eq(captureEvents.captureSessionId, capture.id))
    .orderBy(captureEvents.sequence);
  const turns = asTurns(capture.transcript);
  if (!turns.some((turn) => turn.speaker === 'human') || !turns.some((turn) => turn.speaker === 'agent')) {
    throw new Error('A complete human and agent transcript is required before this call can become a dataset Case.');
  }
  const behaviorGraph = await buildBehaviorGraph(
    turns,
    events,
    (capture.metadata as Record<string, unknown> | null)?.outcome,
  );
  const inferredCriteria = Array.isArray(behaviorGraph.successCriteria) ? behaviorGraph.successCriteria : [];
  const successCriteria = inferredCriteria.length ? inferredCriteria : [
    { type: 'outcome_match', description: 'Reach the approved outcome from the human call.', weight: 0.5 },
    { type: 'behavioral_path', description: 'Handle the captured human decision path correctly.', weight: 0.25 },
    { type: 'latency', description: 'Respond without regressions in conversational latency.', weight: 0.15 },
    { type: 'interruption', description: 'Respect interruption and barge-in behavior.', weight: 0.1 },
  ];

  const nextDatasetVersion = targetDataset.currentVersion + 1;
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(datasetCases).values({
      datasetId: targetDataset.id,
      sourceCaptureId: capture.id,
      name: params.name?.trim() || `Human call ${new Date().toISOString().slice(0, 10)}`,
      language: params.language || 'en-US',
      domain: params.domain || 'general',
      status: 'approved',
      visibility: 'private',
      behaviorGraph,
      successCriteria,
      provenance: {
        source: 'playground_capture',
        captureSessionId: capture.id,
        humanDerived: true,
        derivedAt: new Date().toISOString(),
      },
    }).returning();

    await tx.insert(datasetCaseVersions).values({
      caseId: created.id,
      datasetVersion: nextDatasetVersion,
      graphVersion: 1,
      behaviorGraph,
      successCriteria,
    });
    await tx.update(datasets).set({
      currentVersion: nextDatasetVersion,
      updatedAt: new Date(),
    }).where(eq(datasets.id, targetDataset.id));
    return { dataset: { ...targetDataset, currentVersion: nextDatasetVersion }, case: created };
  });
}

export function anonymizeBehaviorGraph(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const graph = structuredClone(value as Record<string, unknown>);
  const sanitizeNodes = (nodes: unknown[]) => nodes.map((node) => {
      if (!node || typeof node !== 'object') return node;
      const clean = { ...(node as Record<string, unknown>) };
      delete clean.observedText;
      return clean;
    });
  if (Array.isArray(graph.nodes)) graph.nodes = sanitizeNodes(graph.nodes);
  if (Array.isArray(graph.observedPath)) graph.observedPath = sanitizeNodes(graph.observedPath);
  return graph;
}
