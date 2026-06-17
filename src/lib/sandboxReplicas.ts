import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  sandboxEnvironments,
  sandboxRecords,
  sandboxSources,
  sandboxToolEvents,
} from '@/db/schema';

export type SandboxType = 'crm' | 'calendar' | 'reservation';

export type SandboxPanel = {
  environmentId: string;
  sourceId: string | null;
  title: string;
  endpoint: string;
  status: string;
  rows: Array<{ label: string; value: string }>;
  timeline: Array<{ tool: string; detail: string; status?: 'queued' | 'calling' | '200 OK' | 'blocked' }>;
};

type ScenarioLike = {
  id?: string;
  name?: string;
  language?: string;
  domain?: string | null;
  callerSeed?: number | null;
  persona?: {
    name?: string;
    goal?: string;
    opening_line?: string;
    interrupts?: boolean;
  };
  pronunciation?: {
    entityType?: string;
    targetValue?: string;
  };
};

type SourceRow = Record<string, unknown>;

export function normalizeSandboxType(value: unknown): SandboxType | null {
  const text = String(value ?? '').toLowerCase().replace(/\s+/g, '_');
  if (text === 'crm') return 'crm';
  if (text === 'calendar') return 'calendar';
  if (text === 'reservation' || text === 'booking' || text === 'hotel') return 'reservation';
  return null;
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toRows(value: unknown): SourceRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is SourceRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .slice(0, 500);
}

function scenarioName(scenario?: ScenarioLike | null) {
  return stringValue(scenario?.persona?.name, 'Jordan');
}

function scenarioTarget(scenario?: ScenarioLike | null) {
  return (
    stringValue(scenario?.pronunciation?.targetValue) ||
    stringValue(scenario?.persona?.goal, 'customer request')
  );
}

export function buildStarterRows(type: SandboxType, scenario?: ScenarioLike | null): SourceRow[] {
  const customerName = scenarioName(scenario);
  const target = scenarioTarget(scenario);
  const domain = stringValue(scenario?.domain, 'general');
  if (type === 'calendar') {
    return [
      {
        date: '2026-06-03',
        slot: domain === 'healthcare' ? '09:30' : '15:30',
        timezone: scenario?.language === 'hi-IN' ? 'Asia/Kolkata' : 'America/New_York',
        availability: domain === 'healthcare' ? 'no_slots' : 'available',
        booking_status: 'open',
        customer_name: customerName,
        notes: stringValue(scenario?.persona?.goal, 'Find a safe appointment time.'),
      },
      {
        date: '2026-06-03',
        slot: '15:30',
        timezone: scenario?.language === 'hi-IN' ? 'Asia/Kolkata' : 'America/New_York',
        availability: 'conflict',
        booking_status: 'held_by_another_customer',
        customer_name: 'Existing customer',
        notes: 'Conflict guard row',
      },
    ];
  }

  if (type === 'reservation') {
    return [
      {
        property: 'Lightcurve Retreat',
        date_range: '2026-07-04 to 2026-07-06',
        timezone: scenario?.language === 'hi-IN' ? 'Asia/Kolkata' : 'America/New_York',
        adults: 4,
        children: 0,
        child_ages: '',
        room_type: 'Garden Villa',
        valid_room_types: 'Garden Villa, River Suite, Family Cottage, Courtyard Room, Mountain View Suite, Pool Villa',
        availability: 'available',
        room_inventory: 'Garden Villa: 3, River Suite: 1, Family Cottage: 2',
        occupancy_rule: 'For 4 guests ask: one room with extra bedding or two rooms before pricing.',
        inclusions: 'Breakfast plan, taxes shown separately, optional airport transfer',
        base_price: '12000',
        tax_rate: '0.18',
        quote_status: 'not_quoted',
        notes: stringValue(scenario?.persona?.goal, 'Create a safe booking quote.'),
      },
      {
        property: 'Lightcurve Retreat',
        date_range: '2026-07-04 to 2026-07-06',
        room_type: 'Presidential Cave',
        availability: 'invalid_room_type',
        room_inventory: 'Invalid room guard row',
        occupancy_rule: 'Reject invalid room names and offer valid alternatives.',
        quote_status: 'blocked',
      },
    ];
  }

  return [
    {
      customer_name: customerName,
      email: target.includes('@') ? target : 'john.smith@gmail.com',
      phone: target.startsWith('+') ? target : '+12164748341',
      account_status: 'active',
      order_status: domain === 'ecommerce' ? 'refund_review_required' : 'standard_support',
      record_status: scenario?.persona?.interrupts ? 'duplicate_match' : 'single_match',
      pending_value: '',
    },
    {
      customer_name: customerName,
      email: 'duplicate.customer@example.com',
      phone: '+18005550007',
      account_status: 'active',
      order_status: 'duplicate_record',
      record_status: 'duplicate_match',
      pending_value: '',
    },
  ];
}

