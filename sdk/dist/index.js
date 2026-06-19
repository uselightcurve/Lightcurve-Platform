"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceSandbox = exports.createClient = exports.Lightcurve = exports.providers = exports.LightcurveError = void 0;
class LightcurveError extends Error {
    status;
    details;
    constructor(message, status, details) {
        super(message);
        this.name = 'LightcurveError';
        this.status = status;
        this.details = details;
    }
}
exports.LightcurveError = LightcurveError;
function env(name) {
    if (typeof process === 'undefined')
        return undefined;
    return process.env?.[name];
}
function trimBaseUrl(url) {
    return url.replace(/\/+$/, '');
}
function scenarioIdsFrom(options) {
    return options.scenarioIds ?? options.scenarios ?? [];
}
function isTerminalExperiment(data) {
    if (data.status === 'completed' || data.status === 'complete' || data.status === 'failed')
        return true;
    if (!data.runs.length)
        return false;
    return data.runs.every((run) => run.status === 'complete' || run.status === 'failed');
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
exports.providers = {
    agentReplica(config) {
        return {
            agentType: 'agent_replica',
            agentConfig: {
                mode: 'agent_replica',
                costMode: 'low_cost_testing',
                ...config,
            },
            webrtcEndpoint: 'agent-replica',
        };
    },
    lightcurveRoom(config = {}) {
        return {
            agentType: 'livekit',
            agentConfig: {
                mode: 'lightcurve_hosted_room',
                costMode: 'low_cost_testing',
                ...config,
            },
            webrtcEndpoint: 'lightcurve-room',
        };
    },
    advancedRunner(endpoint, config = {}) {
        return {
            agentType: 'custom',
            agentConfig: {
                mode: 'advanced_runner',
                costMode: 'provider_backed',
                endpoint,
                ...config,
            },
            webrtcEndpoint: endpoint,
        };
    },
    phoneRealism: {
        vapi(config) {
            return {
                agentType: 'vapi',
                agentConfig: {
                    mode: 'vapi_bot_to_bot_phone',
                    costMode: 'phone_realism',
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
class Lightcurve {
    apiKey;
    baseUrl;
    fetcher;
    includeCredentials;
    providers = exports.providers;
    constructor(config = {}) {
        this.apiKey =
            config.apiKey ??
                env('LIGHTCURVE_API_KEY') ??
                env('VS_API_KEY') ??
                '';
        this.baseUrl = trimBaseUrl(config.baseUrl ?? env('LIGHTCURVE_BASE_URL') ?? 'https://app.uselightcurve.com');
        this.fetcher = config.fetch ?? fetch;
        this.includeCredentials = Boolean(config.includeCredentials);
    }
    async createExperiment(options) {
        const scenarioIds = scenarioIdsFrom(options);
        return this.request('/api/experiments', {
            method: 'POST',
            body: {
                ...options,
                scenarioIds,
            },
        });
    }
    async runSuite(options) {
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
    async run(options) {
        return this.runSuite(options);
    }
    async createLightcurveRoomTest(options) {
        const roomConfig = exports.providers.lightcurveRoom(options.agentConfig);
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
    async startRun(runId) {
        return this.request(`/api/runs/${encodeURIComponent(runId)}/start`, {
            method: 'POST',
        });
    }
    async getRun(runId) {
        return this.request(`/api/runs/${encodeURIComponent(runId)}`);
    }
    async getLightcurveRoom(runId) {
        return this.request(`/api/runs/${encodeURIComponent(runId)}/livekit-session`);
    }
    async getExperiment(experimentId) {
        return this.request(`/api/sdk/experiments/${encodeURIComponent(experimentId)}`);
    }
    async waitForExperiment(experimentId, options = {}) {
        const timeoutMs = options.timeoutMs ?? 300_000;
        const pollIntervalMs = options.pollIntervalMs ?? 5_000;
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const data = await this.getExperiment(experimentId);
            if (isTerminalExperiment(data))
                return data;
            await sleep(pollIntervalMs);
        }
        throw new LightcurveError(`Timed out waiting for experiment ${experimentId}.`, 408);
    }
    async listScenarios(params = {}) {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined)
                query.set(key, String(value));
        }
        const suffix = query.toString() ? `?${query}` : '';
        return this.request(`/api/scenarios${suffix}`);
    }
    async forkScenario(parentId, options) {
        return this.request(`/api/scenarios/${encodeURIComponent(parentId)}/fork`, {
            method: 'POST',
            body: options,
        });
    }
    async compareExperiments(experimentId, compareId) {
        return this.request(`/api/experiments/${encodeURIComponent(experimentId)}/compare?compareId=${encodeURIComponent(compareId)}`, {
            method: 'POST',
        });
    }
    async listAgentConnections() {
        return this.request('/api/agent-connections');
    }
    async createAgentConnection(payload) {
        return this.request('/api/agent-connections', {
            method: 'POST',
            body: payload,
        });
    }
    async testAgentConnection(connectionId) {
        return this.request(`/api/agent-connections/${encodeURIComponent(connectionId)}/test`, {
            method: 'POST',
        });
    }
    scenarios = {
        list: (params) => this.listScenarios(params),
        fork: (parentId, options) => this.forkScenario(parentId, options),
    };
    experiments = {
        create: (options) => this.createExperiment(options),
        runSuite: (options) => this.runSuite(options),
        compare: (experimentId, compareId) => this.compareExperiments(experimentId, compareId),
    };
    agentConnections = {
        list: () => this.listAgentConnections(),
        create: (payload) => this.createAgentConnection(payload),
        test: (connectionId) => this.testAgentConnection(connectionId),
    };
    async request(path, init = {}) {
        const headers = {};
        if (init.headers) {
            if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => {
                    headers[key] = value;
                });
            }
            else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers)
                    headers[key] = value;
            }
            else {
                Object.assign(headers, init.headers);
            }
        }
        let body = init.body;
        if (init.body !== undefined && typeof init.body !== 'string' && !(init.body instanceof FormData)) {
            headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
            body = JSON.stringify(init.body);
        }
        if (this.apiKey)
            headers.Authorization = `Bearer ${this.apiKey}`;
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
            const message = payload && typeof payload === 'object' && 'error' in payload
                ? String(payload.error)
                : `Lightcurve request failed with status ${response.status}.`;
            throw new LightcurveError(message, response.status, payload);
        }
        return payload;
    }
}
exports.Lightcurve = Lightcurve;
const createClient = (config) => new Lightcurve(config);
exports.createClient = createClient;
class VoiceSandbox extends Lightcurve {
}
exports.VoiceSandbox = VoiceSandbox;
