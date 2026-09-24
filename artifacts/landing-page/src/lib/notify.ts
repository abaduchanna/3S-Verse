/**
 * 3S Verse — customer email delivery (static-safe).
 *
 * The site is a static SPA on GitHub Pages, so "email the invoice to the
 * customer automatically" runs through EmailJS (client-side SMTP relay,
 * free tier: 200 emails/month). No API secret is needed in the bundle —
 * the public key is safe by design.
 *
 * CONFIGURATION — two ways, browser override wins:
 *
 *   A) BROWSER OVERRIDE: values saved in this browser's localStorage under
 *      the key below (previously entered via the seller Invoice Studio UI —
 *      that page is no longer on the public site). If you saved values on
 *      your device they keep working; clear them with
 *      emailjsClearConfig() from a console if needed.
 *
 *   B) BUILD-TIME: paste the three IDs into EMAILJS_CONFIG below, set
 *      enabled: true, commit + push. Every visitor's browser then has a
 *      working relay (harmless — public key only) — useful so orders can
 *      auto-email even from a different device.
 *
 * SELLER SETUP (one-time, ~5 minutes, full walkthrough in
 * download/3sverse-download-gateway/EMAILJS_SETUP.md):
 *   1. Create a free account at https://www.emailjs.com/
 *   2. Email Services → Add Service → connect a SENDER mailbox and copy
 *      the Service ID (service_xxxxxxx). NOTE: Connect@3SVerse.com is NOT
 *      a Gmail mailbox (northwestagent-hosted), so pick a route from
 *      EMAILJS_SETUP.md — Route 1 (free Gmail sender, easiest), Route 2
 *      (Gmail "Send mail as" alias) or Route 3 (direct SMTP).
 *   3. Email Templates → Create template:
 *        To Email:      {{to_email}}
 *        Reply To:      Connect@3SVerse.com
 *        Subject:       Invoice {{invoice_no}} — 3S Verse (order {{order_ref}})
 *        Content:       Hi {{customer_name}},

 *                       Your 3S Verse invoice is ready — total {{total_label}}.
 *                       Pay within the due window shown on the invoice
 *                       (bank transfer, Wise, PayPal, or USDT). After payment
 *                       we deliver your license keys within a few hours.

 *                       {{{invoice_html}}}

 *                       3S Verse · 3sverse.com
 *      IMPORTANT: use TRIPLE braces {{{invoice_html}}} so EmailJS inserts
 *      the invoice as raw HTML, not escaped text. Save → copy Template ID.
 *   4. Account → API Keys → copy the Public Key.
 *   5. Paste the three IDs (EMAILJS_CONFIG, or a saved browser override) and test.
 * Until configured, the storefront still shows the invoice with download +
 * PDF buttons — only the auto-email silently skips.
 */
export interface EmailJsRuntimeConfig {
  enabled: boolean;
  serviceId: string;
  templateId: string;
  publicKey: string;
}

/** Build-time defaults (option B). Safe to leave empty. */
export const EMAILJS_CONFIG: EmailJsRuntimeConfig = {
  enabled: false,
  serviceId: '', // e.g. 'service_abc1234'
  templateId: '', // e.g. 'template_invoice1'
  publicKey: '', // e.g. 'AbCdEf12345678'
};

const LS_KEY = '3sv_emailjs_config';

function browserOverrides(): Partial<EmailJsRuntimeConfig> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<EmailJsRuntimeConfig>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/** Effective config: browser override (option A) wins over build-time (B). */
export function emailjsEffectiveConfig(): EmailJsRuntimeConfig {
  return { ...EMAILJS_CONFIG, ...browserOverrides() };
}

/** Persist the in-app setup (option A) in this browser. Pass enabled=false to turn the relay off. */
export function emailjsSaveConfig(cfg: Partial<EmailJsRuntimeConfig>): void {
  if (typeof window === 'undefined') return;
  const merged = { ...emailjsEffectiveConfig(), ...cfg };
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(merged));
  } catch {
    /* private mode — config stays for this page session only */
  }
}

/** Remove the browser override (falls back to build-time config). */
export function emailjsClearConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function emailjsConfigured(): boolean {
  const cfg = emailjsEffectiveConfig();
  return Boolean(cfg.enabled && cfg.serviceId && cfg.templateId && cfg.publicKey);
}

interface InvoiceEmailParams {
  to: string;
  name: string;
  invoiceNo: string;
  orderRef: string;
  totalLabel: string;
  html: string;
}

/** Send the rendered invoice to the customer. Returns true when handed to EmailJS. */
export async function emailInvoiceHtml(p: InvoiceEmailParams): Promise<boolean> {
  if (!emailjsConfigured() || !p.to) return false;
  const cfg = emailjsEffectiveConfig();
  try {
    const emailjs = (await import('@emailjs/browser')).default;
    await emailjs.send(
      cfg.serviceId,
      cfg.templateId,
      {
        to_email: p.to,
        customer_name: p.name || 'Valued customer',
        invoice_no: p.invoiceNo,
        order_ref: p.orderRef,
        total_label: p.totalLabel,
        invoice_html: p.html,
      },
      {
        publicKey: cfg.publicKey,
        blockHeadless: false,
      },
    );
    return true;
  } catch {
    /* relay failure must never break the order success screen */
    return false;
  }
}

/**
 * Fire a minimal test message through the relay (in-app "Send test email").
 * Uses the same template variables with placeholder values, so it also
 * proves the template renders (including {{{invoice_html}}}).
 */
export async function emailjsSendTest(to: string): Promise<{ ok: boolean; error?: string }> {
  if (!emailjsConfigured()) return { ok: false, error: 'EmailJS is not configured yet.' };
  if (!to || !to.includes('@')) return { ok: false, error: 'Enter a valid test email address.' };
  const cfg = emailjsEffectiveConfig();
  try {
    const emailjs = (await import('@emailjs/browser')).default;
    await emailjs.send(
      cfg.serviceId,
      cfg.templateId,
      {
        to_email: to,
        customer_name: 'EmailJS Test',
        invoice_no: 'INV-TEST-0001',
        order_ref: '3SV-TEST-0001',
        total_label: '$0',
        invoice_html:
          '<div style="font-family:Arial,sans-serif;padding:16px;border:1px solid #e6e4ee;border-radius:8px;">' +
          '<strong>3S Verse — EmailJS test</strong><br/>If you can read this, the relay and ' +
          'template work. Real invoices will embed the full branded invoice here.</div>',
      },
      { publicKey: cfg.publicKey, blockHeadless: false },
    );
    return { ok: true };
  } catch (err) {
    const text = err instanceof Error ? err.message : 'Unknown EmailJS error';
    return { ok: false, error: text };
  }
}
