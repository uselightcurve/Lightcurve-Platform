import { createHmac } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LOCAL_URI_PREFIX = 'local://';
const AZURE_URI_PREFIX = 'azblob://';

type LocalAudioUri = `${typeof LOCAL_URI_PREFIX}${string}`;
type AzureAudioUri = `${typeof AZURE_URI_PREFIX}${string}`;

type AzureStorageConfig = {
  accountName: string;
  accountKey: string;
  blobEndpoint: string;
  container: string;
};

function localStorageRoot() {
  return process.env.LOCAL_STORAGE_DIR?.trim() || undefined;
}

function shouldUseLocalStorage() {
  return process.env.LIGHTCURVE_AUDIO_STORAGE === 'local'
    || (!process.env.LIGHTCURVE_AUDIO_STORAGE && Boolean(localStorageRoot()));
}

function shouldUseAzureStorage() {
  return process.env.LIGHTCURVE_AUDIO_STORAGE === 'azure'
    || Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AZURE_STORAGE_ACCOUNT);
}

export function isLocalAudioUri(uri: string | null | undefined): uri is LocalAudioUri {
  return typeof uri === 'string' && uri.startsWith(LOCAL_URI_PREFIX);
}

export function isAzureAudioUri(uri: string | null | undefined): uri is AzureAudioUri {
  return typeof uri === 'string' && uri.startsWith(AZURE_URI_PREFIX);
}

export function isPrivateAudioUri(uri: string | null | undefined) {
  return isLocalAudioUri(uri) || isAzureAudioUri(uri);
}

function extensionForContentType(contentType: string) {
  return contentType.includes('wav') ? 'wav' : contentType.includes('ogg') ? 'ogg' : contentType.includes('mpeg') ? 'mp3' : 'webm';
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function assertSafeObjectName(objectName: string) {
  const segments = objectName.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[a-zA-Z0-9._-]+$/.test(segment))) {
    throw new Error('Invalid private audio object path.');
  }
  return objectName;
}

function resolveLocalObjectPath(objectName: string) {
  const root = localStorageRoot();
  if (!root) throw new Error('LOCAL_STORAGE_DIR is not configured.');
  return path.join(/* turbopackIgnore: true */ root, ...assertSafeObjectName(objectName).split('/'));
}

function objectNameFromLocalUri(uri: string) {
  if (!isLocalAudioUri(uri)) throw new Error('A local:// audio object is required.');
  const objectName = uri.slice(LOCAL_URI_PREFIX.length);
  if (!objectName || objectName.includes('\\')) throw new Error('Invalid local audio URI.');
  return assertSafeObjectName(objectName);
}

function partsFromAzureUri(uri: string) {
  if (!isAzureAudioUri(uri)) throw new Error('An azblob:// audio object is required.');
  const [container, ...parts] = uri.slice(AZURE_URI_PREFIX.length).split('/');
  const objectName = parts.join('/');
  if (!container || !objectName || objectName.includes('\\')) throw new Error('Invalid Azure Blob audio URI.');
  return { container, objectName: assertSafeObjectName(objectName) };
}

export function localAudioObjectName(uri: string) {
  return objectNameFromLocalUri(uri);
}

export function privateAudioObjectName(uri: string) {
  if (isLocalAudioUri(uri)) return objectNameFromLocalUri(uri);
  if (isAzureAudioUri(uri)) return partsFromAzureUri(uri).objectName;
  throw new Error('A private audio URI is required.');
}

async function saveLocalAudio(objectName: string, bytes: Buffer) {
  const targetPath = resolveLocalObjectPath(objectName);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);
  return `${LOCAL_URI_PREFIX}${objectName}`;
}

function parseConnectionString(value: string | undefined) {
  if (!value) return {};
  return Object.fromEntries(value.split(';').flatMap((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return [];
    return [[part.slice(0, index), part.slice(index + 1)]];
  }));
}

function azureStorageConfig(): AzureStorageConfig {
  const parts = parseConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const accountName = process.env.AZURE_STORAGE_ACCOUNT || parts.AccountName;
  const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY || parts.AccountKey;
  const protocol = parts.DefaultEndpointsProtocol || 'https';
  const blobEndpoint = (process.env.AZURE_STORAGE_BLOB_ENDPOINT || parts.BlobEndpoint || `${protocol}://${accountName}.blob.core.windows.net`).replace(/\/$/, '');
  const container = process.env.AZURE_STORAGE_CONTAINER || 'lightcurve-audio';
  if (!accountName || !accountKey) throw new Error('Azure Blob storage requires AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCOUNT_KEY or AZURE_STORAGE_CONNECTION_STRING.');
  return { accountName, accountKey, blobEndpoint, container };
}

