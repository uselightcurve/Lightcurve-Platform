import importedSeeds from '@/data/real-scenario-seeds.json';
import { seedToScenario, type DatasetScenarioSeed } from './datasetScenarios';
import type { PronunciationSpec } from './pronunciation';

export type LibraryScenario = {
  id: string;
  name: string;
  language: string;
  domain: string;
  persona: {
    name: string;
    age: number;
    accent: string;
    emotional_state: string;
    goal: string;
    noise_db: number;
    speed_wpm: number;
    interrupts: boolean;
    opening_line: string;
    code_switching?: boolean;
  };
  successCriteria: Array<{ type: string; description: string; weight: number }>;
  callerSeed: number;
  isPreset: boolean;
  parentName?: string;
  source?: {
    provider?: string;
    dataset?: string;
    externalCallId?: string;
    promptRecommendation?: string;
  };
  pronunciation?: PronunciationSpec;
};

const personaNames: Record<string, string[]> = {
  ecommerce: ['Jordan', 'Maya', 'Dev', 'Nora', 'Sam'],
  banking: ['Priya', 'Elliot', 'Rohan', 'Nina', 'Marcus'],
  telecom: ['Rahul', 'Kevin', 'Aarav', 'Meera', 'Owen'],
  healthcare: ['Elena', 'Carlos', 'Anika', 'Leah', 'Noah'],
  general: ['Taylor', 'Alex', 'Riley', 'Casey', 'Jamie'],
};

type ScenarioFamily =
  | 'email_capture'
  | 'phone_capture'
  | 'cancel_order'
  | 'change_order'
  | 'refund'
  | 'delivery'
  | 'invoice'
  | 'payment'
  | 'appointment_booking'
  | 'appointment_reschedule'
  | 'appointment_cancel'
  | 'fraud_dispute'
  | 'account_verification'
  | 'outage'
  | 'plan_upgrade'
  | 'bill_payment'
  | 'policy_conflict'
  | 'general_support';

const nameVariants: Record<ScenarioFamily, string[]> = {
  email_capture: ['Email readback correction', 'Email update verification', 'Spelled email capture'],
  phone_capture: ['Phone number readback', 'Phone number correction', 'Callback number capture'],
  cancel_order: ['Order cancellation request', 'Duplicate order cancellation', 'Cancellation fee concern'],
  change_order: ['Order change request', 'Wrong item correction', 'Delivery detail change'],
  refund: ['Refund for missing delivery', 'Refund policy dispute', 'Damaged item refund'],
  delivery: ['Delivery address change', 'Late delivery update', 'Package location check'],
  invoice: ['Invoice lookup request', 'Invoice correction call', 'Billing document check'],
  payment: ['Payment method failure', 'Partial payment request', 'Authorization issue'],
  appointment_booking: ['Appointment booking request', 'Same-day clinic booking', 'Specialist appointment call'],
  appointment_reschedule: ['Appointment reschedule conflict', 'Timezone reschedule confusion', 'Follow-up appointment change'],
  appointment_cancel: ['Appointment cancellation request', 'Clinic cancellation policy', 'Last-minute appointment change'],
  fraud_dispute: ['Suspicious card charge', 'Fraud dispute escalation', 'Unrecognized transaction call'],
  account_verification: ['Account lookup mismatch', 'Duplicate customer record', 'Identity verification issue'],
  outage: ['Internet outage credit', 'Service outage update', 'Restoration ETA request'],
  plan_upgrade: ['Plan upgrade question', 'Pricing confirmation call', 'Data plan change'],
  bill_payment: ['Bill payment help', 'Past-due bill question', 'Payment confirmation call'],
  policy_conflict: ['Policy exception request', 'Conflicting policy answer', 'Escalation path check'],
  general_support: ['Support follow-up call', 'Missing information call', 'Escalation request'],
};

