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
/** How many PCs one license covers — the customer picks any whole number 1–50. */
export type PcCount = number;
export const PC_MIN = 1;
export const PC_MAX = 50;

export interface ModelOption {
  id: ModelId;
  label: string;
  note: string;
}

export interface VolumeTier {
  /** Minimum PC count for this tier. */
  min: number;
  /** Per-PC price multiplier at this tier. */
  multiplier: number;
  /** Percent off per PC (display only). */
  offPct: number;
  /** Human label, '' when no discount. */
  label: string;
}

/**
 * Volume ladder — bigger PC counts cost less per PC. The old fixed
 * "5 PC = 3× list" deal is preserved exactly (5 × 0.6 = 3).
 * Ordered best-tier-first; pick the first tier whose min the count reaches.
 */
export const VOLUME_TIERS: VolumeTier[] = [
  { min: 10, multiplier: 0.5, offPct: 50, label: '50% off per PC' },
  { min: 5, multiplier: 0.6, offPct: 40, label: '40% off per PC' },
  { min: 2, multiplier: 0.8, offPct: 20, label: '20% off per PC' },
  { min: 1, multiplier: 1, offPct: 0, label: '' },
];

export function volumeTier(pcs: number): VolumeTier {
  const n = Math.max(PC_MIN, Math.floor(pcs || PC_MIN));
  return VOLUME_TIERS.find((t) => n >= t.min) ?? VOLUME_TIERS[VOLUME_TIERS.length - 1];
}

/** Next better volume tier above `pcs`, if any (for “add N more…” hints). */
export function nextVolumeTier(pcs: number): VolumeTier | undefined {
  const current = volumeTier(pcs);
  return VOLUME_TIERS.find((t) => t.min > current.min);
}

export function pcAllowedForModel(model: ModelId, pcs: number): boolean {
  if (!Number.isInteger(pcs) || pcs < PC_MIN || pcs > PC_MAX) return false;
  return model === 'trial' ? pcs === 1 : true;
}

export function pcLabel(pcs: number): string {
  return `${pcs} PC${pcs === 1 ? '' : 's'}`;
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

/** PCs allowed per model — trials are always exactly 1 PC. */
export function seatsAllowedForModel(model: ModelId): PcCount[] {
  return model === 'trial' ? [1] : [
    ...Array.from({ length: PC_MAX - PC_MIN + 1 }, (_, i) => i + PC_MIN),
  ];
}

/** Effective per-PC price after launch offer + volume tier (whole USD). */
export function perPcPrice(product: Product, model: ModelId, pcs: number): number {
  const tier = volumeTier(pcs);
  let eff = product.prices[model] ?? 0;
  if (LAUNCH_OFFER.active) {
    const launch = product.launchPrices?.[model];
    if (typeof launch === 'number') eff = launch;
  }
  return Math.round(eff * tier.multiplier);
}

/** Price with NO promotion applied, for the whole license (per-PC list × PCs). */
export function listPrice(product: Product, model: ModelId, pcs: number): number {
  const base = product.prices[model] ?? 0;
  return Math.round(base * Math.max(PC_MIN, pcs || PC_MIN));
}

/** Total price for one license line (per-PC effective × PCs). */
export function unitPrice(product: Product, model: ModelId, pcs: number): number {
  return perPcPrice(product, model, pcs) * Math.max(PC_MIN, pcs || PC_MIN);
}

/** Percent off the per-PC list price (launch offer + volume combined; 0 when none). */
export function discountPercent(product: Product, model: ModelId, pcs: number): number {
  const base = product.prices[model] ?? 0;
  if (base <= 0) return 0;
  const eff = perPcPrice(product, model, pcs);
  if (eff >= base) return 0;
  return Math.round((1 - eff / base) * 100);
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
