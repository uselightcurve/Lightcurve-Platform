"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = exports.VoiceSandbox = exports.Lightcurve = void 0;
class Lightcurve {
    baseUrl;
    apiKey;
    constructor(config = {}) {
        this.apiKey = config.apiKey ?? process.env.LIGHTCURVE_API_KEY ?? '';
        this.baseUrl = (config.baseUrl ?? process.env.LIGHTCURVE_BASE_URL ?? 'https://app.uselightcurve.com').replace(/\/$/, '');
    }
    async request(path, init = {}) {
        const response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers: {
                Accept: 'application/json',
                ...(init.body ? { 'Content-Type': 'application/json' } : {}),
                ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
                ...init.headers,
            },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error(body.error ?? `Lightcurve request failed with ${response.status}.`);
        return body;
    }
    async listDatasets() {
        return this.request('/api/datasets');
    }
    async getDataset(datasetId) {
        return this.request(`/api/datasets/${encodeURIComponent(datasetId)}`);
    }
    async runDataset(options) {
        return this.request('/api/sdk/run', { method: 'POST', body: JSON.stringify(options) });
    }
    async getDatasetRun(experimentId) {
        return this.request(`/api/sdk/experiments/${encodeURIComponent(experimentId)}`);
    }
    datasets = {
        list: () => this.listDatasets(),
        get: (datasetId) => this.getDataset(datasetId),
        run: (options) => this.runDataset(options),
    };
}
exports.Lightcurve = Lightcurve;
exports.VoiceSandbox = Lightcurve;
exports.default = Lightcurve;
exports.runtime = require("./runtime");