const goalTemplates: Record<ScenarioFamily, string[]> = {
  email_capture: [
    'Update the customer email and require an exact readback before saving it.',
    'Capture a corrected email address, including dots, symbols, and domain.',
    'Verify a spelled email address without skipping or inserting characters.',
  ],
  phone_capture: [
    'Capture the callback number and confirm the country code and grouped digits.',
    'Handle a corrected phone number and read it back before saving.',
    'Verify a phone number with repeated digits or an extension.',
  ],
  cancel_order: [
    'Cancel the order only after confirming eligibility, fee, and next step.',
    'Handle a cancellation request where the caller is unsure about the order details.',
    'Cancel a duplicate order while avoiding policy guesses.',
  ],
  change_order: [
    'Change the order details after confirming the current order and requested update.',
    'Update item or delivery details without losing the customer context.',
    'Handle a correction to an order while confirming the final change.',
  ],
  refund: [
    'Resolve a refund request while checking policy, delivery status, and evidence.',
    'Explain refund options clearly without promising an unsupported outcome.',
    'Handle a frustrated refund caller and confirm the next action.',
  ],
  delivery: [
    'Help the caller with delivery status, address, or ETA without inventing tracking details.',
    'Update delivery information after verifying the customer and order.',
    'Handle a late or missing package with a clear next step.',
  ],
  invoice: [
    'Find or explain an invoice while verifying account details.',
    'Handle an invoice correction request and confirm what changed.',
    'Answer a billing document question without exposing unsafe account data.',
  ],
  payment: [
    'Resolve a failed payment or authorization issue and confirm the next step.',
    'Handle partial payment details while staying within policy.',
    'Verify payment method information without repeating sensitive data unsafely.',
  ],
  appointment_booking: [
    'Book an appointment while confirming department, urgency, date, and timezone.',
    'Find a safe available slot and confirm the appointment details.',
    'Handle a same-day booking request without overpromising availability.',
  ],
  appointment_reschedule: [
    'Reschedule an appointment while avoiding double booking and timezone mistakes.',
    'Move an appointment after confirming the original and new slot.',
    'Handle conflicting times and confirm the final appointment clearly.',
  ],
  appointment_cancel: [
    'Cancel an appointment after confirming identity, appointment time, and policy.',
    'Handle a last-minute cancellation and explain the next step.',
    'Cancel or change a clinic visit without losing patient context.',
  ],
  fraud_dispute: [
    'Handle an unrecognized charge while verifying identity and escalating safely.',
    'Start a fraud dispute without exposing unsafe account details.',
    'Calm a worried caller and confirm the dispute next step.',
  ],
  account_verification: [
    'Find the right customer record when lookup details are missing or duplicated.',
    'Verify identity before sharing or changing account information.',
    'Resolve an account lookup mismatch with a safe clarification step.',
  ],
  outage: [
    'Explain outage status, restoration expectations, and credit eligibility clearly.',
    'Handle a frustrated outage caller without guessing an ETA.',
    'Check service status and confirm the next support step.',
  ],
  plan_upgrade: [
    'Explain plan options, pricing, and confirmation steps before making a change.',
    'Handle a plan upgrade request with clear pricing readback.',
    'Confirm the customer understands the plan change before saving it.',
  ],
  bill_payment: [
    'Help with a bill payment while confirming amount, due date, and next step.',
    'Resolve payment confusion without collecting unsafe information.',
    'Handle a past-due bill question with a clear action path.',
  ],
  policy_conflict: [
    'Resolve a policy conflict and escalate when the requested action is blocked.',
    'Explain the applicable policy without contradicting the knowledge base.',
    'Handle conflicting information and ask one clarifying question.',
  ],
  general_support: [
    'Resolve the customer issue, verify critical details, and confirm the next step.',
    'Handle a support request with missing information and a safe escalation path.',
    'Keep the call focused while collecting the details needed to proceed.',
  ],
};

