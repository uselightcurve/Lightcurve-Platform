"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceSandbox = void 0;
class VoiceSandbox {
    apiKey;
    baseUrl;
    constructor(config = {}) {
        this.apiKey = config.apiKey || process.env.VS_API_KEY || '';
        this.baseUrl = config.baseUrl || 'http://localhost:3000';
    }
    async run(options) {
        const res = await fetch(`${this.baseUrl}/api/sdk/run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(options)
        });
        if (!res.ok)
            throw new Error('Failed to start run');
        const { experimentId } = await res.json();
        // Polling loop
        const timeout = options.timeout || 300000;
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const pollRes = await fetch(`${this.baseUrl}/api/sdk/experiments/${experimentId}`);
            if (!pollRes.ok)
                throw new Error('Failed to poll experiment');
            const data = await pollRes.json();
            if (data.status === 'completed') {
                return data;
            }
            await new Promise(r => setTimeout(r, 5000));
        }
        throw new Error('Timeout waiting for experiment completion');
    }
    scenarios = {
        fork: async (parentId, options) => {
            const res = await fetch(`${this.baseUrl}/api/scenarios/${parentId}/fork`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(options)
            });
            return res.json();
        }
    };
    experiments = {
        compare: async (expId1, expId2) => {
            const res = await fetch(`${this.baseUrl}/api/experiments/${expId1}/compare?compareId=${expId2}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return res.json();
        }
    };
}
exports.VoiceSandbox = VoiceSandbox;