function recordKind(type: SandboxType) {
  if (type === 'reservation') return 'reservation_record';
  return type === 'calendar' ? 'calendar_slot' : 'customer';
}

function rowRef(type: SandboxType, row: SourceRow, index: number) {
  if (type === 'calendar') return stringValue(row.id) || `${row.date ?? 'date'}-${row.slot ?? index}`;
  if (type === 'reservation') return stringValue(row.id) || `${row.property ?? 'property'}-${row.room_type ?? index}`;
  return stringValue(row.id) || stringValue(row.customer_id) || stringValue(row.email) || `customer-${index + 1}`;
}

export async function listSandboxSources(ownerUserId: string, type?: SandboxType | null) {
  const where = type
    ? and(eq(sandboxSources.ownerUserId, ownerUserId), eq(sandboxSources.type, type))
    : eq(sandboxSources.ownerUserId, ownerUserId);

  return db
    .select({
      id: sandboxSources.id,
      type: sandboxSources.type,
      name: sandboxSources.name,
      sourceKind: sandboxSources.sourceKind,
      sampleRows: sandboxSources.sampleRows,
      createdAt: sandboxSources.createdAt,
      updatedAt: sandboxSources.updatedAt,
    })
    .from(sandboxSources)
    .where(where)
    .orderBy(desc(sandboxSources.updatedAt), desc(sandboxSources.createdAt));
}

export async function createSandboxSource(params: {
  ownerUserId: string;
  type: SandboxType;
  name: string;
  rows: SourceRow[];
  schemaMapping?: Record<string, unknown> | null;
  sourceKind?: string;
}) {
  const rows = toRows(params.rows);
  if (!rows.length) throw new Error('Upload at least one CRM, calendar, or reservation row.');

  const [source] = await db
    .insert(sandboxSources)
    .values({
      ownerUserId: params.ownerUserId,
      type: params.type,
      name: stringValue(
        params.name,
        params.type === 'calendar'
          ? 'Calendar sandbox source'
          : params.type === 'reservation'
            ? 'Reservation sandbox source'
            : 'CRM sandbox source',
      ),
      sourceKind: stringValue(params.sourceKind, 'upload'),
      schemaMapping: params.schemaMapping ?? null,
      sampleRows: rows,
      updatedAt: new Date(),
    })
    .returning();

  return source;
}

export async function createSandboxEnvironment(params: {
  ownerUserId: string;
  type: SandboxType;
  runId?: string | null;
  sourceId?: string | null;
  scenario?: ScenarioLike | null;
}) {
  let sourceRows: SourceRow[] = [];
  let sourceId: string | null = null;

  if (params.sourceId) {
    const [source] = await db
      .select()
      .from(sandboxSources)
      .where(and(eq(sandboxSources.id, params.sourceId), eq(sandboxSources.ownerUserId, params.ownerUserId)))
      .limit(1);
    if (!source) throw new Error('Sandbox source not found.');
    if (source.type !== params.type) throw new Error('Sandbox source type does not match the selected environment.');
    sourceRows = toRows(source.sampleRows);
    sourceId = source.id;
  }

  if (!sourceRows.length) sourceRows = buildStarterRows(params.type, params.scenario);

  const [environment] = await db
    .insert(sandboxEnvironments)
    .values({
      ownerUserId: params.ownerUserId,
      runId: params.runId ?? null,
      sourceId,
      type: params.type,
      status: 'ready',
      seedMetadata: {
        generatedFallback: !sourceId,
        scenarioId: params.scenario?.id,
        scenarioName: params.scenario?.name,
      },
    })
    .returning();

  await db.insert(sandboxRecords).values(
    sourceRows.map((row, index) => ({
      ownerUserId: params.ownerUserId,
      environmentId: environment.id,
      kind: recordKind(params.type),
      externalRef: rowRef(params.type, row, index),
      data: row,
    })),
  );

  return buildSandboxPanel(environment.id, params.ownerUserId);
}

