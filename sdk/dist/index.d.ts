type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
export type AgentType = 'agent_replica' | 'livekit' | 'vapi' | 'retell' | 'elevenlabs' | 'pipecat' | 'custom_webrtc' | 'custom';
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
    gitSha?: string;
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
    instructions?: string[];
    joinOptions?: Array<{
        title: string;
        description: string;
        steps: string[];
        code?: string;
    }>;
}
export interface LightcurveRoomTestResponse extends CreateExperimentResponse {
    firstRun: RunRecord;
    room: LightcurveRoomSession;
}
export declare class LightcurveError extends Error {
    status?: number;
    details?: unknown;
    constructor(message: string, status?: number, details?: unknown);
}
export declare const providers: {
    agentReplica(config: {
        instructions: string;
        knowledge?: string;
        tools?: JsonRecord;
        confirmationRules?: string;
        escalationPolicy?: string;
        [key: string]: unknown;
    }): {
        agentType: "agent_replica";
        agentConfig: {
            instructions: string;
            knowledge?: string;
            tools?: JsonRecord;
            confirmationRules?: string;
            escalationPolicy?: string;
            mode: string;
            costMode: string;
        };
        webrtcEndpoint: string;
    };
    lightcurveRoom(config?: JsonRecord): {
        agentType: "livekit";
        agentConfig: {
            mode: string;
            costMode: string;
        };
        webrtcEndpoint: string;
    };
    advancedRunner(endpoint: string, config?: JsonRecord): {
        agentType: "custom";
        agentConfig: {
            mode: string;
            costMode: string;
            endpoint: string;
        };
        webrtcEndpoint: string;
    };
    phoneRealism: {
        vapi(config: {
            agentPhoneNumber: string;
            outboundCallerNumberId: string;
            apiKey?: string;
            apiBase?: string;
            [key: string]: unknown;
        }): {
            agentType: "vapi";
            agentConfig: {
                agentPhoneNumber: string;
                outboundCallerNumberId: string;
                apiKey: string;
                apiBase: string;
                mode: string;
                costMode: string;
                targetAgentNumber: string;
                phoneNumberId: string;
            };
            webrtcEndpoint: string;
        };
    };
};
export declare class Lightcurve {
    private apiKey;
    private baseUrl;
    private fetcher;
    private includeCredentials;
    providers: {
        agentReplica(config: {
            instructions: string;
            knowledge?: string;
            tools?: JsonRecord;
            confirmationRules?: string;
            escalationPolicy?: string;
            [key: string]: unknown;
        }): {
            agentType: "agent_replica";
            agentConfig: {
                instructions: string;
                knowledge?: string;
                tools?: JsonRecord;
                confirmationRules?: string;
                escalationPolicy?: string;
                mode: string;
                costMode: string;
            };
            webrtcEndpoint: string;
        };
        lightcurveRoom(config?: JsonRecord): {
            agentType: "livekit";
            agentConfig: {
                mode: string;
                costMode: string;
            };
            webrtcEndpoint: string;
        };
        advancedRunner(endpoint: string, config?: JsonRecord): {
            agentType: "custom";
            agentConfig: {
                mode: string;
                costMode: string;
                endpoint: string;
            };
            webrtcEndpoint: string;
        };
        phoneRealism: {
            vapi(config: {
                agentPhoneNumber: string;
                outboundCallerNumberId: string;
                apiKey?: string;
                apiBase?: string;
                [key: string]: unknown;
            }): {
                agentType: "vapi";
                agentConfig: {
                    agentPhoneNumber: string;
                    outboundCallerNumberId: string;
                    apiKey: string;
                    apiBase: string;
                    mode: string;
                    costMode: string;
                    targetAgentNumber: string;
                    phoneNumberId: string;
                };
                webrtcEndpoint: string;
            };
        };
    };
    constructor(config?: LightcurveConfig);
    createExperiment(options: CreateExperimentOptions): Promise<CreateExperimentResponse>;
    runSuite(options: RunSuiteOptions): Promise<ExperimentSummary & {
        experiment: ExperimentRecord;
    }>;
    run(options: RunSuiteOptions): Promise<ExperimentSummary & {
        experiment: ExperimentRecord;
    }>;
    createLightcurveRoomTest(options: LightcurveRoomTestOptions): Promise<LightcurveRoomTestResponse>;
    startRun(runId: string): Promise<unknown>;
    getRun(runId: string): Promise<unknown>;
    getLightcurveRoom(runId: string): Promise<LightcurveRoomSession>;
    getExperiment(experimentId: string): Promise<ExperimentSummary>;
    waitForExperiment(experimentId: string, options?: {
        timeoutMs?: number;
        pollIntervalMs?: number;
    }): Promise<ExperimentSummary>;
    listScenarios(params?: Record<string, string | number | boolean | undefined>): Promise<unknown>;
    forkScenario(parentId: string, options: {
        name: string;
        patch: unknown[];
    }): Promise<unknown>;
    compareExperiments(experimentId: string, compareId: string): Promise<unknown>;
    listAgentConnections(): Promise<unknown>;
    createAgentConnection(payload: JsonRecord): Promise<unknown>;
    testAgentConnection(connectionId: string): Promise<unknown>;
    scenarios: {
        list: (params?: Record<string, string | number | boolean | undefined>) => Promise<unknown>;
        fork: (parentId: string, options: {
            name: string;
            patch: unknown[];
        }) => Promise<unknown>;
    };
    experiments: {
        create: (options: CreateExperimentOptions) => Promise<CreateExperimentResponse>;
        runSuite: (options: RunSuiteOptions) => Promise<ExperimentSummary & {
            experiment: ExperimentRecord;
        }>;
        compare: (experimentId: string, compareId: string) => Promise<unknown>;
    };
    agentConnections: {
        list: () => Promise<unknown>;
        create: (payload: JsonRecord) => Promise<unknown>;
        test: (connectionId: string) => Promise<unknown>;
    };
    private request;
}
export declare const createClient: (config?: LightcurveConfig) => Lightcurve;
export declare class VoiceSandbox extends Lightcurve {
}
export {};
