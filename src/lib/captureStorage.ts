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
