/**
 * Invoice Studio — 3sverse.com/#/invoice
 *
 * Seller-only page (unlisted): fill in the paid order details, preview the
 * branded invoice, then send it to the customer as PDF (print), standalone
 * HTML, or a rich-text email paste. The EXACT same rendered format goes to
 * the customer every time — amounts come straight from the catalog, so the
 * invoice always matches the storefront (launch offer included).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  Copy,
  Dices,
  Download,
  FileText,
  Mail,
  Plus,
  Printer,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Wand2,
} from 'lucide-react';
import { MODELS, PRODUCTS, PC_MAX, formatUSD, pcAllowedForModel, pcLabel, type ModelId } from '@/lib/catalog';
import {
  SAMPLE_INVOICE,
  INVOICE_DUE_DAYS,
  catalogInvoiceItem,
  dueDateISO,
  invoiceNumberFromRef,
  invoiceTotals,
  parseKeysText,
  plainTextInvoice,
  renderInvoiceBody,
  renderInvoiceDocument,
  todayLong,
  type InvoiceData,
  type InvoiceItem,
  type InvoiceStatus,
} from '@/lib/invoice';
import {
  emailjsConfigured,
  emailjsEffectiveConfig,
  emailjsSaveConfig,
  emailjsSendTest,
} from '@/lib/notify';

const DEFAULT_NOTES =
  'License keys activate on first run on the registered PC(s). For support, contact Connect@3sverse.com with your order reference.';

/* Order-number generator alphabet — no I/L/O/0/1 so digits and letters are
   never confused when a customer reads the ref off their invoice. */
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/* Exact template content to paste into the EmailJS template editor.
   TRIPLE braces around invoice_html are required — they make EmailJS
   insert the invoice as raw HTML instead of escaped text. */
const EMAILJS_TEMPLATE_SUBJECT = 'Invoice {{invoice_no}} — 3S Verse (order {{order_ref}})';
const EMAILJS_TEMPLATE_CONTENT = `Hi {{customer_name}},

Your 3S Verse invoice is ready — total {{total_label}}.
Pay within the due window shown on the invoice (bank transfer, Wise, PayPal, or USDT). After payment we deliver your license keys within a few hours.

{{{invoice_html}}}

3S Verse · 3sverse.com`;

const inputClass =
  'w-full rounded-xl border border-border bg-foreground/[.04] px-4 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-brand-cyan/60';
/* Same as inputClass but without w-full — avoids the width conflict when a
   fixed width is layered on top inside flex rows (w-full wins by stylesheet
   order and squeezes the other flex children). */
const fieldClass =
  'rounded-xl border border-border bg-foreground/[.04] px-4 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-brand-cyan/60 [&>option]:bg-card';
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[.16em] text-muted-foreground';

/* ------------------------------------------------------------------
 * SELLER GATE — Invoice Studio is the seller's tool, not a public page.
 * The footer link was removed; this passcode screen is the second lock
 * for anyone typing the raw URL. Only the SHA-256 hash ships in the
 * bundle, not the passcode itself. To change the passcode, replace
 * GATE_HASH with: python3 -c "import hashlib;print(hashlib.sha256(b'YOUR NEW PASSCODE').hexdigest())"
 * (current default passcode: 3SV-INVOICE-2026 — change it after first
 * login is fine, the gate reads the hash every attempt).
 * The gate stops casual access; real money movement is gated server-side
 * (worker secrets + ledger), which is where actual security lives.
 * ------------------------------------------------------------------ */
