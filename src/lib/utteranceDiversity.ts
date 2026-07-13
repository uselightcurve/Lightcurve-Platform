import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { replayUtterances, runs } from '@/db/schema';
import { generateTextEmbedding } from '@/lib/llm';

function vector(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export async function checkAndStoreReplayUtterance(params: { runId: string; experimentId: string; nodeId: string; text: string }) {
  const embedding = await generateTextEmbedding(params.text);
  const existing = await db.select({ embedding: replayUtterances.embedding })
    .from(replayUtterances)
    .innerJoin(runs, eq(runs.id, replayUtterances.runId))
    .where(and(eq(runs.experimentId, params.experimentId), eq(replayUtterances.nodeId, params.nodeId), ne(runs.id, params.runId)));
  const nearestSimilarity = existing.reduce((nearest, item) => Math.max(nearest, cosineSimilarity(embedding, vector(item.embedding))), 0);
  if (nearestSimilarity >= 0.92) return { accepted: false as const, nearestSimilarity };
  await db.insert(replayUtterances).values({
    runId: params.runId,
    nodeId: params.nodeId,
    text: params.text,
    embedding,
    nearestSimilarity,
  }).onConflictDoUpdate({
    target: [replayUtterances.runId, replayUtterances.nodeId],
    set: { text: params.text, embedding, nearestSimilarity },
  });
  return { accepted: true as const, nearestSimilarity };
}
