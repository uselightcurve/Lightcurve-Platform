import { COST_LANES, costLaneForProvider, type CostLaneId } from '@/lib/costLanes';

export const DEFAULT_RELEASE_GATE = {
  minMos: 3.8,
  minTask: 0.8,
};

type ExperimentLike = {
  id: string;
  agentType: string;
  agentConfig: unknown;
  webrtcEndpoint: string;
  status: string | null;
};

type RunLike = {
  id: string;
  scenarioId: string | null;
  status: string | null;
  failureSummary: string | null;
};

type ScoreLike = {
  runId: string | null;
  metricName: string | null;
  value: number | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function scoreValue(scores: ScoreLike[], runId: string, metricName: string) {
  const value = scores.find((score) => score.runId === runId && score.metricName === metricName)?.value;
  return typeof value === 'number' ? value : null;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function promotedFromExperimentId(agentConfig: unknown) {
  const config = asRecord(agentConfig);
  const promotion = asRecord(config.promotion);
  const value = promotion.sourceExperimentId ?? config.promotedFromExperimentId;
  return typeof value === 'string' && value ? value : null;
}

export function releaseWorkflowForExperiment(
  experiment: ExperimentLike,
  runs: RunLike[],
  scores: ScoreLike[],
  gate = DEFAULT_RELEASE_GATE,
) {
  const sourceLane = costLaneForProvider(experiment.agentType, experiment.agentConfig, experiment.webrtcEndpoint);
  const sourceLaneLabel = COST_LANES[sourceLane].label;
  const promotedFromId = promotedFromExperimentId(experiment.agentConfig);
  const isPromotedVerification = Boolean(promotedFromId);

  const terminalRuns = runs.filter((run) => run.status === 'complete' || run.status === 'failed');
  const failedRuns = runs.filter((run) => run.status === 'failed');
  const pendingRuns = runs.filter((run) => run.status === 'pending' || run.status === 'running' || run.status === 'evaluating');
  const mosValues = scores
    .filter((score) => score.metricName === 'mos' && typeof score.value === 'number')
    .map((score) => score.value as number);
  const taskValues = scores
    .filter((score) => score.metricName === 'task_completed' && typeof score.value === 'number')
    .map((score) => score.value as number);

  const riskyRuns = runs.filter((run) => {
    const mos = scoreValue(scores, run.id, 'mos');
    const task = scoreValue(scores, run.id, 'task_completed');
    return run.status === 'failed' || (mos !== null && mos < gate.minMos) || (task !== null && task < gate.minTask);
  });
  const riskyScenarioIds = Array.from(
    new Set(riskyRuns.map((run) => run.scenarioId).filter((value): value is string => Boolean(value))),
  );

  const avgMos = average(mosValues);
  const avgTask = average(taskValues);
  const passRate = terminalRuns.length ? (terminalRuns.length - failedRuns.length) / terminalRuns.length : null;
  const gatePassed =
    pendingRuns.length === 0 &&
    terminalRuns.length > 0 &&
    failedRuns.length === 0 &&
    (avgMos === null || avgMos >= gate.minMos) &&
    (avgTask === null || avgTask >= gate.minTask);

  let releaseStage: 'low_cost_screen' | 'needs_real_verification' | 'promoted_real_check' | 'final_pass' | 'final_block' | 'pending';
  let releaseLabel: string;
  let releaseMessage: string;

  if (pendingRuns.length > 0 || terminalRuns.length === 0) {
    releaseStage = 'pending';
    releaseLabel = 'Running sandbox';
    releaseMessage = 'Lightcurve is still collecting run evidence before it can issue a release signal.';
  } else if (isPromotedVerification) {
    releaseStage = gatePassed ? 'final_pass' : 'final_block';
    releaseLabel = gatePassed ? 'Final release signal: ship' : 'Final release signal: block';
    releaseMessage = gatePassed
      ? 'The promoted real-call verification suite passed the release gate.'
      : 'The promoted real-call verification suite still has failures. Do not ship until the failed scenarios are fixed.';
  } else if (sourceLane === 'low_cost_testing' && riskyScenarioIds.length > 0) {
    releaseStage = 'needs_real_verification';
    releaseLabel = 'Simulation found risky cases';
    releaseMessage =
      'Broad simulated testing found failed scenarios. Promote only these failures to real phone verification before making a final release decision.';
  } else if (sourceLane === 'low_cost_testing') {
    releaseStage = 'low_cost_screen';
    releaseLabel = 'Simulation suite passed';
    releaseMessage =
      'Broad simulated testing passed. Run a small real phone verification only if this release needs carrier-level realism.';
  } else {
    releaseStage = gatePassed ? 'final_pass' : 'final_block';
    releaseLabel = gatePassed ? 'Final release signal: ship' : 'Final release signal: block';
    releaseMessage = gatePassed
      ? 'The verification suite passed the release gate.'
      : 'The verification suite failed the release gate.';
  }

  return {
    gate,
    sourceLane,
    sourceLaneLabel,
    promotedFromId,
    isPromotedVerification,
    releaseStage,
    releaseLabel,
    releaseMessage,
    canPromoteFailures: sourceLane === 'low_cost_testing' && riskyScenarioIds.length > 0,
    riskyRuns,
    riskyScenarioIds,
    avgMos,
    avgTask,
    passRate,
    gatePassed,
    failedRuns,
    pendingRuns,
  };
}

export function preferredVerificationProvider(sourceLane: CostLaneId) {
  return sourceLane === 'low_cost_testing' ? 'livekit' : 'custom_webrtc';
}