const GATE_KEY = '3sv_invoice_gate';
const GATE_HASH = '96fc56d564312cd91231b4c5a3c47f9c2068f0402173625c65dbb501d3d84fb2';

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function InvoiceGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6" data-testid="invoice-gate">
      <form
        className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-2xl"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(false);
          const hex = await sha256Hex(value.trim());
          if (hex === GATE_HASH) {
            try { sessionStorage.setItem(GATE_KEY, 'ok'); } catch { /* private mode */ }
            onUnlock();
          } else {
            setError(true);
            setBusy(false);
          }
        }}
      >
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-foreground/[.04]">
          <ShieldCheck className="h-6 w-6 text-brand-cyan" />
        </div>
        <h1 className="text-[17px] font-semibold text-foreground">Invoice Studio</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
          Seller area. Enter the passcode to continue — customers never need this page.
        </p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          className={inputClass + ' mt-5'}
          placeholder="Passcode"
          aria-label="Invoice Studio passcode"
          data-testid="invoice-gate-input"
        />
        {error ? (
          <p className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-4 py-2.5 text-[13px] text-rose-700 dark:text-rose-200" data-testid="invoice-gate-error">
            Wrong passcode. Try again.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || value.length === 0}
          className="mt-5 w-full rounded-xl bg-foreground px-4 py-2.5 text-[13.5px] font-semibold text-background transition-opacity disabled:opacity-40"
          data-testid="invoice-gate-submit"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

interface Row {
  productId: string;
  model: ModelId;
  pcs: number;
  qty: number;
}

function pill(active: boolean): string {
  return [
    'rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200',
    active
      ? 'border bg-white text-[#0b0a10]'
      : 'border border-input text-foreground hover:border-foreground/40 hover:text-foreground',
  ].join(' ');
}

function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function InvoiceStudio() {
  /* Seller gate — nothing below renders until the passcode is accepted
     (session-scoped: re-entering in a new tab/session asks again). */
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(GATE_KEY) === 'ok'; } catch { return false; }
  });
  const [orderRef, setOrderRef] = useState('');
  const [dateISO, setDateISO] = useState(todayISO());
  const [status, setStatus] = useState<InvoiceStatus>('PAID');
  const [dueDays, setDueDays] = useState(INVOICE_DUE_DAYS);
  const [cancelledRefs, setCancelledRefs] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem('3sv_cancelled_refs') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [keysText, setKeysText] = useState('');
  const [notes, setNotes] = useState(DEFAULT_NOTES);
  const [flash, setFlash] = useState('');
  /* EmailJS setup card state — pre-filled from the effective config. */
  const [emailSvc, setEmailSvc] = useState('');
  const [emailTpl, setEmailTpl] = useState('');
  const [emailKey, setEmailKey] = useState('');
  const [emailTestTo, setEmailTestTo] = useState('');
  const [emailStatus, setEmailStatus] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  useEffect(() => {
    document.title = '3S Verse — Invoice Studio';
    const cfg = emailjsEffectiveConfig();
    setEmailSvc(cfg.serviceId);
    setEmailTpl(cfg.templateId);
    setEmailKey(cfg.publicKey);
  }, []);

  const invoiceNo = invoiceNumberFromRef(orderRef);
  const dateLong = useMemo(() => {
    if (!dateISO) return todayLong();
    const parsed = new Date(`${dateISO}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? todayLong() : todayLong(parsed);
  }, [dateISO]);

  const items = useMemo(
    () =>
      rows
        .map((r) => catalogInvoiceItem(r.productId, r.model, r.pcs, r.qty))
        .filter((i): i is InvoiceItem => i !== null),
    [rows],
  );
  const totals = useMemo(() => invoiceTotals(items), [items]);

  const draft: InvoiceData = useMemo(
    () => ({
      invoiceNo,
      orderRef: orderRef.trim(),
      date: dateLong,
      status,
      /* DUE invoices auto-cancel N days after the invoice date. */
      validUntil:
        status === 'DUE' && dateISO
          ? dueDateISO(dueDays, new Date(`${dateISO}T12:00:00`))
          : undefined,
      customer: { name, company, email },
      paymentNote,
      items,
      keys: parseKeysText(keysText),
      notes,
    }),
    [invoiceNo, orderRef, dateLong, status, dateISO, dueDays, name, company, email, paymentNote, items, keysText, notes],
  );

  const refWasCancelled =
    status !== 'CANCELLED' && orderRef.trim() !== '' && cancelledRefs.includes(orderRef.trim().toUpperCase());

  const previewDoc = useMemo(
    () => (items.length > 0 ? renderInvoiceDocument(draft) : ''),
    [draft, items.length],
  );

  /* Seller gate — render the passcode screen instead of the studio until
     unlocked. Placed after every hook so the hook order stays stable. */
  if (!unlocked) return <InvoiceGate onUnlock={() => setUnlocked(true)} />;

  /* ---------- row helpers ---------- */
  const addRow = () =>
    setRows((prev) => [...prev, { productId: 'bundle', model: 'lifetime', pcs: 1, qty: 1 }]);
  const patchRow = (index: number, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        if (!pcAllowedForModel(next.model, next.pcs)) next.pcs = 1;
        return next;
      }),
    );
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  /* ---------- actions ---------- */
  const showFlash = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(''), 4500);
  };

  /* Fresh unambiguous order number — invoice no follows automatically. */
  const generateOrderRef = () => {
    let suffix = '';
    for (let i = 0; i < 8; i += 1) {
      suffix += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
    }
    setOrderRef(`3SV-${suffix}`);
  };

  const saveEmailConfig = () => {
    emailjsSaveConfig({
      enabled: Boolean(emailSvc.trim() && emailTpl.trim() && emailKey.trim()),
      serviceId: emailSvc.trim(),
      templateId: emailTpl.trim(),
      publicKey: emailKey.trim(),
    });
    setEmailStatus(
      emailjsConfigured()
        ? 'Saved in this browser — automatic invoice emails are ACTIVE.'
        : 'Saved — relay is off until all three IDs are filled.',
    );
    window.setTimeout(() => setEmailStatus(''), 5000);
  };

  const copyTemplateContent = async () => {
    const text = `Subject: ${EMAILJS_TEMPLATE_SUBJECT}\n\n${EMAILJS_TEMPLATE_CONTENT}`;
    try {
      await navigator.clipboard.writeText(text);
      setEmailStatus('Template subject + content copied — paste into the EmailJS template editor.');
    } catch {
      setEmailStatus('Clipboard blocked — copy the template text from EMAILJS_SETUP.md instead.');
    }
    window.setTimeout(() => setEmailStatus(''), 5000);
  };

  const sendTest = async () => {
    setEmailBusy(true);
    const res = await emailjsSendTest(emailTestTo.trim());
    setEmailBusy(false);
    setEmailStatus(
      res.ok
        ? `Test email sent to ${emailTestTo.trim()} — check the inbox (and spam).`
        : `Test failed: ${res.error ?? 'unknown error'}`,
    );
    window.setTimeout(() => setEmailStatus(''), 6000);
  };

  const printInvoice = () => {
    if (!items.length) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.srcdoc = renderInvoiceDocument(draft);
    frame.onload = () => {
      window.setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          /* print blocked — seller can still use Download HTML */
        }
        window.setTimeout(() => frame.remove(), 1500);
      }, 350);
    };
    document.body.appendChild(frame);
    showFlash('Print dialog khul gaya — "Save as PDF" chuno aur customer ko bhej do');
  };

  const downloadHTML = () => {
    if (!items.length) return;
    const blob = new Blob([renderInvoiceDocument(draft)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.invoiceNo || '3SVerse-invoice'}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    showFlash('HTML invoice download ho gayi — customer ko attach kar do');
  };

  const copyForEmail = async () => {
    if (!items.length) return;
    const html = renderInvoiceBody(draft);
    const plain = plainTextInvoice(draft);
    try {
      const scope = window as unknown as { ClipboardItem?: typeof ClipboardItem };
      if (!navigator.clipboard || typeof scope.ClipboardItem !== 'function') {
        throw new Error('clipboard-html-unsupported');
      }
      await navigator.clipboard.write([
        new scope.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      showFlash('Invoice copy ho gayi — Gmail/Outlook mein paste karo, format wohi jayega');
    } catch {
      downloadHTML();
    }
  };

  const fillSample = () => {
    setOrderRef(SAMPLE_INVOICE.orderRef);
    setDateISO(todayISO());
    setStatus(SAMPLE_INVOICE.status);
    setName(SAMPLE_INVOICE.customer.name);
    setCompany(SAMPLE_INVOICE.customer.company);
    setEmail(SAMPLE_INVOICE.customer.email);
    setPaymentNote(SAMPLE_INVOICE.paymentNote);
    setRows(
      SAMPLE_INVOICE.items.map(() => ({
        productId: 'bundle',
        model: 'lifetime' as ModelId,
        pcs: 1,
        qty: 1,
      })),
    );
    // Map sample items back to catalog rows so prices recompute live.
    const rowMap: Row[] = [
      { productId: 'bundle', model: 'lifetime', pcs: 5, qty: 1 },
      { productId: 'extractor', model: 'lifetime', pcs: 1, qty: 1 },
    ];
    setRows(rowMap);
    setKeysText(SAMPLE_INVOICE.keys.map((k) => `${k.label}: ${k.key}`).join('\n'));
    setNotes(SAMPLE_INVOICE.notes);
    showFlash('Sample invoice loaded — edit the form, the preview updates live');
  };

  const canSend = items.length > 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
        {/* header */}
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[.22em] text-muted-foreground">3S Verse</div>
            <h1 className="mt-1 text-[26px] font-bold leading-tight">Invoice Studio</h1>
            <p className="mt-1 text-[14px] text-muted-foreground">
              Order details — this exact format goes to the customer (PDF · HTML · email).
            </p>
          </div>
          <button
            type="button"
            onClick={fillSample}
            className="inline-flex items-center gap-2 rounded-xl border border-input px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Wand2 className="h-4 w-4" /> Fill sample
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[430px,1fr]">
          {/* ---------------- form ---------------- */}
          <section className="rounded-2xl border border-border bg-foreground/[.03] p-5 md:p-6">
            <div className={labelClass}>Order</div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  className={inputClass + ' min-w-0 flex-1'}
                  placeholder="Order ref — 3SV-…"
                  value={orderRef}
                  onChange={(e) => setOrderRef(e.target.value)}
                />
                <button
                  type="button"
                  onClick={generateOrderRef}
                  title="Generate a fresh order number"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-input px-3.5 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <Dices className="h-4 w-4" /> Generate
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="date"
                  className={inputClass}
                  value={dateISO}
                  onChange={(e) => setDateISO(e.target.value)}
                />
                <div className="self-center text-[12px] text-muted-foreground">
                  Invoice no: <span className="font-semibold text-brand-cyan">{invoiceNo || '—'}</span> (auto)
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <span className={labelClass + ' !mb-0'}>Status</span>
              <div className="ml-auto flex gap-2">
                <button type="button" className={pill(status === 'PAID')} onClick={() => setStatus('PAID')}>
                  Paid
                </button>
                <button type="button" className={pill(status === 'DUE')} onClick={() => setStatus('DUE')}>
                  Due
                </button>
                <button
                  type="button"
                  className={pill(status === 'CANCELLED')}
                  onClick={() => {
                    setStatus('CANCELLED');
                    /* remember cancelled order refs on this device so a
                       re-used ref triggers the warning below */
                    const ref = orderRef.trim().toUpperCase();
                    if (ref) {
                      setCancelledRefs((prev) => {
                        const next = prev.includes(ref) ? prev : [...prev, ref];
                        try {
                          window.localStorage.setItem('3sv_cancelled_refs', JSON.stringify(next));
                        } catch {
                          /* private mode — memory only */
                        }
                        return next;
                      });
                    }
                  }}
                >
                  Cancelled
                </button>
              </div>
            </div>
            {status === 'DUE' ? (
              <div className="mt-3 flex items-center gap-2">
                <span className={labelClass + ' !mb-0'}>Auto-cancel after</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={dueDays}
                  onChange={(e) => setDueDays(Math.max(1, Math.min(60, Number(e.target.value) || INVOICE_DUE_DAYS)))}
                  className={fieldClass + ' w-[76px] text-center'}
                />
                <span className="text-[12px] text-muted-foreground">days unpaid (expiry shown on invoice)</span>
              </div>
            ) : null}
            {refWasCancelled ? (
              <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-4 py-2.5 text-[12.5px] text-amber-700/90 dark:text-amber-700 dark:text-amber-200/90">
                Warning: an invoice for order ref ({orderRef.trim().toUpperCase()}) was CANCELLED
                before — double-check before reusing this reference.
              </p>
            ) : null}

            <div className={labelClass + ' mt-5'}>Bill to</div>
            <div className="space-y-3">
              <input className={inputClass} placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <input className={inputClass} placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
                <input className={inputClass} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <input
                className={inputClass}
                placeholder="Payment method — e.g. Direct bank transfer"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
              />
            </div>

            <div className={labelClass + ' mt-5'}>Items (auto-priced from catalog)</div>
            <div className="space-y-3">
              {rows.map((row, index) => {
                const product = PRODUCTS.find((p) => p.id === row.productId);
                return (
                  <div key={index} className="rounded-xl border border-border bg-foreground/[.02] p-3">
                    <div className="flex items-center gap-2">
                      <select
                        className={fieldClass + ' w-full'}
                        value={row.productId}
                        onChange={(e) => patchRow(index, { productId: e.target.value })}
                      >
                        {PRODUCTS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:border-red-400/50 hover:text-red-600 dark:hover:text-red-300"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Billing model</div>
                        <select
                          className={fieldClass + ' w-full'}
                          value={row.model}
                          onChange={(e) => patchRow(index, { model: e.target.value as ModelId })}
                        >
                          {MODELS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-[92px] shrink-0">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">PCs / license</div>
                        <input
                          type="number"
                          min={1}
                          max={PC_MAX}
                          aria-label="PCs per license"
                          title="How many PCs one license covers (1-9)"
                          className={fieldClass + ' w-full text-center'}
                          value={row.pcs}
                          onChange={(e) =>
                            patchRow(index, {
                              pcs: Math.min(PC_MAX, Math.max(1, Math.round(Number(e.target.value) || 1))),
                            })
                          }
                        />
                      </div>
                      <div className="w-[76px] shrink-0">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">Licenses</div>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          aria-label="Number of licenses"
                          title="How many separate licenses to bill (each covering the PCs above)"
                          className={fieldClass + ' w-full text-center'}
                          value={row.qty}
                          onChange={(e) =>
                            patchRow(index, { qty: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })
                          }
                        />
                      </div>
                    </div>
                    {product && (
                      <div className="mt-2 text-[12.5px] text-muted-foreground">
                        {formatUSD(catalogInvoiceItem(product.id, row.model, row.pcs, 1)?.unit ?? 0)} per license ({pcLabel(row.pcs)})
                        {row.qty > 1 ? ` · ${row.qty} licenses = ${formatUSD((catalogInvoiceItem(product.id, row.model, row.pcs, 1)?.unit ?? 0) * row.qty)}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-2 rounded-xl border border-dashed border-input px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                <Plus className="h-4 w-4" /> Add item
              </button>
            </div>

            <div className={labelClass + ' mt-5'}>License keys (optional — one per line)</div>
            <textarea
              className={inputClass + ' min-h-[84px] font-mono text-[13px]'}
              placeholder={'One key per line, exactly as issued — e.g.\nVidaPay Full Bundle: 3SV-XXXX-XXXX-XXXX-XXXX\n("Label: key" or just the key — both work)'}
              value={keysText}
              onChange={(e) => setKeysText(e.target.value)}
            />
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
              Leave empty for a pay-first invoice — keys go on the receipt once payment clears. One bundle key covers every tool.
            </p>

            <div className={labelClass + ' mt-5'}>Notes</div>
            <textarea
              className={inputClass + ' min-h-[70px]'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* totals + actions */}
            <div className="mt-5 rounded-xl border border-border bg-foreground/[.02] p-4 text-[13.5px]">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal (list)</span>
                <span>{formatUSD(totals.listSubtotal)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="mt-1 flex justify-between text-brand-cyan">
                  <span>Launch Offer discount</span>
                  <span>−{formatUSD(totals.discount)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-border pt-2 text-[15px] font-bold">
                <span>Total ({status === 'PAID' ? 'paid' : status === 'CANCELLED' ? 'cancelled' : 'due'})</span>
                <span>{formatUSD(totals.total)}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                disabled={!canSend}
                onClick={printInvoice}
                className="inline-flex items-center justify-center gap-2 rounded-xl border bg-white px-4 py-3 text-[13.5px] font-semibold text-[#0b0a10] transition-colors hover:bg-[#e8e6f2] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer className="h-4 w-4" /> Print / PDF
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={downloadHTML}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-input px-4 py-3 text-[13.5px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" /> HTML file
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={copyForEmail}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-input px-4 py-3 text-[13.5px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ClipboardCheck className="h-4 w-4" /> Copy for email
              </button>
            </div>
            {flash && (
              <div className="mt-3 rounded-xl border border-brand-cyan/30 bg-[#6ee7ef]/[.06] px-4 py-2.5 text-[13px] text-brand-cyan">
                {flash}
              </div>
            )}

            {/* Email delivery (EmailJS) — browser-local setup, no redeploy.
                Full walkthrough: download/3sverse-download-gateway/EMAILJS_SETUP.md */}
            <div className="mt-5 rounded-xl border border-border bg-foreground/[.02] p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Mail className="h-4 w-4 text-brand-cyan" />
                <p className="text-[13.5px] font-semibold text-foreground">Email delivery (EmailJS)</p>
                <span
                  className={
                    'rounded-lg px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[.12em] ' +
                    (emailjsConfigured()
                      ? 'bg-emerald-400/10 text-emerald-700 dark:text-emerald-300'
                      : 'bg-foreground/[.06] text-muted-foreground')
                  }
                >
                  {emailjsConfigured() ? 'Active' : 'Not configured'}
                </span>
              </div>
              <p className="mb-3 text-[12.5px] font-light leading-5 text-muted-foreground">
                One-time setup — saved in THIS browser only (localStorage), nothing to
                commit. emailjs.com → add an email service (Connect@3SVerse.com is not
                Gmail — pick Route 1/2/3 in the EMAILJS_SETUP guide) → create a template
                with “Copy template content” below → paste the three IDs here → send a test.
              </p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <input
                  className={inputClass}
                  placeholder="Service ID — service_…"
                  value={emailSvc}
                  onChange={(e) => setEmailSvc(e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="Template ID — template_…"
                  value={emailTpl}
                  onChange={(e) => setEmailTpl(e.target.value)}
                />
                <input
                  className={inputClass}
                  placeholder="Public Key"
                  value={emailKey}
                  onChange={(e) => setEmailKey(e.target.value)}
                />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={saveEmailConfig}
                  className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-[13px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                >
                  <Save className="h-4 w-4" /> Save to this browser
                </button>
                <button
                  type="button"
                  onClick={copyTemplateContent}
                  className="inline-flex items-center gap-2 rounded-xl border border-input px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <Copy className="h-4 w-4" /> Copy template content
                </button>
                <div className="flex min-w-[240px] flex-1 gap-2">
                  <input
                    className={inputClass + ' min-w-0 flex-1'}
                    placeholder="Your email — for the test"
                    value={emailTestTo}
                    onChange={(e) => setEmailTestTo(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={sendTest}
                    disabled={emailBusy || !emailjsConfigured()}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-brand-cyan/30 bg-[#6ee7ef]/[.06] px-4 py-2.5 text-[13px] font-medium text-brand-cyan transition-colors hover:border-brand-cyan/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" /> Send test
                  </button>
                </div>
              </div>
              {emailStatus ? (
                <p className="mt-2.5 text-[12.5px] text-brand-cyan">{emailStatus}</p>
              ) : null}
            </div>
          </section>

          {/* ---------------- preview ---------------- */}
          <section>
            {canSend ? (
              <div className="lg:sticky lg:top-6">
                <iframe
                  title="Invoice preview"
                  srcDoc={previewDoc}
                  className="h-[860px] w-full rounded-xl border border-border border bg-white shadow-2xl shadow-black/10 dark:shadow-black/40"
                />
                <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-brand-cyan" />
                  Live preview — print, HTML download and email paste all send the customer this exact format.
                </p>
              </div>
            ) : (
              <div className="flex h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-input text-center">
                <FileText className="mb-3 h-8 w-8 text-brand-cyan" />
                <p className="text-[15px] font-medium text-foreground">Invoice preview yahan banega</p>
                <p className="mt-1 max-w-[340px] text-[13px] text-muted-foreground">
                  "Add item" se order ki items dalo — ya "Fill sample" dabao takay format foran dekh sako.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
