/**
 * 3S Verse — invoice engine.
 *
 * Single source of truth for the invoice format used by the Invoice Studio
 * (src/pages/InvoiceStudio.tsx). The SAME renderer output goes to the
 * customer (PDF print, standalone HTML file, or HTML email paste) — the
 * seller and the customer always see the identical format.
 *
 * Prices come from ./catalog so invoice amounts always match the storefront
 * (launch offer included). Output HTML is table-based with inline styles so
 * it survives Gmail/Outlook paste and prints cleanly to A4 PDF.
 */
import {
  MODELS,
  PRODUCTS,
  SEATS,
  discountPercent,
  formatUSD,
  listPrice,
  unitPrice,
  type ModelId,
  type SeatsId,
} from './catalog';

export type InvoiceStatus = 'PAID' | 'DUE' | 'CANCELLED';

/** Unpaid invoices auto-cancel after this many days. */
export const INVOICE_DUE_DAYS = 7;

export interface InvoiceItem {
  name: string;
  detail: string;
  qty: number;
  /** Charged (post-launch-offer) unit price, USD. */
  unit: number;
  /** List unit price before the launch offer, USD. */
  listUnit: number;
}

export interface InvoiceKeyLine {
  label: string;
  key: string;
}

export interface InvoiceData {
  invoiceNo: string;
  orderRef: string;
  /** Long-form date, e.g. "September 20, 2026". */
  date: string;
  status: InvoiceStatus;
  /** ISO due timestamp — DUE invoices auto-cancel past this point. */
  validUntil?: string;
  customer: { name: string; company: string; email: string };
  paymentNote: string;
  items: InvoiceItem[];
  keys: InvoiceKeyLine[];
  notes: string;
}

/* ---------- palette (print-safe on white paper) ---------- */
const INK = '#16151d';
const MUTED = '#6b6880';
const HAIR = '#e6e4ee';
const ACCENT = '#0e7c8c';
const ACCENT_SOFT = '#e9f7f9';
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function invoiceNumberFromRef(ref: string): string {
  const trimmed = ref.trim().toUpperCase();
  if (!trimmed) return '';
  return `INV-${trimmed.replace(/^3SV-/, '')}`;
}

/** Build an invoice line from the catalog (prices + launch discount included). */
export function catalogInvoiceItem(
  productId: string,
  model: ModelId,
  seats: SeatsId,
  qty: number,
): InvoiceItem | null {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) return null;
  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;
  const seatsLabel = SEATS.find((s) => s.id === seats)?.label ?? seats;
  const off = discountPercent(product, model, seats);
  const detail =
    off > 0
      ? `${modelLabel} · ${seatsLabel} — list ${formatUSD(listPrice(product, model, seats))} · Launch Offer −${off}%`
      : `${modelLabel} · ${seatsLabel}`;
  return {
    name: product.name,
    detail,
    qty,
    unit: unitPrice(product, model, seats),
    listUnit: listPrice(product, model, seats),
  };
}

export function invoiceTotals(items: InvoiceItem[]): {
  listSubtotal: number;
  discount: number;
  total: number;
} {
  const listSubtotal = items.reduce((sum, i) => sum + i.listUnit * i.qty, 0);
  const total = items.reduce((sum, i) => sum + i.unit * i.qty, 0);
  return { listSubtotal, discount: listSubtotal - total, total };
}

/** Parse the studio keys textarea — one key per line, optional "Label: KEY". */
export function parseKeysText(text: string): InvoiceKeyLine[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':');
      if (idx > 0 && idx <= 40) {
        const label = line.slice(0, idx).trim();
        const key = line.slice(idx + 1).trim();
        if (key) return { label, key };
      }
      return { label: '', key: line };
    });
}

