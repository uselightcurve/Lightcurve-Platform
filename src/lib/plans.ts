export type PlanId = 'starter' | 'pro' | 'scale';

export type Plan = {
  id: PlanId;
  name: string;
  audience: string;
  priceLabel: string;
  monthlyCents: number;
  minutesLimit: number | null;
  actionsLimit: number | null;
  importsEnabled: boolean;
  overageEnabled: boolean;
  minuteOverageCents: number;
  actionOverageCentsPerThousand: number;
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    audience: 'Free version',
    priceLabel: '$0/mo',
    monthlyCents: 0,
    minutesLimit: 60,
    actionsLimit: 10000,
    importsEnabled: false,
    overageEnabled: false,
    minuteOverageCents: 0,
    actionOverageCentsPerThousand: 0,
    features: ['60 sandbox minutes', '10,000 eval actions', 'Small production import cap'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    audience: 'Growing teams',
    priceLabel: '$99/mo',
    monthlyCents: 9900,
    minutesLimit: 1000,
    actionsLimit: 50000,
    importsEnabled: true,
    overageEnabled: true,
    minuteOverageCents: 4,
    actionOverageCentsPerThousand: 50,
    features: ['1,000 tested minutes', '50,000 eval actions', 'Production call imports', 'Paid overage after included usage'],
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    audience: 'Enterprise clients',
    priceLabel: 'Custom',
    monthlyCents: 0,
    minutesLimit: null,
    actionsLimit: null,
    importsEnabled: true,
    overageEnabled: false,
    minuteOverageCents: 0,
    actionOverageCentsPerThousand: 0,
    features: ['Unlimited sandbox minutes', 'Unlimited eval actions', 'SLA and priority support'],
  },
};

export function normalizePlan(plan: unknown): PlanId {
  return plan === 'pro' || plan === 'scale' ? plan : 'starter';
}

export function planFor(plan: unknown) {
  return PLANS[normalizePlan(plan)];
}
