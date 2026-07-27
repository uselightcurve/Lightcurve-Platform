type ServiceAccountCredentials = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

export type LightcurveGoogleAuthOptions = {
  projectId?: string;
  credentials?: ServiceAccountCredentials;
  scopes?: string | string[];
};

let cachedCredentials: ServiceAccountCredentials | null | undefined;

function parseCredentials() {
  if (cachedCredentials !== undefined) return cachedCredentials;

  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  const encoded = process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64?.trim();
  const payload = raw || (encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '');
  if (!payload) {
    cachedCredentials = null;
    return cachedCredentials;
  }

  try {
    cachedCredentials = JSON.parse(payload) as ServiceAccountCredentials;
    return cachedCredentials;
  } catch {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON must be valid service account JSON.');
  }
}

export function googleProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCP_PROJECT_ID
    || parseCredentials()?.project_id;
}

export function googleAuthOptions(scopes?: string | string[], projectId = googleProjectId()): LightcurveGoogleAuthOptions {
  const credentials = parseCredentials();
  return {
    ...(projectId ? { projectId } : {}),
    ...(credentials ? { credentials } : {}),
    ...(scopes ? { scopes } : {}),
  };
}
