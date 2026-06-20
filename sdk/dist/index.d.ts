export type DatasetSummary = {
    id: string;
    name: string;
    description?: string | null;
    visibility: 'private' | 'public';
    currentVersion: number;
    caseCount?: number;
};
export type DatasetCase = {
    id: string;
    datasetId: string;
    name: string;
    language: string;
    domain: string;
    status: string;
    visibility: 'private' | 'public';
    behaviorGraph: unknown;
    successCriteria: unknown[];
};
export type DatasetDetail = {
    dataset: DatasetSummary;
    cases: DatasetCase[];
};
export type DatasetRun = {
    experiment: {
        id: string;
        name: string;
        status: string;
        datasetId: string;
        datasetVersion: number;
    };
    runs: Array<{
        id: string;
        caseId?: string | null;
        status: string;
    }>;
};
export declare class Lightcurve {
    private readonly baseUrl;
    private readonly apiKey;
    constructor(config?: {
        apiKey?: string;
        baseUrl?: string;
    });
    private request;
    listDatasets(): Promise<{
        datasets: DatasetSummary[];
    }>;
    getDataset(datasetId: string): Promise<DatasetDetail>;
    runDataset(options: {
        datasetId: string;
        name?: string;
        runtimeId?: string;
        gitSha?: string;
    }): Promise<DatasetRun>;
    getDatasetRun(experimentId: string): Promise<DatasetRun>;
    datasets: {
        list: () => Promise<{
            datasets: DatasetSummary[];
        }>;
        get: (datasetId: string) => Promise<DatasetDetail>;
        run: (options: {
            datasetId: string;
            name?: string;
            runtimeId?: string;
            gitSha?: string;
        }) => Promise<DatasetRun>;
    };
}
export declare const VoiceSandbox: typeof Lightcurve;
export default Lightcurve;
