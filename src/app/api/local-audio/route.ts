import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { downloadPrivateAudioObject, isPrivateAudioUri, privateAudioObjectName } from '@/lib/captureStorage';

export const dynamic = 'force-dynamic';

const ownerScopedRoots = new Set(['audio-library', 'captures', 'imports', 'replays']);

function contentTypeForObject(objectName: string) {
  const lower = objectName.toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/webm';
}

function objectBelongsToUser(objectName: string, userId: string) {
  const [root, owner] = objectName.split('/');
  return ownerScopedRoots.has(root) && owner === userId;
}

export async function GET(req: Request) {
  try {
    const account = await requireAccount();
    const uri = new URL(req.url).searchParams.get('uri');
    if (!isPrivateAudioUri(uri)) {
      return NextResponse.json({ error: 'Private audio URI is required.' }, { status: 400 });
    }
    const objectName = privateAudioObjectName(uri);
    if (!objectBelongsToUser(objectName, account.userId)) {
      return NextResponse.json({ error: 'Audio not found.' }, { status: 404 });
    }
    const bytes = await downloadPrivateAudioObject(uri);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': contentTypeForObject(objectName),
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'Audio could not be loaded.' }, { status: 500 });
  }
}
