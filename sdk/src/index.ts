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
  experiment: { id: string; name: string; status: string; datasetId: string; datasetVersion: number };
  runs: Array<{ id: string; caseId?: string | null; status: string }>;
};

export class Lightcurve {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = config.apiKey ?? process.env.LIGHTCURVE_API_KEY ?? '';
    this.baseUrl = (config.baseUrl ?? process.env.LIGHTCURVE_BASE_URL ?? 'https://app.uselightcurve.com').replace(/\/$/, '');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (!response.ok) throw new Error(body.error ?? `Lightcurve request failed with ${response.status}.`);
    return body as T;
  }

  async listDatasets(): Promise<{ datasets: DatasetSummary[] }> {
    return this.request('/api/datasets');
  }

  async getDataset(datasetId: string): Promise<DatasetDetail> {
    return this.request(`/api/datasets/${encodeURIComponent(datasetId)}`);
  }

  async runDataset(options: { datasetId: string; name?: string; runtimeId?: string; gitSha?: string }): Promise<DatasetRun> {
    return this.request('/api/sdk/run', { method: 'POST', body: JSON.stringify(options) });
  }

  async getDatasetRun(experimentId: string): Promise<DatasetRun> {
    return this.request(`/api/sdk/experiments/${encodeURIComponent(experimentId)}`);
  }

  datasets = {
    list: () => this.listDatasets(),
    get: (datasetId: string) => this.getDataset(datasetId),
    run: (options: { datasetId: string; name?: string; runtimeId?: string; gitSha?: string }) => this.runDataset(options),
  };
}

export const VoiceSandbox = Lightcurve;
export default Lightcurve;