export async function buildSandboxPanel(environmentId: string, ownerUserId: string): Promise<SandboxPanel> {
  const [environment] = await db
    .select()
    .from(sandboxEnvironments)
    .where(and(eq(sandboxEnvironments.id, environmentId), eq(sandboxEnvironments.ownerUserId, ownerUserId)))
    .limit(1);
  if (!environment) throw new Error('Sandbox environment not found.');

  const type = normalizeSandboxType(environment.type);
  if (!type) throw new Error('Unsupported sandbox environment.');

  const records = await db
    .select()
    .from(sandboxRecords)
    .where(and(eq(sandboxRecords.environmentId, environment.id), eq(sandboxRecords.ownerUserId, ownerUserId)))
    .orderBy(asc(sandboxRecords.createdAt));
  const events = await db
    .select()
    .from(sandboxToolEvents)
    .where(and(eq(sandboxToolEvents.environmentId, environment.id), eq(sandboxToolEvents.ownerUserId, ownerUserId)))
    .orderBy(asc(sandboxToolEvents.createdAt));
  const first = records[0]?.data as SourceRow | undefined;

  if (type === 'calendar') {
    return {
      environmentId: environment.id,
      sourceId: environment.sourceId,
      title: 'Calendar',
      endpoint: `/api/sandbox/calendar/slots`,
      status: stringValue(first?.booking_status, stringValue(first?.availability, 'Ready')),
      rows: [
        { label: 'Date', value: stringValue(first?.date, 'Not set') },
        { label: 'Slot', value: stringValue(first?.slot, 'Not set') },
        { label: 'Timezone', value: stringValue(first?.timezone, 'Local') },
        { label: 'Status', value: stringValue(first?.booking_status, stringValue(first?.availability, 'Ready')) },
      ],
      timeline: events.length ? events.map(eventToTimeline) : [
        { tool: 'calendar.find_slots', detail: 'Run copy ready', status: 'queued' },
        { tool: 'calendar.detect_conflict', detail: `${records.length} sandbox slots`, status: 'queued' },
        { tool: 'calendar.hold_slot', detail: 'No source data will be mutated', status: 'queued' },
      ],
    };
  }

  if (type === 'reservation') {
    return {
      environmentId: environment.id,
      sourceId: environment.sourceId,
      title: 'Reservation',
      endpoint: `/api/sandbox/reservation/availability`,
      status: stringValue(first?.quote_status, stringValue(first?.availability, 'Ready')),
      rows: [
        { label: 'Property', value: stringValue(first?.property, 'Property') },
        { label: 'Room', value: stringValue(first?.room_type, 'Not selected') },
        { label: 'Guests', value: `${stringValue(first?.adults, '0')} adults, ${stringValue(first?.children, '0')} children` },
        { label: 'Status', value: stringValue(first?.quote_status, stringValue(first?.availability, 'Ready')) },
      ],
      timeline: events.length ? events.map(eventToTimeline) : [
        { tool: 'reservation.availability', detail: `${records.length} booking records copied`, status: 'queued' },
        { tool: 'reservation.inventory', detail: 'Room inventory ready', status: 'queued' },
        { tool: 'reservation.quote_price', detail: 'Quote writes only to this run copy', status: 'queued' },
        { tool: 'reservation.escalate', detail: 'Escalation path available for blocked cases', status: 'queued' },
      ],
    };
  }

  return {
    environmentId: environment.id,
    sourceId: environment.sourceId,
    title: 'CRM',
    endpoint: `/api/sandbox/crm/customer`,
    status: stringValue(first?.record_status, stringValue(first?.account_status, 'Ready')),
    rows: [
      { label: 'Customer', value: stringValue(first?.customer_name, stringValue(first?.name, 'Unknown')) },
      { label: 'Email', value: stringValue(first?.email, 'Missing') },
      { label: 'Phone', value: stringValue(first?.phone, 'Missing') },
      { label: 'Record', value: stringValue(first?.record_status, stringValue(first?.account_status, 'Ready')) },
    ],
    timeline: events.length ? events.map(eventToTimeline) : [
      { tool: 'crm.lookup_customer', detail: `${records.length} sandbox records copied`, status: 'queued' },
      { tool: 'crm.validate_field', detail: 'Email and phone validators ready', status: 'queued' },
      { tool: 'crm.save_pending', detail: 'Writes only to this run copy', status: 'queued' },
    ],
  };
}

