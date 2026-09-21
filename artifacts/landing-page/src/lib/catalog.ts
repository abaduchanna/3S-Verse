/**
 * Dealer Tools catalog — single source of truth for the license store.
 *
 * Used by BOTH the storefront UI (src/components/DealerStore.tsx) and the
 * serverless order API (netlify/functions/order.mts), so the server always
 * recomputes prices from this file and never trusts client-sent amounts.
 *
 * All prices in USD. Edit prices here and redeploy — nothing else to touch.
 */

export type ModelId = 'trial' | 'lifetime';
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
  /** Regular (list) price per model in whole USD. */
  prices: Record<ModelId, number>;
  /** Launch-offer price per model in whole USD (optional — falls back to list). */
  launchPrices?: Partial<Record<ModelId, number>>;
}

/**
 * Launch offer — site-wide introductory discount. Flip `active` to false to
 * end the promotion; UI and emails fall back to list prices automatically.
 */
export const LAUNCH_OFFER = {
  active: true,
  label: 'Launch Offer',
  note: 'Launch pricing for the first 50 dealers — after that, list price.',
} as const;

/**
 * Free-trial download pack. Paste a Google Drive FOLDER link here (folder,
 * not file — folder links never change, so you can swap in a newer build
 * zip whenever you want without touching the site again). Share the folder
 * as "Anyone with the link — Viewer". Leave url as '' to hide every
 * trial-download button on the storefront.
 */
export const TRIAL_DOWNLOAD = {
  url: '',
  label: 'Download trial pack (.zip)',
  note: 'Windows 10/11 · all trial tools · activation key arrives by email',
} as const;

export const MODELS: ModelOption[] = [
  { id: 'trial', label: '7-Day Free Trial', note: 'Full features, 7 days, 1 PC — no card needed' },
  { id: 'lifetime', label: 'Lifetime', note: 'Pay once — yours forever, updates included. No subscription, ever.' },
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
    prices: { trial: 0, lifetime: 1499 },
    launchPrices: { trial: 0, lifetime: 899 },
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
    prices: { trial: 0, lifetime: 1799 },
    launchPrices: { trial: 0, lifetime: 999 },
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
    prices: { trial: 0, lifetime: 1999 },
    launchPrices: { trial: 0, lifetime: 1199 },
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
    prices: { trial: 0, lifetime: 3000 },
    launchPrices: { trial: 0, lifetime: 1499 },
  },
];

/** Seats allowed per model — trials are always single-PC. */
export function seatsAllowedForModel(model: ModelId): SeatsId[] {
  return model === 'trial' ? ['1pc'] : SEATS.map((s) => s.id);
}

/** Price with NO promotion applied (used for the struck-through list price). */
export function listPrice(product: Product, model: ModelId, seats: SeatsId): number {
  const base = product.prices[model] ?? 0;
  const seat = SEATS.find((s) => s.id === seats);
  return Math.round(base * (seat?.multiplier ?? 1));
}

export function unitPrice(product: Product, model: ModelId, seats: SeatsId): number {
  const seat = SEATS.find((s) => s.id === seats);
  const multiplier = seat?.multiplier ?? 1;
  if (LAUNCH_OFFER.active) {
    const launch = product.launchPrices?.[model];
    if (typeof launch === 'number') return Math.round(launch * multiplier);
  }
  const base = product.prices[model] ?? 0;
  return Math.round(base * multiplier);
}

/** Percent off the list price for the current promotion (0 when none). */
export function discountPercent(product: Product, model: ModelId, seats: SeatsId): number {
  const list = listPrice(product, model, seats);
  const unit = unitPrice(product, model, seats);
  if (list <= 0 || unit >= list) return 0;
  return Math.round((1 - unit / list) * 100);
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
