/**
 * 3S Verse — customer email delivery (static-safe).
 *
 * The site is a static SPA on GitHub Pages, so "email the invoice to the
 * customer automatically" runs through EmailJS (client-side SMTP relay,
 * free tier: 200 emails/month). No API secret is needed in the bundle —
 * the public key is safe by design.
 *
 * SELLER SETUP (one-time, ~5 minutes):
 *   1. Create a free account at https://www.emailjs.com/
 *   2. Email Services → Add Service → connect Gmail (Connect@3SVerse.com)
 *      → copy the Service ID.
 *   3. Email Templates → Create template:
 *        To Email:      {{to_email}}
 *        Reply To:      Connect@3SVerse.com
 *        Subject:       Invoice {{invoice_no}} — 3S Verse (order {{order_ref}})
 *        Content:       Hi {{customer_name}},
 *
 *                       Your 3S Verse invoice is ready — total {{total_label}}.
 *                       Pay within the due window shown on the invoice
 *                       (bank transfer, Wise, PayPal, or USDT). After payment
 *                       we deliver your license keys within a few hours.
 *
                       {{{invoice_html}}}
 *
 *                       3S Verse · 3sverse.com
 *      IMPORTANT: use TRIPLE braces {{{invoice_html}}} so EmailJS inserts
 *      the invoice as raw HTML, not escaped text.
 *   4. Account → API Keys → copy the Public Key.
 *   5. Paste the three IDs below, set enabled: true, commit + push.
 * Until then the storefront still shows the invoice with download + PDF
 * buttons — only the auto-email silently skips.
 */
export const EMAILJS_CONFIG = {
  enabled: false,
  serviceId: '', // e.g. 'service_abc1234'
  templateId: '', // e.g. 'template_invoice1'
  publicKey: '', // e.g. 'AbCdEf12345678'
};

export function emailjsConfigured(): boolean {
  return Boolean(
    EMAILJS_CONFIG.enabled &&
      EMAILJS_CONFIG.serviceId &&
      EMAILJS_CONFIG.templateId &&
      EMAILJS_CONFIG.publicKey,
  );
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
  try {
    const emailjs = (await import('@emailjs/browser')).default;
    await emailjs.send(
      EMAILJS_CONFIG.serviceId,
      EMAILJS_CONFIG.templateId,
      {
        to_email: p.to,
        customer_name: p.name || 'Valued customer',
        invoice_no: p.invoiceNo,
        order_ref: p.orderRef,
        total_label: p.totalLabel,
        invoice_html: p.html,
      },
      {
        publicKey: EMAILJS_CONFIG.publicKey,
        blockHeadless: false,
      },
    );
    return true;
  } catch {
    /* relay failure must never break the order success screen */
    return false;
  }
}
