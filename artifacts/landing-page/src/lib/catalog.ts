/**
 * Dealer Tools catalog — single source of truth for the license store.
 *
 * Used by BOTH the storefront UI (src/components/DealerStore.tsx) and the
 * serverless order API (netlify/functions/order.mts), so the server always
 * recomputes prices from this file and never trusts client-sent amounts.
 *
 * All prices in USD. Edit prices here and redeploy — nothing else to touch.
 */

export type ModelId = 'trial' | 'monthly' | 'annual' | 'lifetime';
/** How many PCs one license covers — self-serve picks 1–9 (audit F09:
 *  10+ PCs move to the district-quote flow: message us for pricing). */
export type PcCount = number;
export const PC_MIN = 1;
export const PC_MAX = 9;

/** Suffix shown after a price for recurring models — '' for one-time. */
export function modelPriceSuffix(model: ModelId): string {
  if (model === 'monthly') return '/mo';
  if (model === 'annual') return '/yr';
  return '';
}

/** Per-model billing explanation shown under the price in the store. */
export function modelBillingNote(model: ModelId): string {
  switch (model) {
    case 'monthly':
      return 'per month · cancel anytime';
    case 'annual':
      return 'per year · save 44% vs monthly';
    case 'lifetime':
      return 'one-time payment · yours forever';
    default:
      return '7 days · 1 PC · no card needed';
  }
}

/** True for models that renew (shown on invoices + emails). */
export function isRecurringModel(model: ModelId): boolean {
  return model === 'monthly' || model === 'annual';
}

/**
 * Per-PC licensing, explained (audit: per-PC pricing can feel punitive
 * unless the site explains why it exists). Shown next to the PC picker.
 */
export const PER_PC_NOTE =
  'One PC can run every store you operate — most single-PC dealers need exactly one license. '
  + 'Extra PCs are for extra workstations (a second office, a colleague\u2019s desk): each seat is a separate '
  + 'activation with its own license key, support and updates, so volume discounts apply per PC instead.';

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
 * Volume ladder — bigger PC counts cost less per PC (audit F09: shallower
 * tiers so deep discounts are reserved for annual/district contracts; 10+
 * PCs are quoted through the district flow instead of self-serve).
 * Ordered best-tier-first; pick the first tier whose min the count reaches.
 */
