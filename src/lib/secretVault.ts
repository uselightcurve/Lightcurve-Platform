import { KeyManagementServiceClient } from '@google-cloud/kms';

const kmsClient = new KeyManagementServiceClient();

function kmsKeyName() {
  return process.env.KMS_KEY_NAME || process.env.LIGHTCURVE_KMS_KEY_NAME;
}

export function credentialPreview(credentials: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(credentials)
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([key, value]) => {
        const text = String(value);
        const visible = text.length <= 8 ? `${text.slice(0, 2)}...` : `${text.slice(0, 4)}...${text.slice(-4)}`;
        return [key, visible];
      }),
  );
}

export async function encryptCredentials(credentials: Record<string, unknown>) {
  const cleaned = Object.fromEntries(
    Object.entries(credentials).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ''),
  );
  if (!Object.keys(cleaned).length) return null;

  const keyName = kmsKeyName();
  if (!keyName) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('KMS_KEY_NAME is required before storing production agent credentials.');
    }
    return Buffer.from(JSON.stringify(cleaned), 'utf8').toString('base64');
  }

  const [result] = await kmsClient.encrypt({
    name: keyName,
    plaintext: Buffer.from(JSON.stringify(cleaned), 'utf8'),
  });
  return Buffer.from(result.ciphertext ?? '').toString('base64');
}

export async function decryptCredentials(encryptedCredentials: string | null | undefined) {
  if (!encryptedCredentials) return {};

  const ciphertext = Buffer.from(encryptedCredentials, 'base64');
  const keyName = kmsKeyName();
  if (!keyName) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('KMS_KEY_NAME is required before reading production agent credentials.');
    }
    return JSON.parse(ciphertext.toString('utf8')) as Record<string, unknown>;
  }

  const [result] = await kmsClient.decrypt({
    name: keyName,
    ciphertext,
  });
  const plaintext = Buffer.from(result.plaintext ?? '').toString('utf8');
  return JSON.parse(plaintext) as Record<string, unknown>;
}
