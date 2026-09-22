/**
 * Latest-build download links — single source of truth for every
 * "download the app" button on the site and in the order emails.
 *
 * SECURITY CONTRACT (mirrors the sync workflow in 3sverse-downloads):
 *   - TRIAL builds live in the PUBLIC mirror repo and are free for anyone:
 *       https://github.com/abaduchanna/3sverse-downloads/releases/latest/download/<TRIAL.exe>
 *     A scheduled action re-syncs the newest trial of each tool every few
 *     hours, so each URL below ALWAYS serves the newest build.
 *   - FULL (paid) builds stay in the PRIVATE build repos. They are served
 *     ONLY through the Cloudflare download gateway (PAID_DOWNLOAD.gatewayUrl),
 *     which validates the customer's order number against the license
 *     ledger before streaming anything. Never point a public URL at a FULL
 *     asset — the mirror repo no longer carries them.
 */

import { PAID_DOWNLOAD } from './catalog';

export const DOWNLOAD_BASE =
  'https://github.com/abaduchanna/3sverse-downloads/releases/latest/download';

const asset = (file: string) => `${DOWNLOAD_BASE}/${file}`;

/** Product id → trial asset in the public mirror. Paid builds are NOT
 * listed here — they go through the gateway below. */
export const PRODUCT_BUILDS: Record<string, { trial: string }> = {
  extractor: {
    trial: asset('VidaPay_Incentive_Extractor_TRIAL.exe'),
  },
  ordering: {
    trial: asset('VidaPay_Device_Ordering_TRIAL.exe'),
  },
  rebate: {
    trial: asset('VidaPay_Rebate_Filing_TRIAL.exe'),
  },
};

export interface BuildDownload {
  label: string;
  url: string;
  note: string;
}

/** Gateway URL for a paid order's FULL build ('' while the gateway is not
 * deployed — the seller then delivers FULL builds personally). */
export function paidDownloadUrl(productId: string, orderRef: string): string {
  if (!PAID_DOWNLOAD.gatewayUrl || !orderRef) return '';
  return (
    `${PAID_DOWNLOAD.gatewayUrl}` +
    `?order=${encodeURIComponent(orderRef.trim().toUpperCase())}` +
    `&product=${encodeURIComponent(productId)}`
  );
}

/** Ordered download list for a product as seen by a customer with a
 * verified order reference. With no gateway configured, only the trial is
 * listed plus a contact note — paid builds are never exposed publicly. */
export function downloadsForProduct(productId: string, orderRef = ''): BuildDownload[] {
  const builds = PRODUCT_BUILDS[productId];
  if (!builds) return [];
  const list: BuildDownload[] = [];

  const paid = paidDownloadUrl(productId, orderRef);
  if (paid) {
    list.push({
      label: 'Licensed build (.exe)',
      url: paid,
      note: 'For monthly / annual / lifetime — verified against your order, always the newest build.',
    });
  }
  list.push({
    label: 'Trial build (.exe)',
    url: builds.trial,
    note: 'Full features for 7 days on 1 PC — no card needed.',
  });
  return list;
}

/** The download that matches a purchased billing model. Trial models map
 * to the public trial asset; PAID models go through the gateway when the
 * caller has an order reference, otherwise '' (delivered by email).
 * (Used by the dormant Netlify order-status function for order emails.) */
export function downloadForProductModel(
  productId: string,
  model: string,
  orderRef = '',
): string {
  const builds = PRODUCT_BUILDS[productId];
  if (!builds) return '';
  if (model === 'trial') return builds.trial;
  return paidDownloadUrl(productId, orderRef);
}

/** Order line keys look like "extractor|lifetime|5". */
export function productIdFromLineKey(lineKey: string): string {
  return (lineKey || '').split('|')[0] || '';
}

/** Order line keys look like "extractor|lifetime|5". */
export function modelFromLineKey(lineKey: string): string {
  return (lineKey || '').split('|')[1] || '';
}
