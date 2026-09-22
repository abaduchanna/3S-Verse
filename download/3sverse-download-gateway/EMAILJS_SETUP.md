# 3S Verse — EmailJS Setup (step by step, ~10 minutes)

EmailJS is what sends the branded invoice to the customer's inbox
automatically right after they place an order on 3sverse.com. It is a
client-side relay: no server, no monthly bill (free tier = 200 emails/month,
plenty for license orders). The Public Key is safe to expose by design —
it is not a password.

## IMPORTANT — read this first

**Connect@3SVerse.com is NOT a Gmail address.** It is a mailbox hosted by
northwestagent (the free 250 MB mailbox). EmailJS cannot "connect" it the
way it connects Gmail (no Google login exists for it). So do NOT click
"Gmail → Connect Account" and try to sign in with Connect@3SVerse.com —
that will always fail.

Instead, pick **ONE route** below in Step 2. All three routes end the same
way: you get a Service ID, and customer **replies always land in
Connect@3SVerse.com** (that is what the Reply-To field does).

| Route | From address the customer sees | Effort | Recommendation |
|---|---|---|---|
| **1 — Gmail sender** | a `@gmail.com` address you choose | 5 min, zero config | **Start here** |
| **2 — Gmail alias** | Connect@3SVerse.com (via Gmail "Send mail as") | 10 min, needs SMTP password | Best look, do it later |
| **3 — Direct SMTP** | Connect@3SVerse.com (via northwestagent SMTP) | 10 min, depends on provider | Only if 2 fails |

---

## Step 1 — Create the EmailJS account

1. Open https://www.emailjs.com/ → **Sign Up** (free).
2. Confirm your email address (use any inbox you can open — this is only
   the EmailJS login, not the sender).

## Step 2 — Connect a SENDER mailbox (pick ONE route)

### Route 1 — Free Gmail sender (easiest, recommended first)

1. Create (or reuse) a free **Gmail** account just for sending, for
   example `3sverse.orders@gmail.com`. It is only the sending engine —
   nothing customer-facing depends on it except the From line.
2. EmailJS Dashboard → **Email Services → Add New Service**.
3. Choose **Gmail** → **Connect Account** → sign in with that Gmail →
   allow the EmailJS permission prompt.
4. Service name: `3S Verse Invoices` → **Create Service**.
5. Copy the **Service ID** (looks like `service_ab12cd3`) — needed in
   Step 5. Customer replies still reach you because the template sets
   **Reply-To: Connect@3SVerse.com** (Step 3).

### Route 2 — Show Connect@3SVerse.com as the sender (Gmail alias)

Do Route 1 first, then upgrade the look:

1. In the SAME Gmail: Settings (gear) → **See all settings → Accounts and
   Import → Send mail as → Add another email address**.
2. Name: `3S Verse`, email: `Connect@3SVerse.com`, uncheck "Treat as
   alias" is fine either way → **Next Step**.
3. SMTP fill-in (get exact values from the northwestagent control panel /
   their support; typical values):
   * SMTP Server: `mail.northwestagent.com` (use what the panel says)
   * Port: `465`, Security: **SSL** (if that fails try `587` + **STARTTLS**)
   * Username: `Connect@3SVerse.com` (full address)
   * Password: the mailbox password of Connect@3SVerse.com
4. **Add Account** → Gmail sends a verification code to
   Connect@3SVerse.com → open it in the northwestagent webmail → click the
   link / paste the code.
5. Back in EmailJS, open the service → in the email template's **From**
   you can now pick `Connect@3SVerse.com`; also set Gmail's "default"
   for that alias. (Gmail may append "via gmail.com" in some clients —
   harmless.)

### Route 3 — Direct SMTP, no Gmail at all (only if Route 2 fails)

1. Collect the SMTP settings from northwestagent (same values as Route 2
   step 3).
2. EmailJS → **Email Services → Add New Service → Other (SMTP)**.
3. Enter server / port / security / username / password → **Create
   Service** → copy the **Service ID**.
4. Caveat: some budget hosts block external relays or rate-limit them.
   If the test send fails here, do not fight it — use Route 1. A
   250 MB mailbox is also small; invoices with images can fill it fast,
   so keep an eye on quota.

## Step 3 — Create the invoice template

1. Dashboard → **Email Templates → Create New Template**.
2. **Template Name**: `Invoice delivery`.
3. **Template ID**: copy it (looks like `template_9zy8xw6`) — needed in
   Step 5. (Edit → rename if you want a custom ID.)
4. Fill in the fields EXACTLY like this:

   **From Name:**
   ```
   3S Verse
   ```

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

### Option A — Invoice Studio card (recommended)

1. Open **https://3sverse.com/#/invoice** (seller-only page).
2. Scroll to the **Email delivery (EmailJS)** card.
3. Paste:
   * Service ID — `service_ab12cd3`
   * Template ID — `template_9zy8xw6`
   * Public Key — `xK3abCDEfG123`
4. Click **Save to this browser** → the badge flips to **ACTIVE**.
5. Enter your own email in the test field → **Send test** → check your
   inbox (and spam). You should receive the "EmailJS test" message.

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
   invoice inside, and replying to it addresses Connect@3SVerse.com.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Gmail "Connect Account" rejects Connect@3SVerse.com | Expected — it is not a Gmail mailbox. Use Route 1 with a real @gmail.com account |
| Route 2 verification email never arrives | Open the northwestagent webmail (not Gmail) and check spam; make sure the 250 MB mailbox is not full |
| Route 2 "SMTP credentials rejected" | Wrong port/security combo — try 465/SSL, then 587/STARTTLS; confirm the SMTP password is the MAILBOX password, not the panel login |
| Route 3 "Other (SMTP)" fails to create | The host blocks external relays — switch to Route 1 or 2 |
| Badge stays "Not configured" | All three IDs must be non-empty; then Save again |
| "Test failed: … 404" | Template ID or Service ID typo (must be the IDs, not the names) |
| "Test failed: 422" | Template still uses two braces `{{invoice_html}}` or a missing variable name |
| Test never arrives | Check spam; re-connect the mailbox in Email Services (sessions expire) |
| Order screen doesn't show "emailed to …" | The relay was OFF when the order was placed — send the invoice manually via "Copy for email" |
| Free quota hit (200/month) | Upgrade the EmailJS plan or route heavier flows through your own Gmail compose |

## Where the pieces live in the code

| File | Role |
|---|---|
| `src/lib/notify.ts` | Relay logic + config (browser override > build-time) |
| `src/pages/InvoiceStudio.tsx` | "Email delivery (EmailJS)" setup card + test send |
| `src/components/DealerStore.tsx` | Fires the invoice email on order success |
