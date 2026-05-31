import { NextResponse } from 'next/server';
import { requireAccount, unauthorizedJson } from '@/lib/account';

type SandboxRow = { label: string; value: string };
type SandboxTimelineItem = { tool: string; detail: string; status: 'queued' | 'calling' | '200 OK' | 'blocked' };

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown) {
  return value === true || value === 'true';
}

function buildSandboxFixture(tool: string, action: string, body: Record<string, unknown>) {
  const domain = stringValue(body.domain, 'general');
  const language = stringValue(body.language, 'en-US');
  const name = stringValue(body.personaName, 'Customer');
  const goal = stringValue(body.goal, 'customer request');
  const targetValue = stringValue(body.targetValue, goal);
  const entityType = stringValue(body.entityType, 'intent');
  const interrupts = boolValue(body.interrupts);
  const seed = stringValue(body.callerSeed, 'sandbox');

  const base = {
    requestId: `sandbox-${tool}-${seed}`,
    endpoint: `/api/sandbox/${tool}/${action}`,
    receivedAt: new Date().toISOString(),
  };

  if (tool === 'crm') {
    return {
      ...base,
      title: 'CRM',
      status: entityType === 'email' || entityType === 'phone_number' ? 'Contact update open' : 'Customer profile loaded',
      rows: [
        { label: 'Customer', value: name },
        { label: entityType === 'email' ? 'Email' : entityType === 'phone_number' ? 'Phone' : 'Intent', value: targetValue },
        { label: 'Record', value: interrupts ? 'Duplicate match' : `${domain.slice(0, 3).toUpperCase()}-${seed}` },
      ] satisfies SandboxRow[],
      timeline: [
        { tool: 'crm.lookup_customer', detail: `${name} profile`, status: '200 OK' },
        { tool: 'crm.validate_field', detail: targetValue, status: '200 OK' },
        { tool: 'crm.save_pending', detail: 'Waits for caller confirmation', status: 'queued' },
      ] satisfies SandboxTimelineItem[],
    };
  }

  if (tool === 'calendar') {
    const noSlots = domain === 'healthcare' || goal.toLowerCase().includes('urgent');
    return {
      ...base,
      title: 'Calendar',
      status: noSlots ? 'No matching slots' : 'Availability fixture',
      rows: [
        { label: 'Today', value: noSlots ? 'No slots' : '2 slots' },
        { label: 'Next open', value: noSlots ? 'Tomorrow 10:30 AM' : 'Fri 3:30 PM' },
        { label: 'Timezone', value: language === 'hi-IN' ? 'IST locked' : 'Caller local' },
      ] satisfies SandboxRow[],
      timeline: [
        { tool: 'calendar.find_slots', detail: 'Available appointment windows', status: '200 OK' },
        { tool: 'calendar.detect_conflict', detail: noSlots ? 'Conflicting times found' : 'No conflict', status: noSlots ? 'blocked' : '200 OK' },
        { tool: 'calendar.hold_slot', detail: noSlots ? 'No hold created' : 'Temporary sandbox hold', status: noSlots ? 'queued' : '200 OK' },
      ] satisfies SandboxTimelineItem[],
    };
  }

  if (tool === 'tickets') {
    return {
      ...base,
      title: 'Tickets',
      status: interrupts ? 'Open ticket exists' : 'Support fixture',
      rows: [
        { label: 'Open ticket', value: interrupts ? 'Exists' : 'None' },
        { label: 'Policy', value: domain === 'ecommerce' ? 'Refund review' : 'Escalation path' },
        { label: 'SLA', value: domain === 'healthcare' ? 'Priority' : 'Standard' },
      ] satisfies SandboxRow[],
      timeline: [
        { tool: 'tickets.search_open', detail: 'Existing issue lookup', status: '200 OK' },
        { tool: 'tickets.apply_policy', detail: 'Refund or escalation rule', status: interrupts ? 'blocked' : '200 OK' },
        { tool: 'tickets.create_note', detail: 'Transcript evidence attached', status: 'queued' },
      ] satisfies SandboxTimelineItem[],
    };
  }

  if (tool === 'payments') {
    const retry = interrupts || goal.toLowerCase().includes('payment');
    return {
      ...base,
      title: 'Payments',
      status: retry ? 'Authorization needs retry' : 'Payment fixture',
      rows: [
        { label: 'Method', value: domain === 'banking' ? 'ACH' : 'Visa ending 4242' },
        { label: 'Auth', value: retry ? 'Requires retry' : 'Approved' },
        { label: 'Fallback', value: 'Confirm consent' },
      ] satisfies SandboxRow[],
      timeline: [
        { tool: 'payments.authorize', detail: 'Sandbox authorization', status: retry ? 'blocked' : '200 OK' },
        { tool: 'payments.handle_failure', detail: 'Failed-card branch available', status: retry ? '200 OK' : 'queued' },
        { tool: 'payments.write_receipt', detail: 'Receipt waits for confirmation', status: 'queued' },
      ] satisfies SandboxTimelineItem[],
    };
  }

  return {
    ...base,
    title: 'Knowledge Base',
    status: interrupts ? 'Policy conflict found' : 'Policy grounding',
    rows: [
      { label: 'Article', value: `${domain} policy` },
      { label: 'Version', value: interrupts ? 'Conflict found' : 'Current' },
      { label: 'Escalate', value: 'If policy mismatch' },
    ] satisfies SandboxRow[],
    timeline: [
      { tool: 'kb.search_policy', detail: 'Relevant policy snippets', status: '200 OK' },
      { tool: 'kb.compare_versions', detail: 'Outdated-info guard', status: interrupts ? 'blocked' : '200 OK' },
      { tool: 'kb.cite_answer', detail: 'Grounded response check', status: 'queued' },
    ] satisfies SandboxTimelineItem[],
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ tool: string; action: string }> }) {
  try {
    await requireAccount();
    const { tool, action } = await params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(buildSandboxFixture(tool, action, body));
  } catch (error) {
    const unauthorized = unauthorizedJson(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : 'Sandbox tool unavailable';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
