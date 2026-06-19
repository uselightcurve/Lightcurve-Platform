declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
type LightcurveRequestInit = Omit<RequestInit, 'body'> & { body?: unknown };

export type AgentType =
  | 'agent_replica'
  | 'livekit'
  | 'vapi'
  | 'retell'
  | 'elevenlabs'
  | 'pipecat'
  | 'custom_webrtc'
  | 'custom';

export type TestingLane = 'low_cost_testing' | 'provider_backed' | 'phone_realism';

export interface LightcurveConfig {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  includeCredentials?: boolean;
}

export interface CreateExperimentOptions {
  name: string;
  agentType: AgentType;
  agentConfig?: JsonRecord;
  webrtcEndpoint?: string;
  scenarioIds?: string[];
  scenarios?: string[];
  scenarioOverrides?: unknown[];
  agentConnectionId?: string;
  gitSha?: string;
  promotedFromExperimentId?: string;
}

export interface RunSuiteOptions extends CreateExperimentOptions {
  autoStart?: boolean;
  parallel?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface LightcurveRoomTestOptions {
  name: string;
  scenarioIds?: string[];
  scenarios?: string[];
  scenarioOverrides?: unknown[];
  agentConfig?: JsonRecord;
  agentConnectionId?: string;
  gitSha?: string;
}

export interface AgentConnectionRecord {
  id: string;
  provider?: string;
  displayName?: string;
  endpoint?: string | null;
  healthStatus?: string;
  healthMessage?: string | null;
  [key: string]: unknown;
}

export interface CreateAgentConnectionResponse {
  agentConnection: AgentConnectionRecord;
}

export interface TestAgentConnectionResponse {
  ok: boolean;
  message?: string;
  agentConnection?: AgentConnectionRecord;
}

export interface ExperimentRecord {
  id: string;
  name?: string;
  status?: string;
  agentType?: string;
  [key: string]: unknown;
}

export interface RunRecord {
  id: string;
  status?: string;
  scenarioId?: string | null;
  experimentId?: string | null;
  [key: string]: unknown;
}

export interface CreateExperimentResponse {
  experiment: ExperimentRecord;
  runs: RunRecord[];
}

export interface ExperimentSummary {
  status: string | null;
  mos: number | null;
  taskCompletion: number | null;
  runs: RunRecord[];
}

export interface LightcurveRoomSession {
  roomName: string;
  liveKitUrl: string;
  agentToken: string;
  callerToken?: string;
  instructions?: string;
  joinOptions?: Array<{
    id: string;
    label: string;
    summary: string;
    steps: string[];
    code?: string;
  }>;
}

export interface StartRunResponse {
  success?: boolean;
  provider?: string;
  status?: string;
  externalCallId?: string;
  externalStatus?: string;
  liveKit?: LightcurveRoomSession;
  [key: string]: unknown;
}

export interface LightcurveRoomTestResponse extends CreateExperimentResponse {
  firstRun: RunRecord;
  room: LightcurveRoomSession;
}

export class LightcurveError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'LightcurveError';
    this.status = status;
    this.details = details;
  }
}

function env(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env?.[name];
}

function trimBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function scenarioIdsFrom(options: { scenarioIds?: string[]; scenarios?: string[] }): string[] {
  return options.scenarioIds ?? options.scenarios ?? [];
}