export function todayLong(now = new Date()): string {
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** ISO timestamp at end-of-day, `days` from now (invoice expiry). */
export function dueDateISO(days = INVOICE_DUE_DAYS, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}

/** Long-form display of an ISO expiry timestamp. */
export function formatDueLong(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return todayLong(d);
}

/** True when a DUE invoice is past its validUntil window. */
export function isInvoiceExpired(data: Pick<InvoiceData, 'status' | 'validUntil'>): boolean {
  if (data.status !== 'DUE' || !data.validUntil) return false;
  const t = new Date(data.validUntil).getTime();
  return !Number.isNaN(t) && Date.now() > t;
}

/* ===================================================================== */
/*  Body renderer — email-safe, table-based, inline styles only.         */
/* ===================================================================== */
export function renderInvoiceBody(data: InvoiceData): string {
  const { listSubtotal, discount, total } = invoiceTotals(data.items);
  const paid = data.status === 'PAID';
  const cancelled = data.status === 'CANCELLED';

  const badge = cancelled
    ? `<span id="inv-badge" style="display:inline-block;margin-top:10px;padding:5px 14px;border-radius:999px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:11px;font-weight:700;letter-spacing:.16em;">CANCELLED</span>`
    : paid
      ? `<span id="inv-badge" style="display:inline-block;margin-top:10px;padding:5px 14px;border-radius:999px;background:#ecfdf5;border:1px solid #a7f3d0;color:#047857;font-size:11px;font-weight:700;letter-spacing:.16em;">PAID</span>`
      : `<span id="inv-badge" style="display:inline-block;margin-top:10px;padding:5px 14px;border-radius:999px;background:#fffbeb;border:1px solid #fde68a;color:#b45309;font-size:11px;font-weight:700;letter-spacing:.16em;">PAYMENT DUE</span>`;

  const cancelBanner = cancelled
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;"><tr><td style="padding:12px 16px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;font-size:13px;font-weight:600;color:#b91c1c;">This invoice has been cancelled and is no longer payable. If you believe this is a mistake, contact Connect@3sverse.com with your order reference.</td></tr></table>`
    : '';

  const detailRow = (label: string, value: string) =>
    `<tr>
  <td style="padding:3px 0;font-size:12px;color:${MUTED};white-space:nowrap;padding-right:18px;">${esc(label)}</td>
  <td style="padding:3px 0;font-size:13px;color:${INK};font-weight:600;text-align:right;">${esc(value) || '—'}</td>
</tr>`;

  const itemRows = data.items
    .map(
      (item) => `<tr>
  <td style="padding:14px 0;border-bottom:1px solid ${HAIR};">
    <div style="font-size:15px;font-weight:600;color:${INK};">${esc(item.name)}</div>
    <div style="font-size:12.5px;color:${MUTED};margin-top:3px;">${esc(item.detail)}</div>
  </td>
  <td style="padding:14px 0;border-bottom:1px solid ${HAIR};text-align:center;font-size:14px;color:${INK};">${item.qty}</td>
  <td style="padding:14px 0;border-bottom:1px solid ${HAIR};text-align:right;font-size:14px;color:${INK};white-space:nowrap;">${formatUSD(item.unit)}</td>
  <td style="padding:14px 0;border-bottom:1px solid ${HAIR};text-align:right;font-size:14px;font-weight:600;color:${INK};white-space:nowrap;">${formatUSD(item.unit * item.qty)}</td>
</tr>`,
    )
    .join('\n');

  const keyBlocks = data.keys
    .map(
      (k, i) => `<tr>
  <td style="padding:0 0 10px;">
    <div style="font-size:12px;color:${MUTED};margin-bottom:4px;">${esc(k.label) || `License key ${i + 1}`}</div>
    <div style="font-family:'SF Mono',Consolas,Menlo,monospace;font-size:14px;letter-spacing:.06em;background:${ACCENT_SOFT};border:1px solid #cfe9ee;border-radius:8px;padding:10px 14px;color:${INK};">${esc(k.key)}</div>
  </td>
</tr>`,
    )
    .join('\n');

  const parts: string[] = [];

  if (cancelBanner) parts.push(cancelBanner);

  parts.push(`<table role="presentation" class="inv-shell" width="100%" cellpadding="0" cellspacing="0" style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid ${HAIR};border-top:3px solid ${cancelled ? '#b91c1c' : ACCENT};border-radius:6px;font-family:${FONT};">
<tr><td style="padding:0 36px;">`);

  /* header */
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="padding:30px 0 22px;">
    <div style="font-size:21px;font-weight:800;letter-spacing:.14em;color:${INK};">3S VERSE</div>
    <div style="font-size:11px;color:${MUTED};letter-spacing:.2em;text-transform:uppercase;margin-top:5px;">Dealer Automation Tools</div>
  </td>
  <td style="padding:30px 0 22px;text-align:right;">
    <div style="font-size:23px;font-weight:700;color:${INK};">INVOICE</div>
    ${badge}
  </td>
</tr></table>
<div style="height:1px;background:${HAIR};"></div>`);

  /* bill-to + meta */
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="padding:22px 0 6px;width:50%;vertical-align:top;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.18em;color:${MUTED};text-transform:uppercase;margin-bottom:8px;">Bill To</div>
    <div style="font-size:15px;font-weight:600;color:${INK};">${esc(data.customer.name) || '—'}</div>
    ${data.customer.company ? `<div style="font-size:13px;color:${MUTED};margin-top:2px;">${esc(data.customer.company)}</div>` : ''}
    ${data.customer.email ? `<div style="font-size:13px;color:${MUTED};margin-top:2px;">${esc(data.customer.email)}</div>` : ''}
  </td>
  <td style="padding:22px 0 6px;width:50%;vertical-align:top;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-left:auto;">
      ${detailRow('Invoice no', data.invoiceNo)}
      ${detailRow('Date', data.date)}
      ${data.validUntil && !paid && !cancelled ? detailRow('Pay by', formatDueLong(data.validUntil)) : ''}
      ${data.orderRef ? detailRow('Order ref', data.orderRef) : ''}
      ${data.paymentNote ? detailRow('Payment', data.paymentNote) : ''}
    </table>
  </td>
</tr></table>`);

  /* items */
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
<tr>
  <th align="left" style="padding:10px 0;border-bottom:2px solid ${INK};font-size:11px;font-weight:700;letter-spacing:.16em;color:${MUTED};text-transform:uppercase;">Description</th>
  <th align="center" style="padding:10px 0;border-bottom:2px solid ${INK};font-size:11px;font-weight:700;letter-spacing:.16em;color:${MUTED};text-transform:uppercase;width:56px;">Qty</th>
  <th align="right" style="padding:10px 0;border-bottom:2px solid ${INK};font-size:11px;font-weight:700;letter-spacing:.16em;color:${MUTED};text-transform:uppercase;width:110px;">Rate</th>
  <th align="right" style="padding:10px 0;border-bottom:2px solid ${INK};font-size:11px;font-weight:700;letter-spacing:.16em;color:${MUTED};text-transform:uppercase;width:120px;">Amount</th>
</tr>
${itemRows}
</table>`);

  /* totals */
  const totalLabel = cancelled ? 'Total (USD)' : paid ? 'Total paid (USD)' : 'Amount due (USD)';
  parts.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="padding:6px 0 26px;vertical-align:bottom;">
    ${data.orderRef ? `<div style="font-size:12px;color:${MUTED};">Reference: ${esc(data.orderRef)}</div>` : ''}
  </td>
  <td style="padding:6px 0 26px;width:290px;vertical-align:top;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:6px 0;font-size:13px;color:${MUTED};">Subtotal (list)</td>
        <td style="padding:6px 0;font-size:13px;color:${INK};text-align:right;">${formatUSD(listSubtotal)}</td>
      </tr>
      ${discount > 0 ? `<tr>
        <td style="padding:6px 0;font-size:13px;color:${ACCENT};font-weight:600;">Launch Offer discount</td>
        <td style="padding:6px 0;font-size:13px;color:${ACCENT};font-weight:600;text-align:right;">−${formatUSD(discount)}</td>
      </tr>` : ''}
      <tr>
        <td style="padding:12px 0 0;border-top:2px solid ${INK};font-size:14px;font-weight:700;color:${INK};">${esc(totalLabel)}</td>
        <td style="padding:12px 0 0;border-top:2px solid ${INK};font-size:20px;font-weight:800;color:${INK};text-align:right;">${formatUSD(total)}</td>
      </tr>
    </table>
  </td>
</tr></table>
${data.validUntil && !paid && !cancelled
    ? `<div id="inv-expire-note" style="font-size:12px;color:${MUTED};text-align:right;margin:-14px 0 22px;">Invoice auto-cancels if unpaid by <strong style="color:${INK};">${esc(formatDueLong(data.validUntil))}</strong>.</div>`
    : ''}`);

  /* keys */
  if (data.keys.length > 0) {
    parts.push(`<div style="height:1px;background:${HAIR};"></div>
<div style="font-size:11px;font-weight:700;letter-spacing:.18em;color:${MUTED};text-transform:uppercase;margin:22px 0 12px;">License Delivery</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${keyBlocks}</table>
<div style="font-size:12px;color:${MUTED};margin:2px 0 24px;">Keys activate on first run on the registered PC(s).</div>`);
  }

  /* notes */
  if (data.notes) {
    parts.push(`<div style="height:1px;background:${HAIR};"></div>
<div style="font-size:11px;font-weight:700;letter-spacing:.18em;color:${MUTED};text-transform:uppercase;margin:22px 0 8px;">Notes</div>
<div style="font-size:13px;line-height:1.6;color:${MUTED};margin:0 0 26px;">${esc(data.notes)}</div>`);
  }

  /* footer */
  parts.push(`<div style="height:1px;background:${HAIR};"></div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="padding:18px 0 30px;font-size:13px;font-weight:600;color:${INK};">Thank you for your business.</td>
  <td style="padding:18px 0 30px;text-align:right;font-size:12px;color:${MUTED};">3S Verse · 3sverse.com · Connect@3sverse.com</td>
</tr></table>`);

  parts.push(`</td></tr></table>`);

  const shell = `<div style="background:#f4f3f8;padding:28px 12px;font-family:${FONT};">${parts.join('\n')}</div>`;
  return shell;
}

