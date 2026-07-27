import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const LOCAL_SECRET_PREFIX = 'local:v1:';

function localCredentialSecret() {
  const secret = process.env.LIGHTCURVE_CREDENTIAL_SECRET?.trim();
  return secret || undefined;
}

function localKey() {
  const secret = localCredentialSecret();
  if (!secret) throw new Error('LIGHTCURVE_CREDENTIAL_SECRET is required before storing production agent credentials.');
  return createHash('sha256').update(secret).digest();
}

function encryptWithLocalSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', localKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${LOCAL_SECRET_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptWithLocalSecret(encrypted: string) {
  const [, , ivText, tagText, ciphertextText] = encrypted.split(':');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Stored credentials have an invalid local encryption format.');
  const decipher = createDecipheriv('aes-256-gcm', localKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
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

  const plaintext = JSON.stringify(cleaned);
  if (localCredentialSecret()) return encryptWithLocalSecret(plaintext);

  if (process.env.NODE_ENV === 'production') {
    throw new Error('LIGHTCURVE_CREDENTIAL_SECRET is required before storing production agent credentials.');
  }
  return Buffer.from(plaintext, 'utf8').toString('base64');
}

export async function decryptCredentials(encryptedCredentials: string | null | undefined) {
  if (!encryptedCredentials) return {};

  if (encryptedCredentials.startsWith(LOCAL_SECRET_PREFIX)) {
    return JSON.parse(decryptWithLocalSecret(encryptedCredentials)) as Record<string, unknown>;
  }

  if (process.env.NODE_ENV === 'production' && !localCredentialSecret()) {
    throw new Error('LIGHTCURVE_CREDENTIAL_SECRET is required before reading production agent credentials.');
  }

  return JSON.parse(Buffer.from(encryptedCredentials, 'base64').toString('utf8')) as Record<string, unknown>;
}
