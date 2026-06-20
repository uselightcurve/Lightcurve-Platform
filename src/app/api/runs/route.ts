import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, datasetCases, experiments, runs, scores, traces } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';

export async function GET() {
  try {
    const account = await requireAccount();
    const rows = await db.select({ run: runs, case: datasetCases, experiment: experiments, runtime: agentRuntimes })
      .from(runs)
      .leftJoin(datasetCases, eq(datasetCases.id, runs.caseId))
      .leftJoin(experiments, eq(experiments.id, runs.experimentId))
      .leftJoin(agentRuntimes, eq(agentRuntimes.id, experiments.runtimeId))
      .where(eq(runs.ownerUserId, account.userId))
      .orderBy(desc(runs.startedAt), desc(runs.endedAt), desc(runs.id));
    const runIds = rows.map((row) => row.run.id);
    const [scoreRows, traceRows] = await Promise.all([
      runIds.length ? db.select().from(scores).where(inArray(scores.runId, runIds)) : [],
      runIds.length ? db.select().from(traces).where(inArray(traces.runId, runIds)) : [],
    ]);
    return NextResponse.json({ runs: rows.map((row) => {
      const runScores = scoreRows.filter((score) => score.runId === row.run.id);
      const runTraces = traceRows.filter((trace) => trace.runId === row.run.id);
      const metric = (name: string) => runScores.find((score) => score.metricName === name)?.value ?? null;
      return {
        ...row.run,
        caseName: row.case?.name ?? 'Dataset case',
        language: row.case?.language ?? '-',
        domain: row.case?.domain ?? '-',
        agent: row.runtime?.name ?? 'SDK runtime',
        mos: metric('mos'),
        task: metric('task_completed') ?? metric('outcome_match'),
        latencyP95: metric('latency_p95'),
        transcript: runTraces.map((trace) => trace.text).filter(Boolean).join(' '),
        date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(row.run.startedAt ?? row.run.endedAt ?? new Date()),
        duration: row.run.durationMs ? `${Math.round(row.run.durationMs / 1000)}s` : '-',
      };
    }) });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Run logs are unavailable.' }, { status: 500 });
  }
}
