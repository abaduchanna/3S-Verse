import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BadgePercent,
  Check,
  Copy,
  Download,
  FileText,
  KeyRound,
  Loader2,
  Lock,
  MailCheck,
  Minus,
  Plus,
  Printer,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  LAUNCH_OFFER,
  MODELS,
  PAID_DOWNLOAD,
  PC_MIN,
  PER_PC_NOTE,
  PRODUCTS,
  TRIAL_DOWNLOAD,
  TURNSTILE_SITE_KEY,
  discountPercent,
  formatUSD,
  isRecurringModel,
  listPrice,
  modelBillingNote,
  modelPriceSuffix,
  nextVolumeTier,
  pcAllowedForModel,
  pcLabel,
  perPcPrice,
  trialDownloadUrl,
  unitPrice,
  volumeTier,
  type ModelId,
} from '@/lib/catalog';
import { TurnstileWidget } from '@/components/TurnstileWidget';
import { buildOrderInvoice } from '@/lib/autoinvoice';
import {
  formatDueLong,
  renderInvoiceDocument,
  type InvoiceData,
} from '@/lib/invoice';
import { emailInvoiceHtml, emailjsConfigured } from '@/lib/notify';

const ORDER_EMAIL = 'connect@3sverse.com';

interface Line {
  productId: string;
  model: ModelId;
  pcs: number;
  qty: number;
}

interface OrderResult {
  ref: string;
  totalLabel: string;
  savingsLabel: string;
  viaFallback: boolean;
}

const inputClass =
  'w-full rounded-xl border border-border bg-foreground/[.04] px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-brand-cyan/60';

function pill(active: boolean): string {
  return [
    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200',
    active
      ? 'border bg-white text-[#0b0a10]'
      : 'border border-input text-foreground hover:border-foreground/40 hover:text-foreground',
  ].join(' ');
}

/* Launch-offer urgency strip — live countdown to the REAL enforced pricing
   deadline (audit: scarcity must be tied to an enforced end condition — no
   fabricated inventory counters). Renders nothing once the deadline passes. */
function LaunchBar() {
  const endsAt = LAUNCH_OFFER.active ? Date.parse(LAUNCH_OFFER.endsAt) : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!Number.isFinite(endsAt)) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const msLeft = endsAt - now;
  if (!Number.isFinite(endsAt) || msLeft <= 0) return null;

  const sec = Math.floor(msLeft / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div
      data-testid="launch-bar"
      className="mb-8 rounded-2xl border border-brand-magenta/25 bg-gradient-to-r from-[#e44bd7]/[.08] via-[#78a6ff]/[.06] to-[#6ee7ef]/[.08] px-5 py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-2.5">
          <BadgePercent className="h-4 w-4 shrink-0 text-brand-magenta" />
          <p className="text-[13.5px] font-medium text-foreground">
            Launch pricing ends Oct 31 — <span className="text-brand-magenta">list prices return Nov 1.</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 font-mono-tech" data-testid="launch-countdown">
          {[
            [days, 'd'],
            [hours, 'h'],
            [mins, 'm'],
            [secs, 's'],
          ].map(([v, u]) => (
            <span
              key={u as string}
              className="min-w-[44px] rounded-lg border border-border bg-muted px-2 py-1 text-center text-[13px] font-semibold text-foreground"
            >
              {pad(v as number)}
              <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{u}</span>
            </span>
          ))}
        </div>
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[12px] font-light leading-5 text-muted-foreground">
        {LAUNCH_OFFER.note} Every license also carries the 30-day money-back guarantee —{' '}
        <a href="#/refund" className="underline decoration-foreground/30 underline-offset-2 hover:text-foreground">refund policy</a>.
      </p>
    </div>
  );
}

