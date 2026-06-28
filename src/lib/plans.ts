export type PlanId = 'starter' | 'pro' | 'scale';

export type Plan = {
  id: PlanId;
  name: string;
  audience: string;
  priceLabel: string;
  monthlyCents: number;
  minutesLimit: number | null;
  actionsLimit: number | null;
  fixesLimit: number | null;
  overageEnabled: boolean;
  minuteOverageCents: number;
  actionOverageCentsPerThousand: number;
  fixOverageCents: number;
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    audience: 'Free version',
    priceLabel: '$0',
    monthlyCents: 0,
    minutesLimit: 30,
    actionsLimit: 10000,
    fixesLimit: 50,
    overageEnabled: false,
    minuteOverageCents: 0,
    actionOverageCentsPerThousand: 0,
    fixOverageCents: 0,
    features: ['30 tested minutes', '10,000 eval actions', '50 AI generated fixes', 'Private human-grounded datasets'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    audience: 'Growing teams',
    priceLabel: '$249',
    monthlyCents: 24900,
    minutesLimit: 5000,
    actionsLimit: 100000,
    fixesLimit: 6000,
    overageEnabled: true,
    minuteOverageCents: 1,
    actionOverageCentsPerThousand: 100,
    fixOverageCents: 3,
    features: ['5,000 tested minutes', '100,000 eval actions', '6,000 AI generated fixes', 'Paid overage after included usage'],
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    audience: 'Enterprise clients',
    priceLabel: 'Custom',
    monthlyCents: 0,
    minutesLimit: null,
    actionsLimit: null,
    fixesLimit: null,
    overageEnabled: false,
    minuteOverageCents: 0,
    actionOverageCentsPerThousand: 0,
    fixOverageCents: 0,
    features: ['Unlimited sandbox minutes', 'Unlimited eval actions', 'Unlimited AI fixes', 'SLA and priority support'],
  },
};

export function normalizePlan(plan: unknown): PlanId {
  return plan === 'pro' || plan === 'scale' ? plan : 'starter';
}

export function planFor(plan: unknown) {
  return PLANS[normalizePlan(plan)];
}