const openingTemplates: Record<ScenarioFamily, string[]> = {
  email_capture: [
    'Hi, I need to update my email. It is {email_spoken}. Please read it back before you save it.',
    'I think my email is wrong on the account. The correct one is {email_spoken}.',
    'Can you change my email to {email_spoken}? I want to make sure you got every character.',
  ],
  phone_capture: [
    'I need to update my callback number to {phone_spoken}. Please confirm it back to me.',
    'The phone number on my account is wrong. It should be {phone_spoken}.',
    'Can you save this number for me: {phone_spoken}? I may repeat it if needed.',
  ],
  cancel_order: [
    'Hi, I need to cancel my order. I am worried it may already be processing.',
    'I placed an order by mistake and need help cancelling it before it ships.',
    'Can you cancel my order and tell me if there is any fee?',
  ],
  change_order: [
    'I need to change something on my order before it goes out.',
    'The order details are wrong and I need someone to update them.',
    'Can you help me correct my order and confirm the final details?',
  ],
  refund: [
    'I need a refund because the order did not arrive the way it was promised.',
    'I am calling about a refund, and I need a clear answer on what happens next.',
    'The item has an issue and I want to know if I can get my money back.',
  ],
  delivery: [
    'I need help with a delivery that has not arrived yet.',
    'My package status is confusing and I need an update.',
    'Can you check what is happening with my delivery and what I should do next?',
  ],
  invoice: [
    'I need help finding an invoice for my account.',
    'There is something wrong on my invoice and I need it checked.',
    'Can you explain the invoice and confirm what I owe?',
  ],
  payment: [
    'My payment did not go through and I need help fixing it.',
    'I am trying to pay, but the card keeps failing.',
    'Can you help me understand why the payment was not accepted?',
  ],
  appointment_booking: [
    'I need to book an appointment and I am hoping there is something available soon.',
    'Can you help me find the earliest appointment that works?',
    'I need an appointment with the right department and want to confirm the time.',
  ],
  appointment_reschedule: [
    'I need to reschedule my appointment, but I am confused about the available times.',
    'Can you move my appointment and make sure it does not overlap with another one?',
    'I need a different appointment slot and want the new time confirmed clearly.',
  ],
  appointment_cancel: [
    'I need to cancel my appointment and understand what happens next.',
    'Can you help me cancel my visit? I do not want to be marked as a no-show.',
    'I need to change or cancel an appointment that is coming up soon.',
  ],
  fraud_dispute: [
    'I see a charge I do not recognize, and I am worried my card was used.',
    'There is a suspicious transaction on my account and I need help now.',
    'Can you help me dispute a card charge I did not make?',
  ],
  account_verification: [
    'I am trying to access my account, but the details are not matching.',
    'Can you find my account? I may have more than one record.',
    'I need help verifying my account before we make any changes.',
  ],
  outage: [
    'My internet is down and I need to know when it will be fixed.',
    'I have had an outage all day and want to know if I qualify for a credit.',
    'Can you check my service status and give me the next step?',
  ],
  plan_upgrade: [
    'I want to upgrade my plan, but I need the price and terms confirmed first.',
    'Can you explain the upgrade options and what changes on my bill?',
    'I need more data, but I do not want surprises on the next invoice.',
  ],
  bill_payment: [
    'I need help paying my bill and confirming the amount due.',
    'I am confused about my bill and need to know what I should pay.',
    'Can you help me make a payment and confirm it went through?',
  ],
  policy_conflict: [
    'I got two different answers about the policy and need someone to clarify it.',
    'The policy does not seem to match my situation. Can you explain what applies?',
    'I need help because the answer I received earlier conflicts with what I was told today.',
  ],
  general_support: [
    'Hi, I need help with an issue on my account.',
    'I am not sure what information you need, but I need this resolved.',
    'Can you help me figure out the next step?',
  ],
};

function textForSeed(seed: DatasetScenarioSeed) {
  return `${seed.intent} ${seed.domain} ${seed.goal} ${seed.openingLine} ${seed.expectedOutcome}`.toLowerCase();
}

function scenarioFamily(seed: DatasetScenarioSeed): ScenarioFamily {
  const text = textForSeed(seed);
  if (text.includes('email') || text.includes('@')) return 'email_capture';
  if (
    text.includes('phone') ||
    text.includes('callback') ||
    text.includes('mobile') ||
    text.includes('contact number')
  ) {
    return 'phone_capture';
  }
  if (text.includes('reschedul')) return 'appointment_reschedule';
  if (text.includes('appointment') && text.includes('cancel')) return 'appointment_cancel';
  if (text.includes('appointment') || text.includes('clinic') || text.includes('booking')) return 'appointment_booking';
  if (text.includes('fraud') || text.includes('dispute') || text.includes('suspicious') || text.includes('charge')) return 'fraud_dispute';
  if (text.includes('cancel') && text.includes('order')) return 'cancel_order';
  if (text.includes('change') && text.includes('order')) return 'change_order';
  if (text.includes('refund') || text.includes('return')) return 'refund';
  if (text.includes('delivery') || text.includes('shipping') || text.includes('package')) return 'delivery';
  if (text.includes('invoice')) return 'invoice';
  if (text.includes('payment') || text.includes('card') || text.includes('authorization')) return 'payment';
  if (text.includes('outage') || text.includes('internet') || text.includes('service down')) return 'outage';
  if (text.includes('upgrade') || text.includes('plan')) return 'plan_upgrade';
  if (text.includes('bill')) return 'bill_payment';
  if (text.includes('verify') || text.includes('lookup') || text.includes('duplicate') || text.includes('account')) return 'account_verification';
  if (text.includes('policy') || text.includes('escalat')) return 'policy_conflict';
  return 'general_support';
}