export default function DealerStore() {
  const [selections, setSelections] = useState<Record<string, { model: ModelId; pcs: number }>>(
    Object.fromEntries(
      PRODUCTS.map((p) => [p.id, { model: 'lifetime' as ModelId, pcs: 1 }]),
    ),
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [form, setForm] = useState({ name: '', email: '', company: '', messenger: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OrderResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [invoiceEmailed, setInvoiceEmailed] = useState(false);
  const [cfToken, setCfToken] = useState('');
  const [cfResetCount, setCfResetCount] = useState(0);
  /* Paid-customer re-download box (order-number gated FULL builds). */
  const [paidRef, setPaidRef] = useState('');
  const [paidProduct, setPaidProduct] = useState('bundle');
  const [paidBusy, setPaidBusy] = useState(false);
  const [paidError, setPaidError] = useState('');

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const product = PRODUCTS.find((p) => p.id === l.productId);
        return product ? sum + unitPrice(product, l.model, l.pcs) * l.qty : sum;
      }, 0),
    [lines],
  );

  const savings = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const product = PRODUCTS.find((p) => p.id === l.productId);
        return product
          ? sum +
              (listPrice(product, l.model, l.pcs) - unitPrice(product, l.model, l.pcs)) * l.qty
          : sum;
      }, 0),
    [lines],
  );

  /* Distinct products in the cart that include a free trial. */
  const trialProductIds = useMemo(
    () => Array.from(new Set(lines.filter((l) => l.model === 'trial').map((l) => l.productId))),
    [lines],
  );

  /* Paid-customer download: verify the order number through the gateway
     worker (which checks the license ledger) and stream the FULL build.
     Without a deployed gateway we fall back to a pre-filled email so the
     customer is never stranded. */
  const paidDownload = () => {
    const ref = paidRef.trim().toUpperCase();
    if (!ref) {
      setPaidError('Enter the order number from your invoice (it looks like 3SV-…).');
      return;
    }
    if (!PAID_DOWNLOAD.gatewayUrl) {
      window.location.href =
        `mailto:${PAID_DOWNLOAD.contactEmail}` +
        `?subject=${encodeURIComponent(`Download request — order ${ref}`)}` +
        `&body=${encodeURIComponent(
          `Order number: ${ref}\nProduct: ${paidProduct}\n\n` +
            'Please resend my download link (paid customers get every update free).',
        )}`;
      return;
    }
    setPaidBusy(true);
    setPaidError('');
    const url = `${PAID_DOWNLOAD.gatewayUrl}?order=${encodeURIComponent(ref)}&product=${encodeURIComponent(paidProduct)}`;
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => setPaidBusy(false), 1200);
  };

  const setSelection = (productId: string, patch: Partial<{ model: ModelId; pcs: number }>) => {
    setSelections((prev) => {
      const next = { ...prev[productId], ...patch };
      if (patch.model !== undefined && !pcAllowedForModel(next.model, next.pcs)) next.pcs = 1;
      return { ...prev, [productId]: next };
    });
  };

  const setPcs = (productId: string, pcs: number) => {
    const sel = selections[productId];
    const model = sel?.model ?? 'lifetime';
    const clamped = Math.max(PC_MIN, Math.min(50, Math.round(Number.isFinite(pcs) ? pcs : 1)));
    setSelection(productId, { pcs: model === 'trial' ? 1 : clamped });
  };

  const addLine = (productId: string) => {
    const sel = selections[productId];
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.productId === productId && l.model === sel.model && l.pcs === sel.pcs,
      );
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, qty: Math.min(10, l.qty + 1) } : l,
        );
      }
      return [...prev, { productId, model: sel.model, pcs: sel.pcs, qty: 1 }];
    });
  };

  const changeQty = (index: number, delta: number) => {
    setLines((prev) =>
      prev
        .map((l, i) => (i === index ? { ...l, qty: Math.min(10, Math.max(0, l.qty + delta)) } : l))
        .filter((l) => l.qty > 0),
    );
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const orderSummaryText = (res: OrderResult) =>
    [
      `Order ${res.ref} — 3S Verse Dealer Store`,
      ...lines.map((l) => {
        const product = PRODUCTS.find((p) => p.id === l.productId);
        if (!product) return '';
        return `• ${product.name} · ${MODELS.find((m) => m.id === l.model)?.label} · ${
          pcLabel(l.pcs)
        } × ${l.qty} — ${formatUSD(unitPrice(product, l.model, l.pcs) * l.qty)}`;
      }),
      `Total: ${res.totalLabel}`,
      res.savingsLabel ? `Launch offer: ${res.savingsLabel} saved vs list` : '',
      `Name: ${form.name}`,
      `Email: ${form.email}`,
      form.company ? `Company: ${form.company}` : '',
      form.messenger ? `Telegram/WhatsApp: ${form.messenger}` : '',
      form.notes ? `Notes: ${form.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  const copyOrderSummary = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(orderSummaryText(result));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the summary stays visible on screen */
    }
  };

  /* ---------- auto invoice actions ---------- */
  const downloadInvoice = () => {
    if (!invoice) return;
    const blob = new Blob([renderInvoiceDocument(invoice)], {
      type: 'text/html;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoice.invoiceNo || '3SVerse-invoice'}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const openInvoicePdf = () => {
    if (!invoice) return;
    // Open the print-ready invoice in a new tab; the browser's print dialog
    // saves it as PDF. A floating button re-opens the dialog any time.
    const doc = renderInvoiceDocument(invoice).replace(
      '</body>',
      `<div onclick="window.print()" style="position:fixed;top:14px;right:14px;z-index:99;background:#0e7c8c;color:#fff;font:600 13px/1.2 -apple-system,'Segoe UI',Roboto,sans-serif;padding:11px 18px;border-radius:999px;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.28);">Save as PDF / Print</div>` +
        `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.print()}catch(e){}},700);});</` + `script>`,
    );
    const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || lines.length === 0) return;
    if (TURNSTILE_SITE_KEY && !cfToken) {
      setError('Complete the verification box first, then place the order.');
      return;
    }
    setSubmitting(true);
    setError('');

    const ref = `3SV-${Date.now().toString(36).toUpperCase()}`;
    // The order IS the invoice: auto-build it from the exact lines the
    // customer picked, so no manual invoice step is ever needed.
    const autoInvoice = buildOrderInvoice({
      ref,
      name: form.name.trim(),
      company: form.company.trim(),
      email: form.email.trim(),
      notes: form.notes.trim(),
      lines,
    });
    const placed = (viaFallback: boolean): OrderResult => ({
      ref,
      totalLabel: formatUSD(total),
      savingsLabel: savings > 0 ? formatUSD(savings) : '',
      viaFallback,
    });
    const summary = orderSummaryText(placed(false));

    // File the order into the license-ledger inbox (Cloudflare worker →
    // vidapay-license-server/ledger/orders_inbox/<ref>.json) so the
    // License Studio "Orders" tab shows it to the seller live. Best-effort
    // and fire-and-forget: the FormSubmit email below stays as the backup
    // channel and must never be blocked by this call.
    if (PAID_DOWNLOAD.orderInboxUrl) {
      void fetch(PAID_DOWNLOAD.orderInboxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref,
          name: form.name.trim(),
          email: form.email.trim(),
          company: form.company.trim(),
          messenger: form.messenger.trim(),
          notes: form.notes.trim(),
          items: lines.map((l) => ({
            productId: l.productId,
            model: l.model,
            pcs: l.pcs,
            qty: l.qty,
          })),
          total,
          totalLabel: formatUSD(total),
          ...(cfToken ? { turnstileToken: cfToken } : {}),
        }),
      }).catch(() => null);
    }

    // Static hosting (GitHub Pages) has no server functions, so orders go
    // through FormSubmit — the same relay the contact form uses. The very
    // first submission emails a one-time activation link to the seller inbox.
    const fields: Record<string, string> = {
      order_ref: ref,
      name: form.name.trim().slice(0, 120),
      email: form.email.trim().slice(0, 254),
      company: form.company.trim().slice(0, 160),
      messenger: form.messenger.trim().slice(0, 120),
      notes: form.notes.trim().slice(0, 1000),
      ...Object.fromEntries(
        lines.map((l, i) => {
          const product = PRODUCTS.find((p) => p.id === l.productId);
          if (!product) return [`item_${i + 1}`, 'unknown item'];
          const discounted = discountPercent(product, l.model, l.pcs) > 0;
          return [
            `item_${i + 1}`,
            `${product.name} · ${MODELS.find((m) => m.id === l.model)?.label} · ${
              pcLabel(l.pcs)
            } × ${l.qty} = ${formatUSD(unitPrice(product, l.model, l.pcs) * l.qty)}` +
              (discounted
                ? ` (list ${formatUSD(listPrice(product, l.model, l.pcs) * l.qty)})`
                : ''),
          ];
        }),
      ),
      total_usd: formatUSD(total),
      launch_offer:
        savings > 0 ? `applied — customer saves ${formatUSD(savings)} vs list` : 'n/a',
      _subject: `License order ${ref} — ${formatUSD(total)}`,
      _template: 'table',
      _captcha: 'false',
      _replyto: form.email.trim().slice(0, 254),
    };

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 10000);
      let response: Response;
      let payload: { success?: string } | null = null;
      try {
        response = await fetch(`https://formsubmit.co/ajax/${ORDER_EMAIL}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fields),
          signal: controller.signal,
        });
        payload = (await response.json().catch(() => null)) as { success?: string } | null;
      } finally {
        window.clearTimeout(timeoutId);
      }
      if (!response.ok || payload?.success !== 'true') throw new Error('order relay failed');
      setInvoice(autoInvoice);
      setResult(placed(false));
      // Auto-email the invoice to the customer (EmailJS). Fire-and-forget:
      // the success screen must never wait on the mail relay.
      if (emailjsConfigured()) {
        void emailInvoiceHtml({
          to: autoInvoice.customer.email,
          name: autoInvoice.customer.name,
          invoiceNo: autoInvoice.invoiceNo,
          orderRef: autoInvoice.orderRef,
          totalLabel: formatUSD(total),
          html: renderInvoiceDocument(autoInvoice),
        }).then((ok) => setInvoiceEmailed(ok));
      }
    } catch {
      // Relay unreachable — never lose the order: hand it to the visitor's
      // own email client with everything pre-filled.
      try {
        window.location.href = `mailto:${ORDER_EMAIL}?subject=${encodeURIComponent(
          fields._subject,
        )}&body=${encodeURIComponent(summary)}`;
      } catch {
        /* mailto blocked — the order summary is still on screen */
      }
      setInvoice(autoInvoice);
      setResult(placed(true));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-16">
      <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-3 flex items-center gap-2 font-mono-tech text-[10px] uppercase tracking-[.22em] text-brand-magenta">
            <ShoppingCart className="h-3.5 w-3.5" /> Buy licenses — monthly, annual, or own it forever
          </p>
          <h3 className="text-[clamp(1.7rem,2.6vw,2.5rem)] font-light leading-[1.08] tracking-[-0.02em] text-foreground">
            Dealer license store
          </h3>
        </div>
        <p className="max-w-md text-[14px] font-light leading-6 text-foreground/75">
          {LAUNCH_OFFER.active ? (
            <span className="text-brand-cyan">{LAUNCH_OFFER.label} — {LAUNCH_OFFER.note} </span>
          ) : null}
          Start with the free 7-day trial. Then pay the way your cash flow likes: <span className="text-foreground">monthly $89, cancel anytime</span>, <span className="text-foreground">annual (save 44%)</span>, or <span className="text-foreground">one-time lifetime</span> — founding-customer pricing, pay once. USD billing — bank transfer, Wise, PayPal, or USDT. Keys are delivered after payment confirmation.
        </p>
      </div>
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-2xl border border-border bg-foreground/[.02] px-5 py-3.5 font-mono-tech text-[10px] uppercase tracking-[.16em] text-muted-foreground">
        <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-brand-cyan" /> Secure SSL checkout</span>
        <span className="flex items-center gap-2"><Undo2 className="h-3.5 w-3.5 text-brand-cyan" /> 30-day money-back guarantee</span>
        <span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-brand-cyan" /> Machine-locked licenses</span>
        <span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-brand-cyan" /> PayPal protected</span>
        <span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-brand-cyan" /> Support on WhatsApp &amp; email</span>
      </div>

      <LaunchBar />
      <p className="mb-8 -mt-4 max-w-3xl text-[12.5px] font-light leading-5.5 text-muted-foreground">
        {PER_PC_NOTE}
      </p>

      {/* Paid-customer re-download — order number is checked against the
          license ledger before a FULL build is served. */}
      <div className="mb-10 rounded-2xl border border-border bg-foreground/[.02] p-5">
        <p className="mb-1 flex items-center gap-2 text-[14px] font-medium text-foreground">
          <KeyRound className="h-4 w-4 text-brand-cyan" /> Already purchased? Re-download your
          software
        </p>
        <p className="mb-4 text-[13px] font-light leading-5 text-muted-foreground">
          Enter the order number printed on your invoice — we verify your package (1-year or
          lifetime) before the FULL build downloads. Updates are always free for paying
          customers.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass + ' sm:max-w-[250px]'}
            placeholder="Order number — 3SV-…"
            value={paidRef}
            onChange={(e) => {
              setPaidRef(e.target.value);
              setPaidError('');
            }}
          />
          <select
            className={inputClass + ' sm:max-w-[260px] [&>option]:bg-card'}
            value={paidProduct}
            onChange={(e) => setPaidProduct(e.target.value)}
            aria-label="Product to download"
          >
            {PRODUCTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={paidDownload}
            disabled={paidBusy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-3 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {paidBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {PAID_DOWNLOAD.label}
          </button>
        </div>
        {paidError ? <p className="mt-2 text-[12.5px] text-amber-700 dark:text-amber-300">{paidError}</p> : null}
        {!PAID_DOWNLOAD.gatewayUrl ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Press the button and your email app opens the request to {PAID_DOWNLOAD.contactEmail}{' '}
            — we verify your order number and reply with your download link, usually within a few hours.
          </p>
        ) : null}
      </div>

      {result ? (
        <div className="rounded-3xl border border-brand-cyan/25 bg-card p-8 sm:p-10">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#6ee7ef]/15 text-brand-cyan">
              <Check className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[17px] font-medium text-foreground">Order placed — {result.ref}</p>
              <p className="text-[13.5px] text-foreground/75">
                Total {result.totalLabel} · your invoice is ready below · a copy of these details
                was sent to the 3S Verse team.
              </p>
            </div>
          </div>
          {result.viaFallback ? (
            <p className="mb-6 rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-4 py-3 text-[13px] text-amber-700/90 dark:text-amber-700 dark:text-amber-200/90">
              Your email app just opened with the order pre-filled — press send there so the order
              reaches us.
            </p>
          ) : null}
          <p className="mb-2 text-[13px] font-medium uppercase tracking-[.14em] text-muted-foreground">
            What happens next
          </p>
          <ol className="mb-6 max-w-2xl space-y-2.5 text-[14px] font-light leading-6 text-foreground/75">
            <li className="flex gap-2.5">
              <span className="font-mono-tech text-brand-cyan">1.</span> Your invoice is ready right
              here — download it or open the PDF version below (it is also emailed to you).
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono-tech text-brand-cyan">2.</span> You pay within the due
              window (bank transfer, Wise, PayPal, or USDT) and share the payment receipt with us.
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono-tech text-brand-cyan">3.</span> Your license key(s) +
              download links are delivered — usually within a few hours.
            </li>
          </ol>
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-brand-cyan/20 bg-[#6ee7ef]/[.05] px-4 py-3">
            <Download className="h-4 w-4 shrink-0 text-brand-cyan" />
            <p className="text-[13px] leading-5 text-foreground/90">
              Save your free re-download link — it always serves the newest
              build, so future updates cost nothing:
            </p>
            <a
              href={`/order/${result.ref}`}
              data-testid="link-re-download"
              className="text-[13px] font-semibold text-brand-cyan underline decoration-brand-cyan/40 underline-offset-2 hover:text-foreground"
            >
              3sverse.com/order/{result.ref}
            </a>
          </div>
          {lines.some((l) => isRecurringModel(l.model)) ? (
            <p className="mb-6 rounded-xl border border-brand-periwinkle/20 bg-[#78a6ff]/[.05] px-4 py-3 text-[13px] text-foreground/90">
              Your order includes a monthly or annual plan — it renews automatically and you can
              cancel or switch to lifetime anytime by replying to the invoice email. No lock-in.
            </p>
          ) : null}
          {invoice ? (
            <div
              data-testid="auto-invoice-card"
              className="mb-6 rounded-xl border border-border bg-foreground/[.03] p-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <FileText className="h-4 w-4 text-brand-cyan" />
                <p className="text-[14px] font-medium text-foreground">
                  Invoice {invoice.invoiceNo} — ready
                </p>
                {invoiceEmailed ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#6ee7ef]/10 px-2.5 py-1 text-[12px] font-medium text-brand-cyan">
                    <MailCheck className="h-3.5 w-3.5" /> emailed to {invoice.customer.email}
                  </span>
                ) : null}
              </div>
              <p className="mb-3 text-[13px] font-light text-foreground/75">
                Amount due {result.totalLabel}
                {invoice.validUntil ? ` · pay by ${formatDueLong(invoice.validUntil)}` : ''} — the
                invoice auto-cancels if unpaid by then.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={openInvoicePdf}
                  className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                >
                  <Printer className="h-4 w-4" /> Open PDF (new tab)
                </button>
                <button
                  type="button"
                  onClick={downloadInvoice}
                  className="inline-flex items-center gap-2 rounded-xl border border-input px-4 py-2.5 text-[13.5px] font-medium text-foreground transition-colors hover:border-foreground/40"
                >
                  <Download className="h-4 w-4" /> Download invoice
                </button>
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                PDF opens print-ready in a new tab — choose “Save as PDF”. Keep it for your
                accounts.
              </p>
            </div>
          ) : null}
          {result.savingsLabel ? (
            <p className="mb-6 flex items-center gap-2 text-[13.5px] text-brand-cyan">
              <BadgePercent className="h-4 w-4" /> Launch offer applied — you save{' '}
              {result.savingsLabel} vs list price.
            </p>
          ) : null}
          {trialProductIds.length > 0 ? (
            <div
              data-testid="trial-download-success"
              className="mb-6 rounded-xl border border-brand-cyan/30 bg-[#6ee7ef]/[.06] p-4"
            >
              <p className="text-[14px] font-medium text-foreground">Your order includes a free trial.</p>
              <p className="mb-3 mt-1 text-[13px] font-light leading-5 text-foreground/75">{TRIAL_DOWNLOAD.note}</p>
              <div className="flex flex-wrap gap-2.5">
                {trialProductIds.map((pid) => {
                  const product = PRODUCTS.find((p) => p.id === pid);
                  return (
                    <a
                      key={pid}
                      href={trialDownloadUrl(pid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                    >
                      <Download className="h-4 w-4" />
                      <span className="min-w-0">{product ? product.name : 'Trial'} — trial</span>
                    </a>
                  );
                })}
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                The 7-day clock starts on first run — always the newest build, no stale links.
              </p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={copyOrderSummary}
            className="inline-flex items-center gap-2 rounded-xl border border-input px-5 py-3 text-[14px] font-medium text-foreground transition-colors hover:border-foreground/40"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy order summary'}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {PRODUCTS.map((product) => {
            const sel = selections[product.id];
            const price = unitPrice(product, sel.model, sel.pcs);
            const list = listPrice(product, sel.model, sel.pcs);
            const pct = discountPercent(product, sel.model, sel.pcs);
            const tier = volumeTier(sel.pcs);
            const nextTier = nextVolumeTier(sel.pcs);
            return (
              <div
                key={product.id}
                className="flex flex-col rounded-3xl border border-border bg-card p-6"
              >
                <h4 className="text-[16.5px] font-medium leading-snug text-foreground">{product.name}</h4>
                <p className="mt-1.5 text-[13px] font-light leading-5 text-muted-foreground">
                  {product.tagline}
                </p>
                <ul className="mt-4 flex-1 space-y-2">
                  {product.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[12.5px] font-light leading-5 text-foreground">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={pill(sel.model === m.id)}
                        onClick={() => setSelection(product.id, { model: m.id })}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Fewer PCs"
                      data-testid={`pcs-minus-${product.id}`}
                      disabled={sel.model === 'trial' || sel.pcs <= PC_MIN}
                      className={[pill(false), 'px-3', sel.model === 'trial' || sel.pcs <= PC_MIN ? 'cursor-not-allowed opacity-30' : ''].join(' ')}
                      onClick={() => setPcs(product.id, sel.pcs - 1)}
                    >
                      −
                    </button>
                    <span
                      data-testid={`pcs-value-${product.id}`}
                      className="min-w-[72px] text-center text-[14px] font-medium text-foreground"
                    >
                      {pcLabel(sel.pcs)}
                    </span>
                    <button
                      type="button"
                      aria-label="More PCs"
                      data-testid={`pcs-plus-${product.id}`}
                      disabled={sel.model === 'trial'}
                      className={[pill(false), 'px-3', sel.model === 'trial' ? 'cursor-not-allowed opacity-30' : ''].join(' ')}
                      onClick={() => setPcs(product.id, sel.pcs + 1)}
                    >
                      +
                    </button>
                    {sel.model === 'trial' ? (
                      <span className="text-[12px] text-muted-foreground">trials are 1 PC</span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        max={50}
                        aria-label="Number of PCs"
                        value={sel.pcs}
                        onChange={(e) => setPcs(product.id, Number(e.target.value))}
                        className="w-[64px] rounded-lg border border-border bg-foreground/[.04] px-2 py-1.5 text-center text-[13px] text-foreground outline-none focus:border-brand-cyan/60 [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    )}
                  </div>
                  {sel.model !== 'trial' ? (
                    <p className="text-[12px] leading-4 text-muted-foreground">
                      {tier.offPct > 0 ? (
                        <span className="text-brand-cyan">{tier.label} included</span>
                      ) : (
                        '1 license, runs on as many PCs as you pick'
                      )}
                      {nextTier ? ` — ${nextTier.min - sel.pcs} more PC${nextTier.min - sel.pcs === 1 ? '' : 's'} → ${nextTier.offPct}% off per PC` : ''}
                    </p>
                  ) : null}
                  {sel.model === 'trial' && trialDownloadUrl(product.id) ? (
                    <a
                      href={trialDownloadUrl(product.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`trial-download-${product.id}`}
                      className="flex items-center gap-2 rounded-xl border border-brand-cyan/30 bg-[#6ee7ef]/[.06] px-4 py-2.5 text-[13px] font-medium text-brand-cyan transition-colors hover:border-brand-cyan/60"
                    >
                      <Download className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">{TRIAL_DOWNLOAD.label}</span>
                    </a>
                  ) : null}
                  <div className="flex items-end justify-between border-t border-border pt-4">
                    <div>
                      {pct > 0 ? (
                        <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-md bg-[#6ee7ef]/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[.12em] text-brand-cyan">
                          <BadgePercent className="h-3 w-3" /> {LAUNCH_OFFER.label} −{pct}%
                        </p>
                      ) : null}
                      <p className="text-[26px] font-light leading-none text-foreground">
                        {price === 0 ? 'Free' : formatUSD(price)}
                        <span className="text-[14px] text-muted-foreground">{modelPriceSuffix(sel.model)}</span>
                        {pct > 0 ? (
                          <span className="ml-2 text-[14px] text-muted-foreground line-through">
                            {formatUSD(list)}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {sel.model === 'trial'
                          ? '7 days · 1 PC · no card needed'
                          : `${formatUSD(perPcPrice(product, sel.model, sel.pcs))} per PC · ${modelBillingNote(sel.model)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addLine(product.id)}
                      className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                    >
                      <Plus className="h-4 w-4" /> Add
                    </button>
                  </div>
                  {/* trust row — right under the buy decision (audit: zero
                      reassurance at the point of purchase kills conversion) */}
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-1 text-[12px] font-medium text-muted-foreground">
                    <span className="flex items-center gap-1"><Lock className="h-3 w-3 text-brand-cyan" /> Secure payment</span>
                    <span className="flex items-center gap-1"><Undo2 className="h-3 w-3 text-brand-cyan" /> 30-day money-back</span>
                    <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-brand-cyan" /> PayPal accepted</span>
                  </div>
                  {/* value line — audit: dealers compare daily costs, not
                      sticker prices; anchor the price against the leakage */}
                  {sel.model !== 'trial' && price > 0 ? (
                    <p className="pt-0.5 text-[12px] font-light leading-5 text-muted-foreground" data-testid={`value-line-${product.id}`}>
                      {sel.model === 'monthly'
                        ? `≈ ${formatUSD(Math.max(1, Math.round(price / 30)))}/day — a fraction of one month’s missed rebates. Cancel anytime.`
                        : sel.model === 'annual'
                          ? `≈ ${formatUSD(Math.max(1, Math.round(price / 365)))}/day — billed once a year, every update included.`
                          : 'One payment — can pay for itself within the first months of captured rebates; run the ROI calculator above with your own numbers.'}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!result ? (
        <p className="mt-5 text-[13px] font-light text-muted-foreground">
          Pick exactly how many PCs you need — 2–4 PCs get 10% off per PC and 5–9 get 20%,
          applied automatically on every billing model. Monthly plans cancel anytime; annual
          saves 30%; lifetime is a founding-customer option. Need 10 or more PCs, or central
          billing for a whole district? Message us for a quote and we will set it up.
        </p>
      ) : null}

      {!result && lines.length > 0 ? (
        <form
          onSubmit={submit}
          className="mt-8 rounded-3xl border border-border bg-card p-6 sm:p-8"
        >
          <p className="mb-4 text-[13px] font-medium uppercase tracking-[.14em] text-muted-foreground">
            Your order
          </p>
          <div className="mb-6 space-y-2">
            {lines.map((line, index) => {
              const product = PRODUCTS.find((p) => p.id === line.productId)!;
              const lineTotal = unitPrice(product, line.model, line.pcs) * line.qty;
              return (
                <div
                  key={`${line.productId}|${line.model}|${line.pcs}`}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-foreground/[.02] px-4 py-3"
                >
                  <span className="min-w-0 flex-1 text-[14px] text-foreground">
                    {product.name}
                    <span className="ml-2 text-[12px] text-muted-foreground">
                      {MODELS.find((m) => m.id === line.model)?.label} ·{' '}
                      {pcLabel(line.pcs)}
                    </span>
                  </span>
                  <span className="font-mono-tech text-[13px] text-foreground">
                    {formatUSD(lineTotal)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => changeQty(index, -1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-input text-foreground hover:border-foreground/40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-[14px] text-foreground">{line.qty}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => changeQty(index, 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-input text-foreground hover:border-foreground/40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => removeLine(index)}
                      className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg border border-input text-brand-magenta hover:border-brand-magenta/60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {savings > 0 ? (
              <div className="flex items-center justify-between px-1 pt-1">
                <span className="flex items-center gap-1.5 text-[13px] text-brand-cyan">
                  <BadgePercent className="h-3.5 w-3.5" /> {LAUNCH_OFFER.label} — you save
                </span>
                <span className="text-[14px] font-medium text-brand-cyan">
                  {formatUSD(savings)}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-[14px] text-foreground/75">Total (USD)</span>
              <span className="text-[20px] font-light text-foreground">{formatUSD(total)}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-foreground/75">Name *</span>
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
                placeholder="Full name"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-foreground/75">Email *</span>
              <input
                required
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={inputClass}
                placeholder="you@company.com"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-foreground/75">
                Company
              </span>
              <input
                maxLength={160}
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className={inputClass}
                placeholder="Store / company name"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-foreground/75">
                Telegram / WhatsApp
              </span>
              <input
                maxLength={120}
                value={form.messenger}
                onChange={(e) => setForm({ ...form, messenger: e.target.value })}
                className={inputClass}
                placeholder="@handle or number"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[12.5px] font-medium text-foreground/75">Notes</span>
              <textarea
                maxLength={1000}
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className={inputClass}
                placeholder="Anything we should know"
              />
            </label>
          </div>

          {error ? (
            <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-4 py-3 text-[13.5px] text-rose-700 dark:text-rose-200">
              {error}
            </p>
          ) : null}

          {TURNSTILE_SITE_KEY && <TurnstileWidget key={cfResetCount} onToken={setCfToken} />}

          <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-brand-cyan" />
              Licenses are machine-locked · keys delivered after payment confirmation
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-6 py-3 text-[15px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              {submitting ? 'Placing order…' : `Place order — ${formatUSD(total)}`}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
