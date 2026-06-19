export type CostLaneId = 'low_cost_testing' | 'provider_backed' | 'phone_realism';

export type CostLane = {
  id: CostLaneId;
  label: string;
  description: string;
};

export const COST_LANES: Record<CostLaneId, CostLane> = {
  low_cost_testing: {
    id: 'low_cost_testing',
    label: 'Low-cost testing',
    description: 'Prompt, tool-call, RAG, and knowledge-base coverage before phone realism checks.',
  },
  provider_backed: {
    id: 'provider_backed',
    label: 'Lightcurve test room',
    description: 'The customer agent joins an isolated Lightcurve room or compatible runner for media tests.',
  },
  phone_realism: {
    id: 'phone_realism',
    label: 'Phone realism',
    description: 'Only failed or risky scenarios are escalated to phone/SIP realism checks.',
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function costLaneForProvider(provider: string, agentConfig?: unknown, endpoint?: string | null): CostLaneId {
  const config = asRecord(agentConfig);
  const mode = typeof config.mode === 'string' ? config.mode : '';
  const costMode = typeof config.costMode === 'string' ? config.costMode : '';
  const normalizedEndpoint = endpoint ?? '';

  if (
    provider === 'stub_agent' ||
    mode === 'stub_agent' ||
    mode === 'agent_replica' ||
    costMode === 'low_cost_testing' ||
    costMode === ['che', 'ap_first'].join('') ||
    normalizedEndpoint.startsWith('agent-replica://') ||
    normalizedEndpoint.startsWith('stub-agent://')
  ) {
    return 'low_cost_testing';
  }

  if (['vapi', 'retell', 'elevenlabs'].includes(provider)) return 'phone_realism';

  return 'provider_backed';
}