function eventToTimeline(event: typeof sandboxToolEvents.$inferSelect): SandboxPanel['timeline'][number] {
  const output = event.output as SourceRow;
  return {
    tool: `${event.tool}.${event.action}`,
    detail: stringValue(output.detail, stringValue(output.message, 'Tool executed')),
    status: event.status === 'blocked' ? 'blocked' : '200 OK',
  };
}

export async function applySandboxAction(params: {
  ownerUserId: string;
  environmentId: string;
  tool: SandboxType;
  action: string;
  input: Record<string, unknown>;
}) {
  const [environment] = await db
    .select()
    .from(sandboxEnvironments)
    .where(and(eq(sandboxEnvironments.id, params.environmentId), eq(sandboxEnvironments.ownerUserId, params.ownerUserId)))
    .limit(1);
  if (!environment) throw new Error('Sandbox environment not found.');
  if (environment.type !== params.tool) throw new Error('Sandbox tool does not match this environment.');

  const records = await db
    .select()
    .from(sandboxRecords)
    .where(and(eq(sandboxRecords.environmentId, environment.id), eq(sandboxRecords.ownerUserId, params.ownerUserId)))
    .orderBy(asc(sandboxRecords.createdAt));
  const first = records[0];
  if (!first) throw new Error('Sandbox environment has no records.');

  const current = first.data as SourceRow;
  const output = params.tool === 'calendar'
    ? calendarActionOutput(params.action, current, params.input)
    : params.tool === 'reservation'
      ? reservationActionOutput(params.action, current, params.input)
      : crmActionOutput(params.action, current, params.input);

  if (output.patch && output.status !== 'blocked') {
    await db
      .update(sandboxRecords)
      .set({
        data: { ...current, ...output.patch },
        version: Number(first.version ?? 1) + 1,
        updatedAt: new Date(),
      })
      .where(eq(sandboxRecords.id, first.id));
  }

  await db.insert(sandboxToolEvents).values({
    ownerUserId: params.ownerUserId,
    environmentId: environment.id,
    runId: environment.runId,
    tool: params.tool,
    action: params.action,
    input: params.input,
    output: output.output,
    status: output.status,
  });

  return buildSandboxPanel(environment.id, params.ownerUserId);
}

function crmActionOutput(action: string, row: SourceRow, input: SourceRow) {
  if (action === 'customer' || action === 'lookup_customer') {
    return { status: '200 OK', output: { detail: `Loaded ${stringValue(row.customer_name, 'customer')} profile` } };
  }
  if (action === 'validate_field') {
    const value = stringValue(input.value, stringValue(input.targetValue));
    const isEmail = value.includes('@');
    const ok = isEmail ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) : /^\+\d{8,15}$/.test(value.replace(/[\s().-]/g, ''));
    return {
      status: ok ? '200 OK' : 'blocked',
      output: { detail: ok ? `Validated ${isEmail ? 'email' : 'phone'} ${value}` : `Invalid value ${value || 'missing'}` },
      patch: ok ? { pending_value: value, pending_field: isEmail ? 'email' : 'phone' } : undefined,
    };
  }
  if (action === 'save_pending' || action === 'confirm_save') {
    const pending = stringValue(row.pending_value, stringValue(input.value));
    const field = stringValue(row.pending_field, pending.includes('@') ? 'email' : 'phone');
    return {
      status: pending ? '200 OK' : 'blocked',
      output: { detail: pending ? `Saved ${field} after confirmation` : 'No pending value to save' },
      patch: pending ? { [field]: pending, pending_value: '', pending_field: '', record_status: 'updated_in_run_copy' } : undefined,
    };
  }
  return { status: '200 OK', output: { detail: 'CRM sandbox action recorded' } };
}

