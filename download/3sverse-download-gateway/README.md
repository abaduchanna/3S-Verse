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

> **Variables used by this worker:**
> `GH_TOKEN` (secret, read-only, downloads) · `LEDGER_WRITE_TOKEN`
> (secret, Contents Read+Write on vidapay-license-server only — the
> Studio admin token works — used by `POST /order` intake) ·
> `OWNER` · `LEDGER_REPO` · `LEDGER_PATH`.

On dash.cloudflare.com you will land on a screen titled **"Create an app —
Make something new"** with these tiles:

> Connect GitHub · Connect with GitLab · **Start with Hello World!** ·
> Select a template · Upload your static files · (small link: Continue to Pages)

Do this, in order:

1. Left sidebar → **Workers & Pages** (newer dashboards label it
   **Compute (Workers)**) → **Create** — you are now on the screen above.
2. Click the **"Start with Hello World!"** tile.
   * NOT "Connect GitHub" (that deploys a repository, not a single file).
   * NOT "Upload your static files" (that serves a static site, not a
     single script).
   * NOT "Select a template" (Hello World already IS the template).
3. Worker name: `3sverse-downloads` → **Deploy**.
   Cloudflare first deploys a placeholder hello-world script — expected.
4. On the success screen click **Edit code**.
5. The online editor opens with boilerplate code
   (`export default { async fetch(...) ... }`). Click in the editor →
   **Ctrl+A → Delete** → paste the ENTIRE `worker.js` (open the file in a
   text editor, select all, copy) → **Deploy** (top right) → confirm.
6. Back on the worker's page → **Settings → Variables and Secrets → Add**:
   * Type **Secret** — `GH_TOKEN` = the token from step 1.
   * Type **Secret** — `LEDGER_WRITE_TOKEN` = a token with Contents
     Read+Write on `vidapay-license-server` (the Studio admin token
     works). Powers the website order intake (`POST /order`) — without
     it orders still arrive by email but the Studio Orders tab stays
     empty.
   * Type **Text** — `OWNER` = `abaduchanna`.
   * Type **Text** — `LEDGER_REPO` = `abaduchanna/vidapay-license-server`.
   * Type **Text** — `LEDGER_PATH` = `ledger/orders.json`.
   Save each one (Cloudflare asks to redeploy — accept; redeploying after
   variables is normal and instant).
7. Test the worker is live:
   * `https://3sverse-downloads.<your-subdomain>.workers.dev/` → the
     "3S Verse — Customer Downloads" info page must appear.
   * `https://…workers.dev/download?order=3SV-TEST&product=bundle` →
     must answer **"Order number not found"** (means the ledger check works).
8. Note the full worker URL — you need it in step 4 below.

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

## Turnstile bot protection (2026-09 update)

The worker now carries a Cloudflare Turnstile gate on every public ACTION:

| Route | Protection |
|-------|------------|
| `POST /order`   | `turnstileToken` field required (verified server-side) |
| `POST /contact` | `turnstileToken` field required + relays to FormSubmit only after verification |
| `GET /download` | first hit without a valid `&ct=` token shows a one-click check page; the widget bounces back with `&ct=<token>` which is verified server-side before a single byte streams |
| `GET /trial`    | same one-click check, then 302 to the public trial asset |

Static pages on GitHub Pages need no gate (nothing to attack there) —
every ENDPOINT does, and all of them are covered.

### Switching the protection ON (5 minutes)

1. dash.cloudflare.com → **Turnstile → Add site** — domain `3sverse.com`,
   widget mode **Managed** → copy the **Site Key** and the **Secret Key**.
2. Worker → Settings → Variables → add:
   * `TURNSTILE_SITE_KEY` (plain text) = the Site Key
   * `TURNSTILE_SECRET_KEY` (secret) = the Secret Key
3. `landing-page/src/lib/catalog.ts` → set `TURNSTILE_SITE_KEY` to the
   same Site Key → rebuild + push the site (CI deploys it).
   This one switch also routes the free-trial buttons through `/trial`
   and makes contact/review/order posts carry tokens.
4. Redeploy this worker (paste the new `worker.js` in the dashboard).

Order matters: deploy the worker first, then set the site key. Until the
worker runs the new code the site key must stay `''` (the forms fall back
to posting straight to FormSubmit and trial links stay direct-to-GitHub).

### What is new in this version

* `POST /contact` — new relay: verifies Turnstile, then forwards to
  FormSubmit AJAX (`connect@3sverse.com`). Field allow-list, honeypot
  short-circuit, 10 posts / 15 min / IP rate limit.
* `GET /trial?product=extractor|ordering|rebate` — Turnstile page in front
  of the public trial builds (3sverse-downloads releases).
* `GET /download` — interstitial check when the gate is on; invoice links
  still work (they show the one-click check first).
* `POST /order` — now requires the token when the gate is on.
* While `TURNSTILE_SECRET_KEY` is unset the worker behaves exactly like
  the previous version (everything passes) — staged rollout, no cliff.

### Whole-site bot posture (optional, dashboard-only)

Turnstile covers the actions. For the rest, two free Cloudflare toggles:

* **Security → Bots → Bot Fight Mode** ON (blocks obvious bot traffic).
* **Security → WAF → Rate limiting** rule on `*workers.dev/3sverse-downloads*`
  (e.g. 60 req/min/IP) to cap scraping pressure.

### Licensing side — seat moves (same release)

* Desktop tools now have a **"Deactivate this PC"** link (bottom-right of
  every app): frees the seat server-side, same key activates elsewhere.
* Studio's **Release Seats** asks for a reason and writes
  `ledger/transfer_log.json`; the apps' self-deactivation writes the same
  log. Studio's Manage tab has a **Transfer log** viewer. Repeated moves
  for one key = key-sharing pattern.
* **14-day move cooldown (anti key-sharing):** after any release, the key
  self-service moves to ONE new PC inside 14 days; a second move inside
  the window is refused by the apps with an "email Connect@3SVerse.com"
  fallback. A Studio release is the manual override — it always works and
  refreshes the one-move grace. Multi-seat (per-PC volume) licenses are
  exempt. State lives in the license record (`cooldown_until`,
  `cooldown_moves_left`); the transfer log stays the audit trail.