function isTerminalExperiment(data: ExperimentSummary): boolean {
  if (data.status === 'completed' || data.status === 'complete' || data.status === 'failed') return true;
  if (!data.runs.length) return false;
  return data.runs.every((run) => run.status === 'complete' || run.status === 'failed');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export const providers = {
  agentReplica(config: {
    instructions: string;
    knowledge?: string;
    tools?: JsonRecord;
    confirmationRules?: string;
    escalationPolicy?: string;
    [key: string]: unknown;
  }) {
    return {
      agentType: 'agent_replica' as const,
      agentConfig: {
        mode: 'agent_replica',
        costMode: 'low_cost_testing' satisfies TestingLane,
        ...config,
      },
      webrtcEndpoint: 'agent-replica',
    };
  },

  lightcurveRoom(config: JsonRecord = {}) {
    return {
      agentType: 'livekit' as const,
      agentConfig: {
        mode: 'lightcurve_hosted_room',
        costMode: 'low_cost_testing' satisfies TestingLane,
        ...config,
      },
      webrtcEndpoint: 'lightcurve-room',
    };
  },

  advancedRunner(endpoint: string, config: JsonRecord = {}) {
    return {
      agentType: 'custom' as const,
      agentConfig: {
        mode: 'advanced_runner',
        costMode: 'provider_backed' satisfies TestingLane,
        endpoint,
        ...config,
      },
      webrtcEndpoint: endpoint,
    };
  },

  phoneRealism: {
    vapi(config: {
      agentPhoneNumber: string;
      outboundCallerNumberId: string;
      apiKey?: string;
      apiBase?: string;
      [key: string]: unknown;
    }) {
      return {
        agentType: 'vapi' as const,
        agentConfig: {
          mode: 'vapi_bot_to_bot_phone',
          costMode: 'phone_realism' satisfies TestingLane,
          targetAgentNumber: config.agentPhoneNumber,
          phoneNumberId: config.outboundCallerNumberId,
          apiKey: config.apiKey,
          apiBase: config.apiBase,
          ...config,
        },
        webrtcEndpoint: config.agentPhoneNumber,
      };
    },
  },
};

export class Lightcurve {
  private apiKey: string;
  private baseUrl: string;
  private fetcher: FetchLike;
  private includeCredentials: boolean;

  providers = providers;

  constructor(config: LightcurveConfig = {}) {
    this.apiKey =
      config.apiKey ??
      env('LIGHTCURVE_API_KEY') ??
      env('VS_API_KEY') ??
      '';
    this.baseUrl = trimBaseUrl(config.baseUrl ?? env('LIGHTCURVE_BASE_URL') ?? 'https://app.uselightcurve.com');
    this.fetcher = config.fetch ?? fetch;
    this.includeCredentials = Boolean(config.includeCredentials);
  }

  async createExperiment(options: CreateExperimentOptions): Promise<CreateExperimentResponse> {
    const scenarioIds = scenarioIdsFrom(options);
    return this.request<CreateExperimentResponse>('/api/experiments', {
      method: 'POST',
      body: {
        ...options,
        scenarioIds,
      },
    });
  }

  async runSuite(options: RunSuiteOptions): Promise<ExperimentSummary & { experiment: ExperimentRecord }> {
    const created = await this.createExperiment(options);
    const parallel = Math.max(1, Math.floor(options.parallel ?? 3));

    if (options.autoStart !== false) {
      for (let index = 0; index < created.runs.length; index += parallel) {
        const batch = created.runs.slice(index, index + parallel);
        await Promise.all(batch.map((run) => this.startRun(run.id)));
      }
    }

    const summary = await this.waitForExperiment(created.experiment.id, {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
    });

    return {
      ...summary,
      experiment: created.experiment,
    };
  }

  async run(options: RunSuiteOptions): Promise<ExperimentSummary & { experiment: ExperimentRecord }> {
    return this.runSuite(options);
  }

  async createLightcurveRoomTest(options: LightcurveRoomTestOptions): Promise<LightcurveRoomTestResponse> {
    const roomConfig = providers.lightcurveRoom(options.agentConfig);
    const created = await this.createExperiment({
      name: options.name,
      ...roomConfig,
      scenarioIds: scenarioIdsFrom(options),
      scenarioOverrides: options.scenarioOverrides,
      agentConnectionId: options.agentConnectionId,
      gitSha: options.gitSha,
    });

    const firstRun = created.runs[0];
    if (!firstRun) {
      throw new LightcurveError('No run was created for this Lightcurve room test.', 422, created);
    }

    const room = await this.getLightcurveRoom(firstRun.id);
    return {
      ...created,
      firstRun,
      room,
    };
  }

  async startRun(runId: string): Promise<StartRunResponse> {
    return this.request<StartRunResponse>(`/api/runs/${encodeURIComponent(runId)}/start`, {
      method: 'POST',
    });
  }

  async getRun(runId: string): Promise<unknown> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}`);
  }

  async getLightcurveRoom(runId: string): Promise<LightcurveRoomSession> {
    return this.request<LightcurveRoomSession>(`/api/runs/${encodeURIComponent(runId)}/livekit-session`);
  }

  async getExperiment(experimentId: string): Promise<ExperimentSummary> {
    return this.request<ExperimentSummary>(`/api/sdk/experiments/${encodeURIComponent(experimentId)}`);
  }

  async waitForExperiment(
    experimentId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<ExperimentSummary> {
    const timeoutMs = options.timeoutMs ?? 300_000;
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const data = await this.getExperiment(experimentId);
      if (isTerminalExperiment(data)) return data;
      await sleep(pollIntervalMs);
    }

    throw new LightcurveError(`Timed out waiting for experiment ${experimentId}.`, 408);
  }

  async listScenarios(params: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query}` : '';
    return this.request(`/api/scenarios${suffix}`);
  }

  async forkScenario(parentId: string, options: { name: string; patch: unknown[] }): Promise<unknown> {
    return this.request(`/api/scenarios/${encodeURIComponent(parentId)}/fork`, {
      method: 'POST',
      body: options,
    });
  }

  async compareExperiments(experimentId: string, compareId: string): Promise<unknown> {
    return this.request(`/api/experiments/${encodeURIComponent(experimentId)}/compare?compareId=${encodeURIComponent(compareId)}`, {
      method: 'POST',
    });
  }

  async listAgentConnections(): Promise<unknown> {
    return this.request('/api/agent-connections');
  }

  async createAgentConnection(payload: JsonRecord): Promise<CreateAgentConnectionResponse> {
    return this.request<CreateAgentConnectionResponse>('/api/agent-connections', {
      method: 'POST',
      body: payload,
    });
  }

  async testAgentConnection(connectionId: string): Promise<TestAgentConnectionResponse> {
    return this.request<TestAgentConnectionResponse>(`/api/agent-connections/${encodeURIComponent(connectionId)}/test`, {
      method: 'POST',
    });
  }

  scenarios = {
    list: (params?: Record<string, string | number | boolean | undefined>) => this.listScenarios(params),
    fork: (parentId: string, options: { name: string; patch: unknown[] }) => this.forkScenario(parentId, options),
  };

  experiments = {
    create: (options: CreateExperimentOptions) => this.createExperiment(options),
    runSuite: (options: RunSuiteOptions) => this.runSuite(options),
    compare: (experimentId: string, compareId: string) => this.compareExperiments(experimentId, compareId),
  };

  agentConnections = {
    list: () => this.listAgentConnections(),
    create: (payload: JsonRecord) => this.createAgentConnection(payload),
    test: (connectionId: string) => this.testAgentConnection(connectionId),
  };

  private async request<T>(path: string, init: LightcurveRequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) headers[key] = value;
      } else {
        Object.assign(headers, init.headers);
      }
    }

    let body = init.body as BodyInit | undefined;
    if (init.body !== undefined && typeof init.body !== 'string' && !(init.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      body = JSON.stringify(init.body);
    }

    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      body,
      credentials: this.includeCredentials ? 'include' : init.credentials,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `Lightcurve request failed with status ${response.status}.`;
      throw new LightcurveError(message, response.status, payload);
    }

    return payload as T;
  }
}

export const createClient = (config?: LightcurveConfig) => new Lightcurve(config);

export class VoiceSandbox extends Lightcurve {}
