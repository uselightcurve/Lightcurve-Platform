import { storage } from '@/lib/gcp';

export async function storeCaptureAudio(params: {
  ownerUserId: string;
  captureSessionId: string;
  leg: 'human' | 'agent';
  contentType: string;
  bytes: Buffer;
}) {
  const bucketName = process.env.GCS_BUCKET?.trim();
  if (!bucketName) throw new Error('GCS_BUCKET is not configured.');
  const extension = params.contentType.includes('wav') ? 'wav' : params.contentType.includes('ogg') ? 'ogg' : 'webm';
  const objectName = `captures/${params.ownerUserId}/${params.captureSessionId}/${params.leg}.${extension}`;
  await storage.bucket(bucketName).file(objectName).save(params.bytes, {
    resumable: false,
    contentType: params.contentType,
    metadata: { cacheControl: 'private, max-age=0, no-store' },
  });
  return `gs://${bucketName}/${objectName}`;
}

export async function storeReplayAudio(params: {
  ownerUserId: string;
  replayJobId: string;
  name: string;
  bytes: Buffer;
  contentType?: string;
}) {
  const bucketName = process.env.GCS_BUCKET?.trim();
  if (!bucketName) throw new Error('GCS_BUCKET is not configured.');
  const safeName = params.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectName = `replays/${params.ownerUserId}/${params.replayJobId}/${safeName}`;
  await storage.bucket(bucketName).file(objectName).save(params.bytes, {
    resumable: false,
    contentType: params.contentType ?? 'audio/wav',
    metadata: { cacheControl: 'private, max-age=0, no-store' },
  });
  return `gs://${bucketName}/${objectName}`;
}

export async function signedPrivateAudioUrl(uri: string | null | undefined) {
  if (!uri?.startsWith('gs://')) return null;
  const [bucketName, ...parts] = uri.slice(5).split('/');
  const objectName = parts.join('/');
  if (!bucketName || !objectName) return null;
  const [url] = await storage.bucket(bucketName).file(objectName).getSignedUrl({
    action: 'read',
    expires: Date.now() + 15 * 60_000,
  });
  return url;
}

export async function downloadPrivateGcsObject(uri: string) {
  if (!uri.startsWith('gs://')) throw new Error('A private gs:// object is required.');
  const [bucketName, ...parts] = uri.slice(5).split('/');
  const [bytes] = await storage.bucket(bucketName).file(parts.join('/')).download();
  return bytes;
}
