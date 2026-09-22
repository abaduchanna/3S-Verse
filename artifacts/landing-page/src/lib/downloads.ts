/**
 * Latest-build download links — single source of truth for every
 * "download the app" button on the site and in the order emails.
 *
 * All links point at the central public mirror repo
 * (abaduchanna/3sverse-downloads). Its scheduled action re-syncs the
 * newest release assets of the private build repos every few hours, so
 * each URL below ALWAYS serves the newest build of that tool:
 *
 *   https://github.com/abaduchanna/3sverse-downloads/releases/latest/download/<EXE>
 *
 * That is what makes free re-downloads possible: when the seller ships a
 * new build, every existing customer's download link upgrades itself —
 * no new links, no manual step.
 */

export const DOWNLOAD_BASE =
  'https://github.com/abaduchanna/3sverse-downloads/releases/latest/download';

const asset = (file: string) => `${DOWNLOAD_BASE}/${file}`;

/** Product id -> build assets. Trial + paid are the same URL when the
 * tool ships a single build with the 7-day trial built in. */
export const PRODUCT_BUILDS: Record<
  string,
  { paid: string; trial: string }
> = {
  extractor: {
    paid: asset('VidaPay_Incentive_Extractor_FULL.exe'),
    trial: asset('VidaPay_Incentive_Extractor_TRIAL.exe'),
  },
  ordering: {
    paid: asset('VidaPay_Device_Ordering_FULL.exe'),
    trial: asset('VidaPay_Device_Ordering_TRIAL.exe'),
  },
  rebate: {
    paid: asset('VidaPay_Rebate_Filing.exe'),
    trial: asset('VidaPay_Rebate_Filing.exe'),
  },
};

export interface BuildDownload {
  label: string;
  url: string;
  note: string;
}

/** Ordered download list for a product (paid build first). */
export function downloadsForProduct(productId: string): BuildDownload[] {
  const builds = PRODUCT_BUILDS[productId];
  if (!builds) return [];
  const list: BuildDownload[] = [
    {
      label: 'Licensed build (.exe)',
      url: builds.paid,
      note: 'For monthly / annual / lifetime — activate with your license key or start the 7-day trial.',
    },
  ];
  if (builds.trial !== builds.paid) {
    list.push({
      label: 'Trial build (.exe)',
      url: builds.trial,
      note: 'Full features for 7 days on 1 PC — no card needed.',
    });
  }
  return list;
}

/** The download that matches a purchased billing model. */
export function downloadForProductModel(
  productId: string,
  model: string,
): string {
  const builds = PRODUCT_BUILDS[productId];
  if (!builds) return '';
  return model === 'trial' ? builds.trial : builds.paid;
}

/** Order line keys look like "extractor|lifetime|5". */
export function productIdFromLineKey(lineKey: string): string {
  return (lineKey || '').split('|')[0] || '';
}

/** Order line keys look like "extractor|lifetime|5". */
export function modelFromLineKey(lineKey: string): string {
  return (lineKey || '').split('|')[1] || '';
}