function canonicalizedHeaders(headers: Headers) {
  return Array.from(headers.entries())
    .filter(([key]) => key.toLowerCase().startsWith('x-ms-'))
    .map(([key, value]) => [key.toLowerCase(), value.replace(/\s+/g, ' ').trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
}

function canonicalizedResource(accountName: string, url: URL) {
  const query = Array.from(url.searchParams.entries())
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `\n${key}:${value}`)
    .join('');
  return `/${accountName}${url.pathname}${query}`;
}

function sharedKeyAuthorization(method: string, url: URL, headers: Headers, accountName: string, accountKey: string) {
  const header = (name: string) => headers.get(name) || '';
  const contentLength = header('content-length');
  const standardHeaders = [
    method.toUpperCase(),
    header('content-encoding'),
    header('content-language'),
    contentLength === '0' ? '' : contentLength,
    header('content-md5'),
    header('content-type'),
    '',
    header('if-modified-since'),
    header('if-match'),
    header('if-none-match'),
    header('if-unmodified-since'),
    header('range'),
  ].join('\n');
  const stringToSign = `${standardHeaders}\n${canonicalizedHeaders(headers)}${canonicalizedResource(accountName, url)}`;
  const signature = createHmac('sha256', Buffer.from(accountKey, 'base64')).update(stringToSign, 'utf8').digest('base64');
  return `SharedKey ${accountName}:${signature}`;
}

function azureBlobUrl(config: AzureStorageConfig, container: string, objectName: string) {
  return new URL(`${config.blobEndpoint}/${container}/${objectName.split('/').map(encodeURIComponent).join('/')}`);
}

async function azureBlobFetch(method: 'GET' | 'PUT', container: string, objectName: string, body?: Buffer, contentType?: string) {
  const config = azureStorageConfig();
  const url = azureBlobUrl(config, container, objectName);
  const headers = new Headers({
    'x-ms-date': new Date().toUTCString(),
    'x-ms-version': '2023-11-03',
    ...(method === 'PUT' ? { 'x-ms-blob-type': 'BlockBlob' } : {}),
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(body ? { 'content-length': String(body.length) } : {}),
  });
  headers.set('authorization', sharedKeyAuthorization(method, url, headers, config.accountName, config.accountKey));
  return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, cache: 'no-store' });
}

async function saveAzureAudio(objectName: string, bytes: Buffer, contentType: string) {
  const { container } = azureStorageConfig();
  const response = await azureBlobFetch('PUT', container, objectName, bytes, contentType);
  if (!response.ok) throw new Error(`Azure Blob upload failed with ${response.status}: ${await response.text().catch(() => '')}`);
  return `${AZURE_URI_PREFIX}${container}/${objectName}`;
}

async function storeAudio(params: {
  objectName: string;
  bytes: Buffer;
  contentType: string;
}) {
  if (shouldUseLocalStorage()) return saveLocalAudio(params.objectName, params.bytes);
  if (shouldUseAzureStorage()) return saveAzureAudio(params.objectName, params.bytes, params.contentType);
  throw new Error('Configure LIGHTCURVE_AUDIO_STORAGE=azure with Azure Blob credentials, or LIGHTCURVE_AUDIO_STORAGE=local with LOCAL_STORAGE_DIR.');
}

export async function storeCaptureAudio(params: {
  ownerUserId: string;
  captureSessionId: string;
  leg: 'human' | 'agent';
  contentType: string;
  bytes: Buffer;
}) {
  const extension = extensionForContentType(params.contentType);
  return storeAudio({
    objectName: `captures/${params.ownerUserId}/${params.captureSessionId}/${params.leg}.${extension}`,
    bytes: params.bytes,
    contentType: params.contentType,
  });
}

export async function storeImportedAudio(params: {
  ownerUserId: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}) {
  return storeAudio({
    objectName: `audio-library/${params.ownerUserId}/${Date.now()}_${safeName(params.filename)}`,
    bytes: params.bytes,
    contentType: params.contentType,
  });
}

export async function storeReplayAudio(params: {
  ownerUserId: string;
  replayJobId: string;
  name: string;
  bytes: Buffer;
  contentType?: string;
}) {
  const contentType = params.contentType ?? 'audio/wav';
  return storeAudio({
    objectName: `replays/${params.ownerUserId}/${params.replayJobId}/${safeName(params.name)}`,
    bytes: params.bytes,
    contentType,
  });
}

export async function signedPrivateAudioUrl(uri: string | null | undefined) {
  if (!uri) return null;
  if (isPrivateAudioUri(uri)) return `/api/local-audio?uri=${encodeURIComponent(uri)}`;
  return null;
}

export async function downloadPrivateAudioObject(uri: string) {
  if (isLocalAudioUri(uri)) {
    return readFile(resolveLocalObjectPath(objectNameFromLocalUri(uri)));
  }
  if (isAzureAudioUri(uri)) {
    const { container, objectName } = partsFromAzureUri(uri);
    const response = await azureBlobFetch('GET', container, objectName);
    if (!response.ok) throw new Error(`Azure Blob download failed with ${response.status}: ${await response.text().catch(() => '')}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('A private local:// or azblob:// audio object is required.');
}
