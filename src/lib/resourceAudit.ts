import type { experiments, runs, scores, traces } from '@/db/schema';

type RunRow = typeof runs.$inferSelect;
type ExperimentRow = typeof experiments.$inferSelect | null;
type TraceRow = typeof traces.$inferSelect;
type ScoreRow = typeof scores.$inferSelect;

export type ResourceAuditItemStatus = 'detected' | 'proxy' | 'external' | 'not_detected' | 'pending';

export type ResourceAuditItem = {
  label: string;
  status: ResourceAuditItemStatus;
  detail: string;
  estimatedCostUsd?: number;
};

export type ResourceAudit = {
  billable: boolean;
  testedMinutes: number;
  estimatedLightcurveCostUsd: number;
  providerSpend: 'none' | 'possible' | 'unknown';
  verdict: string;
  resources: ResourceAuditItem[];
};

const DEFAULT_COSTS = {
  liveKitRoomPerMinute: 0.002,
  callerTtsPerMinute: 0.001,
  agentSttPerMinute: 0.003,
  vertexJudgePerRun: 0.001,
};

function numberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase();
}

function isComplete(status: unknown) {
  const value = normalize(status);
  return value === 'complete' || value === 'completed';
}

function readExperimentConfig(experiment: ExperimentRow) {
  const config = experiment?.agentConfig;
  return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
}

function detectedStatus(condition: boolean, fallback: ResourceAuditItemStatus = 'not_detected'): ResourceAuditItemStatus {
  return condition ? 'detected' : fallback;
}

