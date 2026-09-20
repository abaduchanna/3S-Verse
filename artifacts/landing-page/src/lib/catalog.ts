/**
 * Dealer Tools catalog — single source of truth for the license store.
 *
 * Used by BOTH the storefront UI (src/components/DealerStore.tsx) and the
 * serverless order API (netlify/functions/order.mts), so the server always
 * recomputes prices from this file and never trusts client-sent amounts.
 *
 * All prices in USD. Edit prices here and redeploy — nothing else to touch.
 */

export type ModelId = 'trial' | '1y' | 'lifetime';
export type SeatsId = '1pc' | '5pc';

export interface ModelOption {
  id: ModelId;
  label: string;
  note: string;
}

export interface SeatsOption {
  id: SeatsId;
  label: string;
  multiplier: number;
}

export interface Product {
  id: string;
  name: string;
  tagline: string;
  features: string[];
  /** Price per model in whole USD. */
  prices: Record<ModelId, number>;
}

export const MODELS: ModelOption[] = [
  { id: 'trial', label: '7-Day Trial', note: 'Full features, 7 days, 1 PC' },
  { id: '1y', label: '1 Year', note: '12 months of updates included' },
  { id: 'lifetime', label: 'Lifetime', note: 'Yours forever, updates included' },
];

export const SEATS: SeatsOption[] = [
  { id: '1pc', label: '1 PC', multiplier: 1 },
  { id: '5pc', label: '5 PCs', multiplier: 3 },
];

export const PRODUCTS: Product[] = [
  {
    id: 'extractor',
    name: 'VidaPay Incentive Extractor',
    tagline: 'IMEI-level incentive & activation extraction, store by store.',
    features: [
      'Per-store incentive dashboards in one run',
      'IMEI + activation detail export',
      'One-click Excel workbook output',
      'Human-verification handled automatically',
    ],
    prices: { trial: 0, '1y': 59, lifetime: 99 },
  },
  {
    id: 'ordering',
    name: 'VidaPay Device Ordering',
    tagline: 'Guided device ordering with store login management.',
    features: [
      'Store-by-store ordering flow',
      'Built-in store login manager',
      'Automatic human-verification handling',
      'Runs on a second screen, unattended',
    ],
    prices: { trial: 0, '1y': 79, lifetime: 149 },
  },
  {
    id: 'rebate',
    name: 'VidaPay Rebate Filing',
    tagline: 'Bulk rebate claim filing with per-claim status tracking.',
    features: [
      'Bulk claim filing from Excel',
      'Claim templates + validation',
      'Store login management built in',
      'Per-claim status tracking',
    ],
    prices: { trial: 0, '1y': 99, lifetime: 199 },
  },
  {
    id: 'bundle',
    name: 'VidaPay Full Bundle',
    tagline: 'All three tools. One license. Best value.',
    features: [
      'Extractor + Ordering + Rebate Filing',
      'One license covers every tool',
      'Priority support',
      'Everything the dealership needs',
    ],
    prices: { trial: 0, '1y': 179, lifetime: 349 },
  },
];

/** Seats allowed per model — trials are always single-PC. */
export function seatsAllowedForModel(model: ModelId): SeatsId[] {
  return model === 'trial' ? ['1pc'] : SEATS.map((s) => s.id);
}

export function unitPrice(product: Product, model: ModelId, seats: SeatsId): number {
  const base = product.prices[model] ?? 0;
  const seat = SEATS.find((s) => s.id === seats);
  return Math.round(base * (seat?.multiplier ?? 1));
}

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}