function calendarActionOutput(action: string, row: SourceRow, input: SourceRow) {
  if (action === 'slots' || action === 'find_slots') {
    return { status: '200 OK', output: { detail: `Found ${stringValue(row.availability, 'availability')} for ${stringValue(row.slot, 'slot')}` } };
  }
  if (action === 'detect_conflict') {
    const conflict = stringValue(row.availability).includes('conflict') || stringValue(row.booking_status).includes('held');
    return {
      status: conflict ? 'blocked' : '200 OK',
      output: { detail: conflict ? 'Conflict detected before booking' : 'No conflict detected' },
    };
  }
  if (action === 'hold_slot') {
    return {
      status: stringValue(row.availability).includes('no_slots') ? 'blocked' : '200 OK',
      output: { detail: stringValue(row.availability).includes('no_slots') ? 'No slots available to hold' : 'Slot held in run copy' },
      patch: stringValue(row.availability).includes('no_slots') ? undefined : { booking_status: 'held_in_sandbox' },
    };
  }
  if (action === 'confirm_booking' || action === 'reschedule' || action === 'cancel') {
    const nextStatus = action === 'cancel' ? 'cancelled_in_sandbox' : action === 'reschedule' ? 'rescheduled_in_sandbox' : 'booked_in_sandbox';
    return {
      status: '200 OK',
      output: { detail: nextStatus.replace(/_/g, ' ') },
      patch: { booking_status: nextStatus, updated_by: 'sandbox_run' },
    };
  }
  return { status: '200 OK', output: { detail: 'Calendar sandbox action recorded' } };
}

function reservationActionOutput(action: string, row: SourceRow, input: SourceRow) {
  if (action === 'availability' || action === 'lookup_availability') {
    const availability = stringValue(row.availability, 'available');
    return {
      status: availability.includes('invalid') ? 'blocked' : '200 OK',
      output: {
        detail: availability.includes('invalid')
          ? `Invalid room type ${stringValue(row.room_type, 'room')}; offer valid alternatives`
          : `Availability is ${availability} for ${stringValue(row.room_type, 'room')}`,
      },
    };
  }
  if (action === 'inventory' || action === 'room_inventory') {
    return {
      status: '200 OK',
      output: { detail: stringValue(row.room_inventory, 'Room inventory copied into the run sandbox') },
    };
  }
  if (action === 'quote_price' || action === 'pricing' || action === 'quote') {
    const adults = Number(input.adults ?? row.adults ?? 2);
    const children = Number(input.children ?? row.children ?? 0);
    const nights = Number(input.nights ?? 2);
    const base = Number(row.base_price ?? 12000);
    const taxRate = Number(row.tax_rate ?? 0.18);
    const roomChoice = stringValue(input.roomChoice, stringValue(input.room_configuration));
    const mustChoose = adults + children >= 4 && !roomChoice;
    if (mustChoose) {
      return {
        status: 'blocked',
        output: { detail: 'Room configuration must be chosen before pricing for this occupancy.' },
      };
    }
    const rooms = Number(input.rooms ?? (adults + children >= 5 ? 2 : 1));
    const subtotal = base * nights * rooms;
    const taxes = Math.round(subtotal * taxRate);
    const total = subtotal + taxes;
    return {
      status: '200 OK',
      output: { detail: `Quoted ${rooms} room(s), ${nights} night(s), taxes ${taxes}, total ${total}` },
      patch: {
        quote_status: 'quoted_in_run_copy',
        adults,
        children,
        rooms,
        nights,
        taxes,
        total,
        room_configuration: roomChoice || `${rooms} room(s)`,
      },
    };
  }
  if (action === 'package' || action === 'package_lookup' || action === 'experience') {
    const packageName = stringValue(input.package, stringValue(input.name, 'package'));
    const allowed = stringValue(row.inclusions).toLowerCase().includes(packageName.toLowerCase()) || !packageName;
    return {
      status: allowed ? '200 OK' : 'blocked',
      output: {
        detail: allowed
          ? `${packageName || 'Package'} is grounded in copied reservation data`
          : `${packageName} is not in approved package data; escalate or clarify`,
      },
    };
  }
  if (action === 'transfer' || action === 'escalate') {
    return {
      status: '200 OK',
      output: { detail: 'Escalation path recorded for booking specialist review' },
      patch: { quote_status: 'escalated_in_run_copy' },
    };
  }
  return { status: '200 OK', output: { detail: 'Reservation sandbox action recorded' } };
}