function variantIndex(seed: DatasetScenarioSeed, index: number, count: number) {
  return Math.abs(fnvHex(`${seed.id}:${seed.intent}:${index}`, index).charCodeAt(0) + index) % count;
}

function replaceEntities(value: string) {
  return value
    .replace('{email_spoken}', 'john dot smith at gmail dot com')
    .replace('{phone_spoken}', 'plus one, two one six, four seven four, eight three four one');
}

function naturalizeRawText(value: string) {
  const cleaned = value
    .replace(/\bbloody\b/gi, '')
    .replace(/\boorder\b/gi, 'order')
    .replace(/\bpuchase\b/gi, 'purchase')
    .replace(/\bsample\s+(order|invoice|ticket|account)\s+number\b/gi, 'the account')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/[.!?]*$/, '.');
}

function emotionLead(emotion: string) {
  if (['angry', 'irate'].includes(emotion)) return 'I am really frustrated. ';
  if (emotion === 'frustrated') return 'I have been trying to get this resolved. ';
  if (emotion === 'urgent') return 'I need this handled today. ';
  if (emotion === 'nervous') return 'I am worried I may make a mistake. ';
  if (emotion === 'confused') return 'I am a bit confused. ';
  return '';
}

function polishScenarioCopy(seed: DatasetScenarioSeed, index: number) {
  const family = scenarioFamily(seed);
  const nameList = nameVariants[family];
  const goalList = goalTemplates[family];
  const openingList = openingTemplates[family];
  const name = nameList[variantIndex(seed, index, nameList.length)];
  const goal = goalList[variantIndex(seed, index + 7, goalList.length)];
  const templatedOpening = replaceEntities(openingList[variantIndex(seed, index + 13, openingList.length)]);
  const rawOpening = naturalizeRawText(seed.openingLine || seed.goal);
  const lead = emotionLead(seed.emotion);
  const openingBase = templatedOpening || rawOpening;
  const naturalOpening = lead ? openingBase.replace(/^hi,\s*/i, '') : openingBase;
  const openingLine = `${lead}${naturalOpening}`.trim();

  return {
    family,
    name,
    goal,
    openingLine,
    expectedOutcome: goal.replace(/\.$/, ''),
  };
}

function domainForFamily(domain: string, family: ScenarioFamily) {
  if (['cancel_order', 'change_order', 'refund', 'delivery'].includes(family)) return 'ecommerce';
  if (['appointment_booking', 'appointment_reschedule', 'appointment_cancel'].includes(family)) return 'healthcare';
  if (['outage', 'plan_upgrade'].includes(family)) return 'telecom';
  if (['fraud_dispute', 'account_verification'].includes(family)) return 'banking';
  if (family === 'payment' && !['ecommerce', 'banking'].includes(domain)) return 'banking';
  return domain;
}

