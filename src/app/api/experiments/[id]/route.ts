import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, datasetCases, datasets, experiments, runs, scores } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { isMockMode, mockExperimentDetail } from '@/lib/mockData';


function object(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function edges(paths: unknown) {
  if (!Array.isArray(paths)) return new Set<string>();
  const result = new Set<string>();
  for (const path of paths) {
    if (!Array.isArray(path)) continue;
    for (let index = 1; index < path.length; index += 1) result.add(`${path[index - 1]}->${path[index]}`);
  }
  return result;
}

function graphPaths(graph: Record<string, unknown>) {
  if (Array.isArray(graph.allowedPaths) && graph.allowedPaths.length) return graph.allowedPaths;
  const observed = Array.isArray(graph.observedPath) ? graph.observedPath : Array.isArray(graph.nodes) ? graph.nodes : [];
  const ids = observed.flatMap((node) => {
    const value = object(node);
    return typeof value.id === 'string' ? [value.id] : typeof node === 'string' ? [node] : [];
  });
  return ids.length ? [ids] : [];
}

function counted(values: string[]) {
  return Object.entries(values.reduce<Record<string, number>>((all, value) => {
    all[value] = (all[value] ?? 0) + 1;
    return all;
  }, {})).sort((left, right) => right[1] - left[1]).map(([label, count]) => ({ label, count }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isMockMode()) {
    const detail = mockExperimentDetail(id);
    if (!detail) return NextResponse.json({ error: 'Experiment not found.' }, { status: 404 });
    return NextResponse.json(detail);
  }
  try {
    const account = await requireAccount();
    const [row] = await db.select({ experiment: experiments, dataset: datasets, runtime: agentRuntimes })
      .from(experiments)
      .innerJoin(datasets, eq(datasets.id, experiments.datasetId))
      .leftJoin(agentRuntimes, eq(agentRuntimes.id, experiments.runtimeId))
      .where(and(eq(experiments.id, id), eq(experiments.ownerUserId, account.userId)))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Experiment not found.' }, { status: 404 });
    const runRows = await db.select().from(runs).where(eq(runs.experimentId, id));
    const caseIds = runRows.flatMap((run) => run.caseId ? [run.caseId] : []);
    const cases = caseIds.length ? await db.select().from(datasetCases).where(inArray(datasetCases.id, caseIds)) : [];
    const runIds = runRows.map((run) => run.id);
    const scoreRows = runIds.length ? await db.select().from(scores).where(inArray(scores.runId, runIds)) : [];
    const scoreMap = new Map<string, Map<string, number>>();
    for (const score of scoreRows) {
      if (!score.runId || !score.metricName || typeof score.value !== 'number') continue;
      const metrics = scoreMap.get(score.runId) ?? new Map<string, number>();
      metrics.set(score.metricName, score.value);
      scoreMap.set(score.runId, metrics);
    }
    const terminalRuns = runRows.filter((run) => ['complete', 'failed', 'scoring_failed'].includes(run.status));
    const selectedEdges = edges(runRows.map((run) => object(run.replayManifest).graphPath));
    const expectedEdges = new Set<string>();
    for (const item of cases) {
      const graph = object(item.behaviorGraph);
      for (const edge of edges(graphPaths(graph))) expectedEdges.add(`${item.id}:${edge}`);
    }
    const selectedCaseEdges = new Set<string>();
    for (const run of runRows) {
      for (const edge of edges([object(run.replayManifest).graphPath])) selectedCaseEdges.add(`${run.caseId}:${edge}`);
    }
    const failuresByEnvironment = Object.entries(runRows.filter((run) => run.status === 'failed').reduce<Record<string, number>>((all, run) => {
      const environment = String(object(run.replayManifest).environment ?? 'unknown');
      all[environment] = (all[environment] ?? 0) + 1;
      return all;
    }, {})).map(([environment, count]) => ({ environment, count }));
    const failedRuns = runRows.filter((run) => run.status === 'failed' || run.status === 'scoring_failed');
    const judgeRecords = failedRuns.map((run) => object(run.judgeMetadata));
    const metricValues = (name: string) => runRows.flatMap((run) => {
      const value = scoreMap.get(run.id)?.get(name);
      return typeof value === 'number' ? [value] : [];
    });
    const summary = {
      total: runRows.length,
      completed: terminalRuns.length,
      passRate: terminalRuns.length ? terminalRuns.filter((run) => run.status === 'complete').length / terminalRuns.length : null,
      edgeCoverage: expectedEdges.size ? selectedCaseEdges.size / expectedEdges.size : selectedEdges.size ? 1 : 0,
      edgeCount: selectedCaseEdges.size,
      expectedEdgeCount: expectedEdges.size,
      effectiveConcurrency: row.experiment.effectiveConcurrency,
      visqol: { average: average(metricValues('visqol_mos')), values: metricValues('visqol_mos') },
      dnsmos: { average: average(metricValues('dnsmos_overall')), values: metricValues('dnsmos_overall') },
      geminiQuality: { average: average(metricValues('gemini_conversation_quality')), values: metricValues('gemini_conversation_quality') },
      latencyBehavior: average(metricValues('latency_behavior')),
      interruptionHandling: average(metricValues('interruption_handling')),
      failuresByEnvironment,
      failureClusters: {
        graphNodes: counted(judgeRecords.flatMap((judge) => typeof judge.failingGraphNode === 'string' ? [judge.failingGraphNode] : [])),
        pressurePoints: counted(judgeRecords.flatMap((judge) => typeof judge.pressurePoint === 'string' ? [judge.pressurePoint] : [])),
        taxonomy: counted(judgeRecords.flatMap((judge) => Array.isArray(judge.failureTaxonomy) ? judge.failureTaxonomy.filter((item): item is string => typeof item === 'string') : [])),
      },
    };
    return NextResponse.json({ ...row, runs: runRows, cases, scores: scoreRows, summary });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Experiment could not be loaded.' }, { status: 500 });
  }
}
