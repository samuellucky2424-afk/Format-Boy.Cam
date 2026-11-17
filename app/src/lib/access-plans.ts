export interface AccessPlanView {
  id: string;
  name: string;
  priceUSD: number;
  priceNGN: number;
  durationDays: number | null;
  planCode: string | null;
}

export function accessLabel(durationDays: number | null | undefined, planCode?: string | null): string {
  if (planCode === 'unlimited' || durationDays == null) return 'Unlimited, no expiry';
  if (durationDays === 14) return '14 days access';
  if (durationDays === 30) return '30 days access';
  return `${durationDays} days access`;
}

export function formatPlanPrice(plan: { priceUSD: number; priceNGN: number }): string {
  if (plan.priceUSD > 0) return `$${plan.priceUSD.toLocaleString()}`;
  return `₦${plan.priceNGN.toLocaleString()}`;
}
