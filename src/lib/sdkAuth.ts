import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys, users } from '@/db/schema';

export function hashApiKey(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function generateApiKey() {
  const secret = randomBytes(24).toString('base64url');
  const value = `lc_${secret}`;
  return { value, prefix: value.slice(0, 11), hash: hashApiKey(value) };
}

export async function requireSdkAccount(req: Request) {
  const authorization = req.headers.get('authorization') ?? '';
  const value = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!value.startsWith('lc_')) throw new Response('Unauthorized', { status: 401 });
  const [row] = await db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.ownerUserId))
    .where(and(eq(apiKeys.keyHash, hashApiKey(value)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) throw new Response('Unauthorized', { status: 401 });
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
  return { userId: row.user.id, email: row.user.email, name: row.user.name ?? '', apiKeyId: row.key.id };
}

export function sdkUnauthorizedJson(error: unknown) {
  if (error instanceof Response) {
    return Response.json({ error: error.status === 401 ? 'Invalid Lightcurve API key.' : 'Request failed.' }, { status: error.status });
  }
  return null;
}