export function scenarioPatternKey(scenario: Pick<LibraryScenario, 'name' | 'domain' | 'persona'>) {
  const text = `${scenario.name} ${scenario.domain} ${scenario.persona?.goal ?? ''} ${scenario.persona?.opening_line ?? ''}`.toLowerCase();
  if (text.includes('email')) return 'email_capture';
  if (text.includes('phone') || text.includes('callback')) return 'phone_capture';
  if (text.includes('reschedule') || text.includes('timezone')) return 'appointment_reschedule';
  if (text.includes('appointment') || text.includes('clinic')) return 'appointment_booking';
  if (text.includes('fraud') || text.includes('dispute') || text.includes('suspicious')) return 'fraud_dispute';
  if (text.includes('cancel') && text.includes('order')) return 'cancel_order';
  if (text.includes('refund')) return 'refund';
  if (text.includes('delivery') || text.includes('shipping') || text.includes('package')) return 'delivery';
  if (text.includes('payment') || text.includes('card') || text.includes('authorization')) return 'payment';
  if (text.includes('outage') || text.includes('internet')) return 'outage';
  if (text.includes('plan') || text.includes('upgrade')) return 'plan_upgrade';
  if (text.includes('policy') || text.includes('escalation')) return 'policy_conflict';
  return 'general_support';
}

function personaName(domain: string, index: number) {
  const names = personaNames[domain] ?? personaNames.general;
  return names[index % names.length];
}

function fnvHex(value: string, seed: number) {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deterministicUuid(value: string) {
  const hex = [
    fnvHex(`${value}:0`, 0x811c9dc5),
    fnvHex(`${value}:1`, 0x27d4eb2d),
    fnvHex(`${value}:2`, 0x85ebca6b),
    fnvHex(`${value}:3`, 0xc2b2ae35),
  ].join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function interleaveScenarioLibrary(items: LibraryScenario[]) {
  const buckets = new Map<string, LibraryScenario[]>();
  items.forEach((scenario) => {
    const key = `${scenario.domain}:${scenarioPatternKey(scenario)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), scenario]);
  });

  const keys = Array.from(buckets.keys()).sort();
  const interleaved: LibraryScenario[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    keys.forEach((key) => {
      const bucket = buckets.get(key);
      const next = bucket?.shift();
      if (next) {
        interleaved.push(next);
        remaining = true;
      }
    });
  }
  return interleaved;
}

const GENERATED_SCENARIO_LIBRARY: LibraryScenario[] = (importedSeeds as DatasetScenarioSeed[]).map((seed, index) => {
  const scenario = seedToScenario(seed);
  const polished = polishScenarioCopy(seed, index);
  const domain = domainForFamily(scenario.domain, polished.family);
  return {
    id: deterministicUuid(`lightcurve:${seed.id}:${seed.intent}:${index}`),
    name: polished.name,
    language: scenario.language,
    domain,
    persona: {
      name: personaName(domain, index),
      age: 28 + (index % 33),
      accent: scenario.persona.accent,
      emotional_state: scenario.persona.emotional_state,
      goal: polished.goal,
      noise_db: scenario.persona.noise_db,
      speed_wpm: scenario.persona.speed_wpm,
      interrupts: scenario.persona.interrupts,
      opening_line: polished.openingLine,
      code_switching: scenario.persona.code_switching,
    },
    successCriteria: [
      { type: 'task_completed', description: polished.expectedOutcome, weight: 0.5 },
      { type: 'safe_policy', description: 'Uses only scenario facts and asks one clarifying question when details are missing.', weight: 0.2 },
      { type: 'tone_match', description: `Keeps a steady, helpful tone with a ${scenario.persona.emotional_state} caller.`, weight: 0.15 },
      { type: 'confirmation', description: 'Confirms the final next step before ending the call.', weight: 0.15 },
    ],
    callerSeed: 1000 + index,
    isPreset: true,
    source: {
      provider: seed.source.provider,
      dataset: seed.source.dataset,
    },
  };
});

export const REAL_SCENARIO_LIBRARY: LibraryScenario[] = interleaveScenarioLibrary(GENERATED_SCENARIO_LIBRARY);

export function mergeWithRealScenarioLibrary(stored: LibraryScenario[] | undefined | null) {
  const storedItems = stored ?? [];
  const customItems = storedItems.filter((scenario) => {
    return !scenario.isPreset || scenario.id.startsWith('custom-') || scenario.id.startsWith('dataset-');
  });
  const dedupedCustomItems = customItems.filter((scenario, index, items) => {
    return items.findIndex((candidate) => candidate.id === scenario.id) === index;
  });
  const customIds = new Set(dedupedCustomItems.map((scenario) => scenario.id));
  return [
    ...dedupedCustomItems,
    ...REAL_SCENARIO_LIBRARY.filter((scenario) => !customIds.has(scenario.id)),
  ];
}
