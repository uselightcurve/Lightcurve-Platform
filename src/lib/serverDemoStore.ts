type SdkExperiment = {
  id: string;
  status: 'completed';
  mos: number;
  taskCompletion: number;
  runs: Array<{
    id: string;
    scenarioId: string;
    status: 'complete';
    mos: number;
    taskCompletion: number;
    latencyP95: number;
  }>;
};

const globalStore = globalThis as typeof globalThis & {
  __lightcurveSdkExperiments?: Map<string, SdkExperiment>;
};

function store() {
  if (!globalStore.__lightcurveSdkExperiments) {
    globalStore.__lightcurveSdkExperiments = new Map<string, SdkExperiment>();
  }
  return globalStore.__lightcurveSdkExperiments;
}

export function createSdkDemoExperiment(scenarioIds: string[] = []) {
  const ids = scenarioIds.length ? scenarioIds : ['angry_refund_call', 'plan_upgrade_hinglish'];
  const id = `sdk-demo-${Date.now().toString(36)}`;
  const runs = ids.map((scenarioId, index) => {
    const hardCase = scenarioId.includes('hinglish') || scenarioId.includes('outage') || scenarioId.includes('refund');
    const taskCompletion = hardCase ? 0.76 + index * 0.02 : 0.86;
    const mos = hardCase ? 3.7 + index * 0.1 : 4.1;
    return {
      id: `${id}-run-${index + 1}`,
      scenarioId,
      status: 'complete' as const,
      mos: Number(mos.toFixed(1)),
      taskCompletion: Number(Math.min(taskCompletion, 0.92).toFixed(2)),
      latencyP95: hardCase ? 1540 : 1120,
    };
  });

  const experiment: SdkExperiment = {
    id,
    status: 'completed',
    mos: Number((runs.reduce((sum, run) => sum + run.mos, 0) / runs.length).toFixed(2)),
    taskCompletion: Number((runs.reduce((sum, run) => sum + run.taskCompletion, 0) / runs.length).toFixed(2)),
    runs,
  };

  store().set(id, experiment);
  return experiment;
}

export function getSdkDemoExperiment(id: string) {
  return store().get(id) ?? null;
}
