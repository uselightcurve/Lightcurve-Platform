import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes, captureSessions } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { createLiveKitAccessToken, liveKitPublicStatus } from '@/lib/livekit';

const CUSTOMER_EMAIL = 'shivam@kolsetu.com';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function livekitMetadata(value: unknown) {
  const metadata = record(value);
  return record(metadata.livekit);
}

function uniqueRoomName(baseRoom: string) {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${baseRoom || 'lightcurve-kolsetu'}-${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    if (account.email.trim().toLowerCase() !== CUSTOMER_EMAIL) {
      return NextResponse.json({ error: 'LiveKit simulation rooms are only enabled for this customer account.' }, { status: 403 });
    }

    const livekitStatus = liveKitPublicStatus();
    if (!livekitStatus.configured) {
      return NextResponse.json({ error: 'Lightcurve LiveKit credentials are not configured.' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const [runtime] = await db
      .select()
      .from(agentRuntimes)
      .where(and(
        eq(agentRuntimes.ownerUserId, account.userId),
        eq(agentRuntimes.framework, 'livekit'),
      ))
      .orderBy(desc(agentRuntimes.updatedAt))
      .limit(1);

    if (!runtime) {
      return NextResponse.json({ error: 'Save the Kolsetu LiveKit agent configuration first.' }, { status: 409 });
    }

    const metadata = livekitMetadata(runtime.metadata);
    const baseRoom = text(body.roomName) || text(metadata.roomName) || 'lightcurve-kolsetu-shivam';
    const roomName = body.reuseRoom === true ? baseRoom : uniqueRoomName(baseRoom);
    const agentIdentity = text(metadata.agentIdentity) || 'kolsetu-agent';
    const agentName = text(metadata.agentName) || 'Kolsetu agent';
    const participantMetadata = text(metadata.participantMetadata) || JSON.stringify({
      tenant: 'kolsetu',
      contact: CUSTOMER_EMAIL,
      source: 'lightcurve-simulation',
    });
    const callerIdentity = `lightcurve-sim-${Date.now().toString(36)}`;

    const callerToken = createLiveKitAccessToken({
      identity: callerIdentity,
      name: 'Lightcurve simulated caller',
      roomName,
      metadata: JSON.stringify({ role: 'simulated-caller', customer: CUSTOMER_EMAIL }),
      ttlSeconds: 60 * 60,
    });
    const agentToken = createLiveKitAccessToken({
      identity: agentIdentity,
      name: agentName,
      roomName,
      metadata: participantMetadata,
      ttlSeconds: 60 * 60,
    });
    const agentWorkerToken = createLiveKitAccessToken({
      identity: `${agentIdentity}-worker`,
      name: `${agentName} worker`,
      metadata: participantMetadata,
      ttlSeconds: 60 * 60,
      agentWorker: true,
    });

    const [capture] = await db.insert(captureSessions).values({
      ownerUserId: account.userId,
      runtimeId: runtime.id,
      status: 'livekit_ready',
      metadata: {
        source: 'livekit-simulation',
        roomName,
        livekitUrl: livekitStatus.url,
        callerIdentity,
        agentIdentity,
        requestedBy: account.email,
        createdFor: CUSTOMER_EMAIL,
        purpose: text(body.purpose) || 'simulated_call',
      },
      startedAt: new Date(),
    }).returning();

    return NextResponse.json({
      capture,
      completeUrl: `/api/sdk/captures/${capture.id}/complete`,
      room: {
        url: livekitStatus.url,
        name: roomName,
      },
      caller: {
        identity: callerIdentity,
        token: callerToken,
      },
      agent: {
        identity: agentIdentity,
        name: agentName,
        token: agentToken,
        workerToken: agentWorkerToken,
        metadata: participantMetadata,
      },
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('LiveKit simulation room creation failed', error);
    return NextResponse.json({ error: 'LiveKit simulation room could not be created.' }, { status: 500 });
  }
}
