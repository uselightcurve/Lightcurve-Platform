import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentRuntimes } from '@/db/schema';
import { requireAccount, unauthorizedJson } from '@/lib/account';
import { liveKitPublicStatus } from '@/lib/livekit';

const DEFAULT_CUSTOMER_EMAIL = 'shivam@kolsetu.com';

function canUseLiveKitConfig(email: string) {
  return email.trim().toLowerCase() === DEFAULT_CUSTOMER_EMAIL;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function runtimeMetadata(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function livekitMetadata(value: unknown) {
  const metadata = runtimeMetadata(value);
  return metadata.livekit && typeof metadata.livekit === 'object' && !Array.isArray(metadata.livekit)
    ? metadata.livekit as Record<string, unknown>
    : {};
}

function publicConfig(runtime: typeof agentRuntimes.$inferSelect | undefined) {
  if (!runtime) {
    return {
      customerEmail: DEFAULT_CUSTOMER_EMAIL,
      customerName: 'Kolsetu',
      runtimeName: 'Kolsetu LiveKit agent',
      serverUrl: '',
      roomName: 'lightcurve-kolsetu-shivam',
      agentIdentity: 'kolsetu-agent',
      agentName: 'Kolsetu agent',
      participantMetadata: '',
      lightcurveLiveKit: liveKitPublicStatus(),
    };
  }

  const livekit = livekitMetadata(runtime.metadata);
  return {
    id: runtime.id,
    customerEmail: text(livekit.customerEmail) || DEFAULT_CUSTOMER_EMAIL,
    customerName: text(livekit.customerName) || 'Kolsetu',
    runtimeName: runtime.name,
    serverUrl: text(livekit.serverUrl),
    roomName: text(livekit.roomName),
    agentIdentity: text(livekit.agentIdentity),
    agentName: text(livekit.agentName),
    participantMetadata: text(livekit.participantMetadata),
    lightcurveLiveKit: liveKitPublicStatus(),
    updatedAt: runtime.updatedAt,
  };
}

export async function GET() {
  try {
    const account = await requireAccount();
    if (!canUseLiveKitConfig(account.email)) {
      return NextResponse.json({ eligible: false, config: null }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const [runtime] = await db
      .select()
      .from(agentRuntimes)
      .where(and(
        eq(agentRuntimes.ownerUserId, account.userId),
        eq(agentRuntimes.framework, 'livekit'),
      ))
      .orderBy(desc(agentRuntimes.updatedAt))
      .limit(1);

    return NextResponse.json({ eligible: true, config: publicConfig(runtime) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    return NextResponse.json({ error: 'LiveKit configuration is unavailable.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const account = await requireAccount();
    if (!canUseLiveKitConfig(account.email)) {
      return NextResponse.json({ error: 'LiveKit configuration is only enabled for this customer account.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const customerEmail = text(body.customerEmail).toLowerCase() || DEFAULT_CUSTOMER_EMAIL;
    const customerName = text(body.customerName) || 'Kolsetu';
    const runtimeName = text(body.runtimeName) || `${customerName} LiveKit agent`;
    const serverUrl = liveKitPublicStatus().url || text(body.serverUrl);
    const roomName = text(body.roomName);
    const agentIdentity = text(body.agentIdentity);
    const agentName = text(body.agentName) || agentIdentity;
    const participantMetadata = text(body.participantMetadata);

    if (!customerEmail.includes('@')) {
      return NextResponse.json({ error: 'Customer email is required.' }, { status: 400 });
    }
    if (!liveKitPublicStatus().configured) {
      return NextResponse.json({ error: 'Configure Lightcurve LiveKit credentials before saving this customer room.' }, { status: 500 });
    }
    if (!roomName) {
      return NextResponse.json({ error: 'Lightcurve LiveKit room name is required.' }, { status: 400 });
    }
    if (!agentIdentity) {
      return NextResponse.json({ error: 'Agent participant identity is required.' }, { status: 400 });
    }

    const now = new Date();
    const metadata = {
      source: 'livekit-backend-config',
      livekit: {
        customerEmail,
        customerName,
        serverUrl,
        roomName,
        agentIdentity,
        agentName,
        participantMetadata,
        configuredBy: account.email,
        configuredAt: now.toISOString(),
      },
    };

    const [runtime] = await db
      .insert(agentRuntimes)
      .values({
        ownerUserId: account.userId,
        name: runtimeName,
        framework: 'livekit',
        version: roomName,
        status: 'online',
        metadata,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [agentRuntimes.ownerUserId, agentRuntimes.name],
        set: {
          framework: 'livekit',
          version: roomName,
          status: 'online',
          metadata,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning();

    return NextResponse.json({ config: publicConfig(runtime), runtime }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    console.error('LiveKit configuration failed', error);
    return NextResponse.json({ error: 'LiveKit configuration could not be saved.' }, { status: 500 });
  }
}