/* ===================================================================== */
/*  Full document — standalone HTML file / print-to-PDF / preview.       */
/* ===================================================================== */
export function renderInvoiceDocument(data: InvoiceData): string {
  const title = data.invoiceNo ? `${data.invoiceNo} — 3S Verse Invoice` : '3S Verse Invoice';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}</title>
<style>
  html, body { margin: 0; padding: 0; background: #f4f3f8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4; margin: 10mm; }
  @media print {
    html, body { background: #ffffff; }
    .inv-wrap { padding: 0 !important; }
    .inv-shell { border: none !important; border-radius: 0 !important; }
  }
</style>
</head>
<body>
<div class="inv-wrap" style="padding:28px 12px;">
${renderInvoiceBody(data)}
</div>
${data.status === 'DUE' && data.validUntil
    ? `<script>
(function () {
  /* Auto-cancel check — runs when the invoice FILE is opened in a browser.
     Email clients strip scripts, so the emailed copy stays a static snapshot. */
  try {
    var until = new Date(${JSON.stringify(data.validUntil)}).getTime();
    if (!isFinite(until) || Date.now() <= until) return;
    var badge = document.getElementById('inv-badge');
    if (badge) {
      badge.textContent = 'CANCELLED \u2014 PAYMENT WINDOW EXPIRED';
      badge.style.background = '#fef2f2';
      badge.style.borderColor = '#fecaca';
      badge.style.color = '#b91c1c';
    }
    var note = document.getElementById('inv-expire-note');
    if (note) {
      note.textContent = 'This invoice auto-cancelled \u2014 payment was not received within the window.';
      note.style.color = '#b91c1c';
      note.style.fontWeight = '600';
    }
  } catch (e) { /* never block the invoice view */ }
})();
</script>`
    : ''}
</body>
</html>`;
}

/** Plain-text fallback used when pasting email as text or clipboard is blocked. */
export function plainTextInvoice(data: InvoiceData): string {
  const { discount, total } = invoiceTotals(data.items);
  const state =
    data.status === 'PAID' ? 'PAID' : data.status === 'CANCELLED' ? 'CANCELLED' : 'PAYMENT DUE';
  const lines = [
    `INVOICE ${data.invoiceNo} — 3S Verse (${state})`,
    `Date: ${data.date}`,
    data.status === 'DUE' && data.validUntil
      ? `Pay by: ${formatDueLong(data.validUntil)} (invoice auto-cancels after this date)`
      : '',
    `Order ref: ${data.orderRef || '—'}`,
    `Bill to: ${[data.customer.name, data.customer.company, data.customer.email].filter(Boolean).join(' · ')}`,
    '',
    ...data.items.map(
      (i) =>
        `• ${i.name} — ${i.detail} × ${i.qty} = ${formatUSD(i.unit * i.qty)}` +
        (i.listUnit > i.unit ? ` (list ${formatUSD(i.listUnit * i.qty)})` : ''),
    ),
    discount > 0 ? `Launch Offer discount: −${formatUSD(discount)}` : '',
    `Total ${data.status === 'PAID' ? 'paid' : 'due'}: ${formatUSD(total)} USD`,
    data.paymentNote ? `Payment: ${data.paymentNote}` : '',
    data.keys.length
      ? `License keys:\n${data.keys.map((k) => `  ${k.label ? `${k.label}: ` : ''}${k.key}`).join('\n')}`
      : '',
    data.notes ? `Notes: ${data.notes}` : '',
    '3S Verse · 3sverse.com · Connect@3sverse.com',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

/* ===================================================================== */
/*  Demo sample (also used as the studio "Fill sample" action).          */
/*  Items are derived from the catalog so the sample always matches the  */
/*  current storefront prices.                                           */
/* ===================================================================== */
function sampleItem(productId: string, model: ModelId, seats: SeatsId, qty = 1): InvoiceItem | null {
  return catalogInvoiceItem(productId, model, seats, qty);
}

const sampleItems = [
  sampleItem('bundle', 'lifetime', '5pc'),
  sampleItem('extractor', '1y', '1pc'),
].filter((i): i is InvoiceItem => i !== null);

export const SAMPLE_INVOICE: InvoiceData = {
  invoiceNo: 'INV-K9Q2M7WZ',
  orderRef: '3SV-K9Q2M7WZ',
  date: 'September 20, 2026',
  status: 'PAID',
  customer: {
    name: 'Faisal Ahmed',
    company: 'Bright Star Motors',
    email: 'accounts@brightstarmotors.com',
  },
  paymentNote: 'Direct bank transfer — verified',
  items: sampleItems,
  keys: [
    { label: 'VidaPay Full Bundle', key: '3SV-BNDL-K4T8-9Q2M-7WZ1' },
    { label: 'VidaPay Incentive Extractor', key: '3SV-EXTX-Q7L2-8M4N-1R6T' },
  ],
  notes:
    'License keys activate on first run on the registered PC(s). One bundle key covers every tool on the same license. For support, contact Connect@3sverse.com with your order reference.',
};
