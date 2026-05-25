export declare class VoiceSandbox {
    private apiKey;
    private baseUrl;
    constructor(config?: {
        apiKey?: string;
        baseUrl?: string;
    });
    run(options: {
        agentType: 'vapi' | 'retell' | 'custom';
        agentConfig: any;
        scenarios: string[];
        parallel?: number;
        gitSha?: string;
        timeout?: number;
    }): Promise<any>;
    scenarios: {
        fork: (parentId: string, options: {
            name: string;
            patch: any[];
        }) => Promise<any>;
    };
    experiments: {
        compare: (expId1: string, expId2: string) => Promise<any>;
    };
}