export function buildResourceAudit(args: {
  run: RunRow;
  experiment: ExperimentRow;
  traces: TraceRow[];
  scores: ScoreRow[];
}): ResourceAudit {
  const { run, experiment, traces, scores } = args;
  const config = readExperimentConfig(experiment);
  const provider = normalize(run.provider ?? config.provider ?? config.agentType);
  const lane = normalize(config.testingLane ?? config.connectionPath ?? config.connection_path ?? config.callMode);
  const statusIsComplete = isComplete(run.status);
  const testedMinutes = statusIsComplete && run.durationMs ? Number((run.durationMs / 60000).toFixed(3)) : 0;
  const hasUsableTranscript = traces.length > 0;
  const scoreText = scores.map((score) => `${score.metricName} ${score.method ?? ''} ${score.rationale ?? ''}`).join(' ').toLowerCase();
  const judgeMethods = scores
    .filter((score) => ['mos', 'task_completed', 'capture_overall'].includes(score.metricName ?? ''))
    .map((score) => score.method)
    .filter(Boolean) as string[];
  const hasProxyScore =
    scoreText.includes('proxy') ||
    scoreText.includes('heuristic') ||
    scoreText.includes('fallback') ||
    scoreText.includes('stub-agent');
  const hasVertexJudge = scoreText.includes('vertex-ai:');
  const hasGeminiApiJudge = scoreText.includes('gemini-api:');
  const hasModelJudge = hasVertexJudge || hasGeminiApiJudge;
  const isLightcurveRoom =
    provider === 'livekit' ||
    provider === 'lightcurve_room' ||
    lane.includes('lightcurve') ||
    lane.includes('livekit') ||
    run.externalStatus === 'livekit_room_ready';
  const isProviderPhone = ['vapi', 'retell', 'elevenlabs'].includes(provider) && Boolean(run.externalCallId);
  const hasCallerAudio =
    Boolean(run.audioCallerUrl) ||
    traces.some((trace) => trace.speaker === 'caller' && Boolean(trace.audioUrl));
  const hasAgentAudio =
    Boolean(run.audioAgentUrl) ||
    traces.some((trace) => trace.speaker === 'agent' && Boolean(trace.audioUrl));
  const hasAgentSttEvidence =
    traces.some((trace) => trace.speaker === 'agent' && trace.sttConfidence != null && Boolean(trace.audioUrl)) ||
    scoreText.includes('speech-to-text') ||
    scoreText.includes('google-stt');
  const hasLightcurveTtsEvidence =
    (isLightcurveRoom || lane.includes('bot') || provider === 'agent-replica') &&
    (hasCallerAudio || scoreText.includes('google-tts') || scoreText.includes('tts'));

  const costs = {
    liveKitRoomPerMinute: numberFromEnv('COST_LIVEKIT_ROOM_PER_MINUTE', DEFAULT_COSTS.liveKitRoomPerMinute),
    callerTtsPerMinute: numberFromEnv('COST_TTS_PER_TESTED_MINUTE', DEFAULT_COSTS.callerTtsPerMinute),
    agentSttPerMinute: numberFromEnv('COST_STT_PER_TESTED_MINUTE', DEFAULT_COSTS.agentSttPerMinute),
    vertexJudgePerRun: numberFromEnv('COST_VERTEX_JUDGE_PER_RUN', DEFAULT_COSTS.vertexJudgePerRun),
  };

  const resources: ResourceAuditItem[] = [];

  if (isLightcurveRoom) {
    resources.push({
      label: 'Lightcurve room',
      status: statusIsComplete && hasUsableTranscript ? 'detected' : run.status === 'running' ? 'pending' : 'not_detected',
      detail: statusIsComplete && hasUsableTranscript
        ? 'Realtime room path completed with transcript evidence.'
        : run.status === 'running'
          ? 'Room is open; waiting for agent/caller media.'
          : 'Room was created, but no completed media exchange was detected.',
      estimatedCostUsd: statusIsComplete && hasUsableTranscript ? testedMinutes * costs.liveKitRoomPerMinute : 0,
    });
  }

  resources.push({
    label: 'Caller TTS',
    status: detectedStatus(hasLightcurveTtsEvidence, hasProxyScore ? 'proxy' : 'not_detected'),
    detail: hasLightcurveTtsEvidence
      ? 'Synthetic caller audio was detected for this run.'
      : hasProxyScore
        ? 'Caller behavior was scored from transcript/proxy data; cloud TTS was not detected.'
        : 'No Lightcurve caller audio artifact detected.',
    estimatedCostUsd: statusIsComplete && hasLightcurveTtsEvidence ? testedMinutes * costs.callerTtsPerMinute : 0,
  });

  resources.push({
    label: 'Agent STT',
    status: detectedStatus(hasAgentSttEvidence, hasProxyScore ? 'proxy' : 'not_detected'),
    detail: hasAgentSttEvidence
      ? 'Agent audio transcription evidence was detected.'
      : hasProxyScore
        ? 'Agent transcript came from provider/proxy data; cloud STT was not detected.'
        : 'No agent audio STT evidence detected.',
    estimatedCostUsd: statusIsComplete && hasAgentSttEvidence ? testedMinutes * costs.agentSttPerMinute : 0,
  });

  resources.push({
    label: 'LLM judge',
    status: hasModelJudge ? 'detected' : hasProxyScore ? 'proxy' : scores.length ? 'pending' : 'not_detected',
    detail: hasModelJudge
      ? `Model scoring used ${judgeMethods.join(', ') || 'stored judge metadata'}.`
      : hasProxyScore
        ? 'Scoring used a proxy/fallback judge path.'
        : scores.length
          ? 'Scores exist, but the judge backend is not identifiable from stored metadata.'
          : 'No judge score has been stored yet.',
    estimatedCostUsd: statusIsComplete && hasModelJudge ? costs.vertexJudgePerRun : 0,
  });

  if (isProviderPhone) {
    resources.push({
      label: 'Provider phone path',
      status: 'external',
      detail: `${run.provider} call ${run.externalCallId} was used. Any provider/PSTN/model charge happens outside GCP credits.`,
    });
  }

  const estimatedLightcurveCostUsd = Number(
    resources.reduce((sum, resource) => sum + (resource.estimatedCostUsd ?? 0), 0).toFixed(6),
  );
  const billable = statusIsComplete && testedMinutes > 0 && (hasUsableTranscript || estimatedLightcurveCostUsd > 0);

  let verdict = 'Waiting for enough evidence to audit this run.';
  if (!statusIsComplete) {
    verdict = 'Not billable by Lightcurve until the run completes successfully.';
  } else if (!billable) {
    verdict = 'Completed without billable Lightcurve resource evidence. Treat as a setup/proxy run, not tested minutes.';
  } else if (isProviderPhone) {
    verdict = 'Completed through provider phone. Lightcurve resources are estimated here; provider spend is separate.';
  } else {
    verdict = 'Completed with billable Lightcurve tested-minute evidence.';
  }

  return {
    billable,
    testedMinutes,
    estimatedLightcurveCostUsd,
    providerSpend: isProviderPhone ? 'possible' : provider ? 'none' : 'unknown',
    verdict,
    resources,
  };
}
