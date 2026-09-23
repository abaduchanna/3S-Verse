/**
 * Latest-build download links — single source of truth for every
 * "download the app" button on the site and in the order emails.
 *
 * SINGLE-BUILD MODEL (mirrors the sync workflow in 3sverse-downloads):
 * Each tool ships as ONE .exe. It opens as a free 7-day trial and a
 * license key unlocks the full version permanently — trial users and
 * paid customers run byte-identical software:
 *   https://github.com/abaduchanna/3sverse-downloads/releases/latest/download/<EXE>
 * A scheduled action re-syncs the newest build of each tool every few
 * hours, so each URL below ALWAYS serves the newest build.
 *
 * Paid delivery is the LICENSE KEY (emailed after payment), not a
 * separate build — there is no private FULL-build gateway in the
 * customer path anymore. Key authenticity is enforced inside the app
 * (Ed25519 signatures against the seller-published public keys), so the
 * public link is safe to share anywhere.
 */

export const DOWNLOAD_BASE =
  'https://github.com/abaduchanna/3sverse-downloads/releases/latest/download';

const asset = (file: string) => `${DOWNLOAD_BASE}/${file}`;

/** Product id → the one official build in the public mirror. */
export const PRODUCT_BUILDS: Record<string, { build: string }> = {
  extractor: {
    build: asset('VidaPay_Incentive_Extractor.exe'),
  },
  ordering: {
    build: asset('VidaPay_Device_Ordering.exe'),
  },
  rebate: {
    build: asset('VidaPay_Rebate_Filing.exe'),
  },
};

export interface BuildDownload {
  label: string;
  url: string;
  note: string;
}

/** The one official build URL for a product ('' for unknown ids). */
export function buildDownloadUrl(productId: string): string {
  return PRODUCT_BUILDS[productId]?.build ?? '';
}

/** Ordered download list for a product. One entry — the same official
 * build serves trials and paid customers alike; only the note differs. */
export function downloadsForProduct(productId: string, orderRef = ''): BuildDownload[] {
  const url = buildDownloadUrl(productId);
  if (!url) return [];
  const list: BuildDownload[] = [];
  list.push(
    orderRef
      ? {
          label: 'Download for Windows (.exe)',
          url,
          note: 'Always the newest official build — your license key (emailed with your invoice) unlocks the full version.',
        }
      : {
          label: 'Download for Windows (.exe)',
          url,
          note: 'Full software with a free 7-day trial built in — a license key unlocks it permanently.',
        },
  );
  return list;
}

/** The download that matches a purchased billing model. With the
 * single-build model every model gets the same official build; paid
 * models are unlocked by the license key, not by a different file.
 * (Used by the dormant Netlify order-status function for order emails.) */
export function downloadForProductModel(
  productId: string,
  _model: string,
  _orderRef = '',
): string {
  return buildDownloadUrl(productId);
}

/** Order line keys look like "extractor|lifetime|5". */
export function productIdFromLineKey(lineKey: string): string {
  return (lineKey || '').split('|')[0] || '';
}

/** Order line keys look like "extractor|lifetime|5". */
export function modelFromLineKey(lineKey: string): string {
  return (lineKey || '').split('|')[1] || '';
}
