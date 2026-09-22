# 3S Verse — Download Gateway (order-number gated FULL builds)

This folder contains the Cloudflare Worker that serves your **FULL (paid)**
Windows builds to paying customers only, keyed by the order number printed
on their invoice. FREE TRIAL builds stay on the public
`3sverse-downloads` repo (trial-only by design) — the FULL builds never
touch anything public.

```
worker.js        the whole gateway (one file, no build step)
orders.json      EXAMPLE ledger/orders.json (also pushed to vidapay-license-server)
README.md        this guide
```

## Why this design

| Requirement | How it is met |
|---|---|
| Paid builds must not be public | Assets live in PRIVATE repos; only this worker can read them |
| Customer downloads with order number | Worker checks `ledger/orders.json` before streaming anything |
| Package rules (1-year vs lifetime, bundle vs single tool) | `model` + `expires` + `products` fields enforce it |
| Monthly/yearly customer stops paying | Set `status: "revoked"` or let `expires` pass — download closes within 5 min |
| Always the newest build | Worker streams `releases/latest` of the build repo — zero re-uploads |

## One-time setup (~15 minutes)

### 1. Create the read-only token

1. GitHub → Settings → Developer settings → Fine-grained tokens → **Generate new token**.
2. Name: `3sverse-download-gateway`. Expiration: 1 year (calendar reminder to rotate).
3. **Repository access → Only select repositories**:
   `vidapay-license-server`, `vidapay-extractor`, `vidapay-ordering`, `vidapay-rebate-filing`.
4. Permissions → Repository permissions → **Contents: Read-only**. Nothing else.
5. Generate and copy the token (`github_pat_…`).

### 2. Deploy the worker (dashboard, no tools needed)

1. dash.cloudflare.com → **Workers & Pages → Create → Create Worker**.
2. Name: `3sverse-downloads` → Deploy → **Edit code**.
3. Delete the boilerplate, paste all of `worker.js`, **Deploy**.
4. Worker → **Settings → Variables and Secrets**:
   * Secret `GH_TOKEN` = the token from step 1 (type: Secret).
   * Variable `OWNER` = `abaduchanna` (type: Text).
   * Variable `LEDGER_REPO` = `abaduchanna/vidapay-license-server`.
   * Variable `LEDGER_PATH` = `ledger/orders.json`.
5. Note your worker URL, e.g. `https://3sverse-downloads.<your-subdomain>.workers.dev`.

### 3. Register the customer's order

Edit `ledger/orders.json` in `vidapay-license-server` (GitHub web editor is fine)
and add one entry per paid order:

```json
{
  "3SV-K9Q2M7WZ": {
    "customer": "Faisal Ahmed — Bright Star Motors",
    "products": ["bundle"],
    "model": "lifetime",
    "expires": null,
    "status": "active"
  },
  "3SV-EXAMPLE01": {
    "customer": "Test — 1-year extractor only",
    "products": ["extractor"],
    "model": "expiry",
    "expires": "2027-09-22",
    "status": "active"
  }
}
```

Rules: `products` is a list from `extractor`, `ordering`, `rebate`, `bundle`
(bundle covers all three). `model` is `lifetime` or `expiry`. `status` is
`active`, `revoked`, or `pending` (pending/unknown = no download).

> **Site order panel too:** the 3sverse.com/order status page uses its own
> privacy-safe registry (`artifacts/landing-page/public/data/orders.json`,
> keyed by SHA-256 of the order reference — see `_how_to_add` inside). Add
> the hash there as well so the customer's /order page shows their products;
> the worker's ledger above stays the authority that actually gates files.

### 4. Connect the website

`artifacts/landing-page/src/lib/catalog.ts`:

```ts
export const PAID_DOWNLOAD = {
  gatewayUrl: 'https://3sverse-downloads.<your-subdomain>.workers.dev/download',
  ...
};
```

Commit + push — the store's "Already purchased?" box becomes a live gate
(the button opens the worker in a new tab and the .exe downloads).

## Daily use

* **New paid order** → invoice the customer in Invoice Studio (order number
  auto-generates) → add the same order number to `orders.json` → customer
  can now pull every update forever (or until expiry).
* **Monthly/yearly not renewed** → set `expires` to the real end date, or
  `status: "revoked"` for immediate cut-off.
* **Refund / chargeback** → `status: "revoked"`.
* **Moved to a new PC?** — that is the license key's job (License Manager in
  the Keygen: unbind/rebind); downloads keep working with the same order number.

## Testing checklist

1. `https://…workers.dev/` → info page loads.
2. `/download?order=3SV-DOESNOTEXIST&product=bundle` → "Order number not found".
3. `/download?order=3SV-K9Q2M7WZ&product=bundle` (sample) → bundle page with three buttons.
4. Each button streams the FULL .exe (check the filename ends `_FULL.exe`).
5. Flip the sample to `"status": "revoked"` → wait 5 min → download refused.
6. Restore to `"active"`.

## Notes & limits

* Free Workers plan is plenty (100k requests/day); a 110 MB stream counts as
  one request. The 5-minute cache means GitHub API usage stays far below limits.
* Orders are read from `main` of the ledger repo; keep `orders.json` valid JSON
  (GitHub's editor shows errors before committing).
* The worker never exposes the GitHub token; customers only ever see your
  worker URL. Rotate the token yearly.