export const VOLUME_TIERS: VolumeTier[] = [
  { min: 5, multiplier: 0.8, offPct: 20, label: '20% off per PC' },
  { min: 2, multiplier: 0.9, offPct: 10, label: '10% off per PC' },
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
 * Launch offer — site-wide introductory discount with a REAL, enforced end
 * condition (audit: scarcity must be tied to an enforced deadline — no
 * fabricated "X of Y left" counters; the countdown counts to the fixed
 * cutoff below and list prices return automatically). Flip `active` to
 * false to end the promotion early.
 */
export const LAUNCH_OFFER = {
  active: true,
  label: 'Launch Offer',
  note: 'Launch pricing ends Oct 31, 2026 — honored to the minute. List prices return Nov 1, no extension.',
  /** ISO deadline for launch pricing — the storefront counts down to it.
   *  Flip `active` to false (or clear endsAt) when the promo ends. */
  endsAt: '2026-10-31T23:59:59-05:00',
} as const;

/**
 * WhatsApp float button — paste the number in international format with no
 * +, spaces or dashes (e.g. '923001234567'). Leave '' to hide the button.
 */
export const WHATSAPP_NUMBER = '';
export const WHATSAPP_GREETING =
  'Hi 3S Verse — I have a question about the VidaPay dealer tools.';

export function whatsappLink(): string | null {
  if (!WHATSAPP_NUMBER) return null;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_GREETING)}`;
}

/**
 * Product demo video — paste a YouTube embed URL (https://www.youtube.com/embed/VIDEO_ID)
 * or a Loom share link after recording the walkthrough. Leave '' to show the
 * "demo dropping soon" placeholder instead of an iframe.
 */
export const VIDEO_DEMO = {
  url: '',
  kicker: 'See it before you buy it',
  title: 'Watch the tools work.',
  note: 'Raw screen recordings — portal in, clean Excel out. No production polish, because the tools are the point.',
} as const;

/** Optional YouTube channel link — hidden from the UI while ''. */
export const YOUTUBE_URL = '';

/**
 * Free-trial downloads — served from the PUBLIC 3sverse-downloads repo,
 * which auto-syncs the newest 7-day trial build of each tool every 4 hours
 * (github.com/abaduchanna/3sverse-downloads → releases/latest). These are
 * versionless URLs: the same link always delivers the newest build, so
 * trial users and paid customers re-downloading updates never need a new
 * link. ONLY trial builds live in that public repo; FULL (paid) builds
 * stay in the private build repos and are delivered through the
 * order-number gateway (see PAID_DOWNLOAD below).
 */
const TRIAL_BASE =
  'https://github.com/abaduchanna/3sverse-downloads/releases/latest/download/';

export const TRIAL_DOWNLOADS: Record<string, string> = {
  extractor: `${TRIAL_BASE}VidaPay_Incentive_Extractor_TRIAL.exe`,
  ordering: `${TRIAL_BASE}VidaPay_Device_Ordering_TRIAL.exe`,
  rebate: `${TRIAL_BASE}VidaPay_Rebate_Filing_TRIAL.exe`,
  /* Bundle trial → the branded download page lists all three trial
     installers with live SHA-256 checksums. */
  bundle: '/#/download',
};

/** Versionless trial download URL for a product ('' hides its button). */
export function trialDownloadUrl(productId: string): string {
  return TRIAL_DOWNLOADS[productId] ?? '';
}

export const TRIAL_DOWNLOAD = {
  label: 'Download free trial (.exe)',
  note: 'Windows 10/11 · 7-day trial · license key arrives by email',
} as const;

/**
 * Paid-customer download gateway (FULL builds) — LIVE.
 * Cloudflare Worker: https://3sverse-downloads.abaduchanna.workers.dev
 * (source + setup guide: 3sverse-download-gateway/README.md). The worker
 * checks the customer's order number against the license ledger
 * (vidapay-license-server → ledger/orders.json) and only then serves the
 * private FULL build — so paid builds are never publicly downloadable.
 * If gatewayUrl is ever emptied, the storefront falls back to a request
 * box instead of the automatic download (audit F04).
 */
export const PAID_DOWNLOAD = {
  gatewayUrl: 'https://3sverse-downloads.abaduchanna.workers.dev/download',
  label: 'Download your licensed software',
  note: 'Enter the order number from your invoice (3SV-…).',
  contactEmail: 'Connect@3SVerse.com',
} as const;

export const MODELS: ModelOption[] = [
  { id: 'trial', label: '7-Day Free Trial', note: 'Full features, 7 days, 1 PC — no card needed' },
  { id: 'monthly', label: 'Monthly', note: '$89/mo per tool — cancel anytime' },
  { id: 'annual', label: 'Annual', note: 'Save 44% vs monthly — every update included' },
  { id: 'lifetime', label: 'Lifetime', note: 'Founding-customer launch price — pay once, yours forever, every update included.' },
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
      'Runs under your own dealer login — portal security checks stay user-controlled',
    ],
    prices: { trial: 0, monthly: 89, annual: 599, lifetime: 1299 },
    launchPrices: { trial: 0, lifetime: 899 },
  },
  {
    id: 'ordering',
    name: 'VidaPay Device Ordering',
    tagline: 'Guided device ordering with store login management.',
    features: [
      'Store-by-store ordering flow',
      'Built-in store login manager',
      'Portal verification steps pause for your approval — nothing bypasses you',
      'Runs on a second screen with limited supervision',
    ],
    prices: { trial: 0, monthly: 89, annual: 599, lifetime: 1499 },
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
    prices: { trial: 0, monthly: 89, annual: 699, lifetime: 1699 },
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
      'All three 3SVerse VidaPay workflow tools under one license',
    ],
    prices: { trial: 0, monthly: 149, annual: 999, lifetime: 2499 },
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

/**
 * VERIFIED REVIEWS — how this works (audit fix: anonymous testimonials kill
 * trust, so the site ships with ZERO invented reviews).
 *
 * 1. A dealer submits the review form on the site (#reviews).
 * 2. The submission lands in the Connect@3SVerse.com inbox
 *    (subject: "New dealer review — ...").
 * 3. Verify the person against your license records, then — and only then —
 *    add an entry below and redeploy. It appears on the site instantly.
 *
 * Publish the reviewer's FIRST NAME + store/city at minimum (audit: named
 * reviews are 3x more persuasive; anonymous ones read as fabricated).
 * Leave the array empty to keep the honest "no published reviews yet" state.
 */
export interface DealerReview {
  /** The review text, as the dealer wrote it (lightly formatted is fine). */
  quote: string;
  /** First name + last initial, e.g. 'John D.' */
  name: string;
  /** Store/city line, e.g. 'Total Wireless dealer · Houston, TX' */
  org: string;
  /** Two-letter avatar, e.g. 'JD' */
  initials: string;
  /** 1–5 stars the dealer gave. */
  stars: number;
  /** Month/year published, e.g. 'Oct 2026'. */
  date: string;
}

export const REVIEWS: DealerReview[] = [];
