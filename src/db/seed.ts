// Lightcurve — seed 15 preset call scenarios
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
const db = drizzle(pool, { schema });

const presets = [
  {
    "name": "angry_refund_en_us",
    "language": "en-US",
    "domain": "ecommerce",
    "persona": {
      "name": "Jake", "age": 34,
      "accent": "American", "emotional_state": "angry",
      "goal": "Get a full refund for a package that never arrived",
      "noise_db": 0, "speed_wpm": 160, "interrupts": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Refund initiated or clear next steps given", "weight": 0.5},
      {"type": "no_hallucination", "description": "Agent did not fabricate policy or timelines", "weight": 0.3},
      {"type": "tone_appropriate", "description": "Agent remained calm and empathetic", "weight": 0.2}
    ]
  },
  {
    "name": "order_cancel_en_us",
    "language": "en-US",
    "domain": "ecommerce",
    "persona": {
      "name": "Sarah", "age": 28,
      "accent": "American", "emotional_state": "calm",
      "goal": "Cancel order placed 10 minutes ago before it ships",
      "noise_db": 0, "speed_wpm": 140, "interrupts": false
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Order cancelled or told it cannot be cancelled with reason", "weight": 0.6},
      {"type": "no_hallucination", "description": "No fabricated order IDs or fake confirmations", "weight": 0.4}
    ]
  },
  {
    "name": "fraud_dispute_en_gb",
    "language": "en-GB",
    "domain": "banking",
    "persona": {
      "name": "James", "age": 45,
      "accent": "British", "emotional_state": "nervous",
      "goal": "Dispute a fraudulent £240 charge on my card",
      "noise_db": 0, "speed_wpm": 130, "interrupts": false
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Dispute filed or escalation path given", "weight": 0.5},
      {"type": "no_hallucination", "description": "No false guarantee of refund timeline", "weight": 0.3},
      {"type": "tone_appropriate", "description": "Reassuring tone for distressed customer", "weight": 0.2}
    ]
  },
  {
    "name": "appointment_reschedule_en_au",
    "language": "en-AU",
    "domain": "healthcare",
    "persona": {
      "name": "Emily", "age": 52,
      "accent": "Australian", "emotional_state": "confused",
      "goal": "Reschedule a dentist appointment from Thursday to next week",
      "noise_db": 5, "speed_wpm": 120, "interrupts": false
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Appointment rescheduled or alternatives given", "weight": 0.7},
      {"type": "tone_appropriate", "description": "Patient and clear with confused caller", "weight": 0.3}
    ]
  },
  {
    "name": "plan_upgrade_hi_in",
    "language": "hi-IN",
    "domain": "telecom",
    "persona": {
      "name": "Rahul", "age": 26,
      "accent": "Hindi", "emotional_state": "neutral",
      "goal": "Upgrade mobile plan to unlimited data, ask about cost in Hinglish",
      "noise_db": 5, "speed_wpm": 140, "interrupts": false,
      "code_switching": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Plan upgrade options explained clearly", "weight": 0.6},
      {"type": "no_hallucination", "description": "Correct pricing given, no made up offers", "weight": 0.4}
    ]
  },
  {
    "name": "return_denied_hi_in",
    "language": "hi-IN",
    "domain": "ecommerce",
    "persona": {
      "name": "Priya", "age": 31,
      "accent": "Hindi", "emotional_state": "angry",
      "goal": "Return request was denied unfairly, wants escalation to supervisor",
      "noise_db": 0, "speed_wpm": 155, "interrupts": true,
      "code_switching": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Escalated or return re-reviewed", "weight": 0.5},
      {"type": "escalation_avoided", "description": "Caller ended call without rage-quitting", "weight": 0.3},
      {"type": "tone_appropriate", "description": "Agent did not become defensive", "weight": 0.2}
    ]
  },
  {
    "name": "sim_activation_ta_in",
    "language": "ta-IN",
    "domain": "telecom",
    "persona": {
      "name": "Karthik", "age": 22,
      "accent": "Tamil", "emotional_state": "frustrated",
      "goal": "New SIM not activated after 24 hours, wants it fixed now",
      "noise_db": 10, "speed_wpm": 145, "interrupts": false,
      "code_switching": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Activation triggered or escalated to technical team", "weight": 0.6},
      {"type": "no_hallucination", "description": "No false activation time promises", "weight": 0.4}
    ]
  },
  {
    "name": "delivery_track_fr_fr",
    "language": "fr-FR",
    "domain": "ecommerce",
    "persona": {
      "name": "Marie", "age": 38,
      "accent": "French", "emotional_state": "calm",
      "goal": "Track delivery status of an order placed 3 days ago",
      "noise_db": 0, "speed_wpm": 130, "interrupts": false
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Tracking info or estimated delivery provided", "weight": 0.7},
      {"type": "no_hallucination", "description": "No fabricated tracking numbers", "weight": 0.3}
    ]
  },
  {
    "name": "balance_inquiry_de_de",
    "language": "de-DE",
    "domain": "banking",
    "persona": {
      "name": "Hans", "age": 55,
      "accent": "German", "emotional_state": "formal",
      "goal": "Check account balance and last 3 transactions formally",
      "noise_db": 0, "speed_wpm": 120, "interrupts": false
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Balance and transactions read back correctly", "weight": 0.6},
      {"type": "tone_appropriate", "description": "Formal register maintained throughout", "weight": 0.4}
    ]
  },
  {
    "name": "urgent_appointment_es_es",
    "language": "es-ES",
    "domain": "healthcare",
    "persona": {
      "name": "Carlos", "age": 41,
      "accent": "Spanish", "emotional_state": "urgent",
      "goal": "Book same-day emergency appointment for chest pain",
      "noise_db": 0, "speed_wpm": 160, "interrupts": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Appointment booked or 999/112 escalation offered", "weight": 0.6},
      {"type": "tone_appropriate", "description": "Urgency acknowledged, no unnecessary hold", "weight": 0.4}
    ]
  },
  {
    "name": "close_account_threat_en_us",
    "language": "en-US",
    "domain": "banking",
    "persona": {
      "name": "Mike", "age": 47,
      "accent": "American", "emotional_state": "irate",
      "goal": "Wrong charge appeared, threatening to close account if not reversed immediately",
      "noise_db": 0, "speed_wpm": 170, "interrupts": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Charge reviewed and reversal initiated or explained", "weight": 0.4},
      {"type": "escalation_avoided", "description": "Customer retained, did not close account", "weight": 0.4},
      {"type": "tone_appropriate", "description": "De-escalation techniques used", "weight": 0.2}
    ]
  },
  {
    "name": "elderly_ivr_confused_en_us",
    "language": "en-US",
    "domain": "telecom",
    "persona": {
      "name": "Dorothy", "age": 74,
      "accent": "American", "emotional_state": "confused",
      "goal": "Pay phone bill, got lost in IVR, needs human help",
      "noise_db": 5, "speed_wpm": 95, "interrupts": false
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Bill payment completed or guided step by step", "weight": 0.5},
      {"type": "tone_appropriate", "description": "Patient, slow, no jargon used", "weight": 0.5}
    ]
  },
  {
    "name": "kyc_query_hi_in",
    "language": "hi-IN",
    "domain": "banking",
    "persona": {
      "name": "Amit", "age": 33,
      "accent": "Hindi", "emotional_state": "neutral",
      "goal": "Ask which KYC documents needed to upgrade account, in Hinglish",
      "noise_db": 0, "speed_wpm": 135, "interrupts": false,
      "code_switching": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Correct document list provided", "weight": 0.6},
      {"type": "no_hallucination", "description": "No incorrect document requirements stated", "weight": 0.4}
    ]
  },
  {
    "name": "order_status_pt_br",
    "language": "pt-BR",
    "domain": "ecommerce",
    "persona": {
      "name": "Ana", "age": 29,
      "accent": "Brazilian", "emotional_state": "calm",
      "goal": "Check status of order placed 5 days ago, not yet received",
      "noise_db": 0, "speed_wpm": 135, "interrupts": false
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Status provided or investigation opened", "weight": 0.7},
      {"type": "no_hallucination", "description": "No invented delivery dates", "weight": 0.3}
    ]
  },
  {
    "name": "internet_outage_en_us",
    "language": "en-US",
    "domain": "telecom",
    "persona": {
      "name": "Kevin", "age": 36,
      "accent": "American", "emotional_state": "frustrated",
      "goal": "Internet down for 6 hours during work from home, demands credit and fix ETA",
      "noise_db": 0, "speed_wpm": 155, "interrupts": true
    },
    "successCriteria": [
      {"type": "task_completed", "description": "Fix ETA given and credit applied or promised", "weight": 0.5},
      {"type": "no_hallucination", "description": "No false restoration time guarantees", "weight": 0.3},
      {"type": "tone_appropriate", "description": "Empathy shown for work disruption", "weight": 0.2}
    ]
  }
];

async function main() {
  console.log('Seeding scenarios...');
  for (const preset of presets) {
    // Check if it already exists
    const existing = await db.select().from(schema.scenarios).where(eq(schema.scenarios.name, preset.name)).execute();
    
    // Using string literal or type casting to fix type issues just in case
    if (existing.length === 0) {
      await db.insert(schema.scenarios).values({
        ...preset,
        isPreset: true,
      } as any).execute();
    }
  }
  console.log('Done!');
  process.exit(0);
}

main().catch(console.error);
