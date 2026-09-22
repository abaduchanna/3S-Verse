# 3S Verse — EmailJS Setup (step by step, ~5 minutes)

EmailJS is what sends the branded invoice to the customer's inbox
automatically right after they place an order on 3sverse.com. It is a
client-side relay: no server, no monthly bill (free tier = 200 emails/month,
plenty for license orders). The Public Key is safe to expose by design —
it is not a password.

There are TWO ways to finish the setup — do either one:

* **Option A (recommended)** — the "Email delivery (EmailJS)" card on the
  Invoice Studio page (3sverse.com/#/invoice). Saves into YOUR browser only.
  Nothing to commit, works in 2 minutes, and no one else can send through it.
* **Option B** — hard-code the IDs into `src/lib/notify.ts` and push. Every
  visitor's browser gets a working relay (harmless), and invoices auto-email
  even when you place an order from a different device.

---

## Step 1 — Create the EmailJS account

1. Open https://www.emailjs.com/ → **Sign Up** (free).
2. Confirm your email address.

## Step 2 — Connect your Gmail (Email Service)

1. Dashboard → **Email Services → Add New Service**.
2. Choose **Gmail** → **Connect Account** → sign in with
   **Connect@3SVerse.com** → allow the EmailJS permission prompt.
3. On the service screen set:
   * Name: `3S Verse Invoices`
   * **Service ID**: copy it (looks like `service_ab12cd3`) — you need it in
     Step 5.

## Step 3 — Create the invoice template

1. Dashboard → **Email Templates → Create New Template**.
2. Set the **Template Name**: `Invoice delivery`.
3. **Template ID**: copy it (looks like `template_9zy8xw6`) — you need it in
   Step 5. (Edit → rename if you want a custom ID.)
4. Fill in the fields EXACTLY like this:

   **To Email:**
   ```
   {{to_email}}
   ```

   **Reply To:**
   ```
   Connect@3SVerse.com
   ```

   **Subject:**
   ```
   Invoice {{invoice_no}} — 3S Verse (order {{order_ref}})
   ```

   **Content:**
   ```
   Hi {{customer_name}},

   Your 3S Verse invoice is ready — total {{total_label}}.
   Pay within the due window shown on the invoice (bank transfer, Wise,
   PayPal, or USDT). After payment we deliver your license keys within a
   few hours.

   {{{invoice_html}}}

   3S Verse · 3sverse.com
   ```

   IMPORTANT: `{{{invoice_html}}}` must have **THREE** braces. Three braces
   insert the full branded invoice as HTML; two braces would print the
   literal text instead.

5. **Save**. (The test button on their site shows `{{placeholders}}` as raw
   text — that is normal; real variables arrive from the website.)

## Step 4 — Copy the Public Key

1. Dashboard → **Account → API Keys** (left sidebar).
2. Copy **Public Key** (looks like `xK3abCDEfG123`).

## Step 5 — Configure the website

### Option A — Invoice Studio card

1. Open **https://3sverse.com/#/invoice** (seller-only page).
2. Scroll to the **Email delivery (EmailJS)** card.
3. Paste:
   * Service ID — `service_ab12cd3`
   * Template ID — `template_9zy8xw6`
   * Public Key — `xK3abCDEfG123`
4. Click **Save to this browser** → the badge flips to **ACTIVE**.
5. Enter your own email in the test field → **Send test** → check your inbox
   (and spam). You should receive the "EmailJS test" message.

You can also click **Copy template content** in the card — it puts the exact
subject + content above on your clipboard to paste into Step 3.

### Option B — commit the IDs

`artifacts/landing-page/src/lib/notify.ts`:

```ts
export const EMAILJS_CONFIG: EmailJsRuntimeConfig = {
  enabled: true,
  serviceId: 'service_ab12cd3',
  templateId: 'template_9zy8xw6',
  publicKey: 'xK3abCDEfG123',
};
```

Commit + push → Pages redeploys → done. (Option A on your browser overrides
Option B — they compose, not clash.)

## Step 6 — End-to-end test (the real thing)

1. Open 3sverse.com → Dealer license store → add any tool with **7-Day
   Trial** (free) → fill name/email → place the order.
2. The success screen shows the invoice; if EmailJS is active the invoice is
   emailed to the address you entered (the screen shows "emailed to …").
3. Inbox check: subject `Invoice INV-… — 3S Verse (order 3SV-…)`, branded
   invoice inside.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Badge stays "Not configured" | All three IDs must be non-empty; then Save again |
| "Test failed: … 404" | Template ID or Service ID typo (must be the IDs, not the names) |
| "Test failed: 422" | Template still uses two braces `{{invoice_html}}` or a missing variable name |
| Test never arrives | Check spam; confirm the Gmail connect session hasn't expired (re-connect in Email Services) |
| Order screen doesn't show "emailed to …" | The relay was OFF when the order was placed — send the invoice manually via "Copy for email" |
| Free quota hit (200/month) | Upgrade the EmailJS plan or route heavier flows (like bulk keys) through your own Gmail compose |

## Where the pieces live in the code

| File | Role |
|---|---|
| `src/lib/notify.ts` | Relay logic + config (browser override > build-time) |
| `src/pages/InvoiceStudio.tsx` | "Email delivery (EmailJS)" setup card + test send |
| `src/components/DealerStore.tsx` | Fires the invoice email on order success |
