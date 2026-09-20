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
  Download,
  FileText,
  Plus,
  Printer,
  ShieldCheck,
  Trash2,
  Wand2,
} from 'lucide-react';
import { MODELS, PRODUCTS, SEATS, formatUSD, seatsAllowedForModel, type ModelId, type SeatsId } from '@/lib/catalog';
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

const DEFAULT_NOTES =
  'License keys activate on first run on the registered PC(s). For support, contact Connect@3sverse.com with your order reference.';

const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-[14px] text-white placeholder:text-[#6d6a80] outline-none transition-colors focus:border-[#6ee7ef]/60';
/* Same as inputClass but without w-full — avoids the width conflict when a
   fixed width is layered on top inside flex rows (w-full wins by stylesheet
   order and squeezes the other flex children). */
const fieldClass =
  'rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-[14px] text-white placeholder:text-[#6d6a80] outline-none transition-colors focus:border-[#6ee7ef]/60 [&>option]:bg-[#141320]';
const labelClass = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[.16em] text-[#8b87a3]';

interface Row {
  productId: string;
  model: ModelId;
  seats: SeatsId;
  qty: number;
}

function pill(active: boolean): string {
  return [
    'rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all duration-200',
    active
      ? 'bg-white text-[#0b0a10]'
      : 'border border-white/15 text-[#d8d5e8] hover:border-white/40 hover:text-white',
  ].join(' ');
}

function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function InvoiceStudio() {
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

  useEffect(() => {
    document.title = '3S Verse — Invoice Studio';
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
        .map((r) => catalogInvoiceItem(r.productId, r.model, r.seats, r.qty))
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

  /* ---------- row helpers ---------- */
  const addRow = () =>
    setRows((prev) => [...prev, { productId: 'bundle', model: 'lifetime', seats: '1pc', qty: 1 }]);
  const patchRow = (index: number, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        if (!seatsAllowedForModel(next.model).includes(next.seats)) next.seats = '1pc';
        return next;
      }),
    );
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  /* ---------- actions ---------- */
  const showFlash = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash(''), 4500);
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
        seats: '1pc' as SeatsId,
        qty: 1,
      })),
    );
    // Map sample items back to catalog rows so prices recompute live.
    const rowMap: Row[] = [
      { productId: 'bundle', model: 'lifetime', seats: '5pc', qty: 1 },
      { productId: 'extractor', model: '1y', seats: '1pc', qty: 1 },
    ];
    setRows(rowMap);
    setKeysText(SAMPLE_INVOICE.keys.map((k) => `${k.label}: ${k.key}`).join('\n'));
    setNotes(SAMPLE_INVOICE.notes);
    showFlash('Sample invoice bhar di — form edit karo, preview live update hota hai');
  };

  const canSend = items.length > 0;

  return (
    <div className="min-h-screen bg-[#0b0a10] text-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
        {/* header */}
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[.22em] text-[#8b87a3]">3S Verse</div>
            <h1 className="mt-1 text-[26px] font-bold leading-tight">Invoice Studio</h1>
            <p className="mt-1 text-[14px] text-[#9a96b2]">
              Order details bharo — yehi format customer ko jata hai (PDF · HTML · email).
            </p>
          </div>
          <button
            type="button"
            onClick={fillSample}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-[13px] font-medium text-[#d8d5e8] transition-colors hover:border-white/40 hover:text-white"
          >
            <Wand2 className="h-4 w-4" /> Fill sample
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[430px,1fr]">
          {/* ---------------- form ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5 md:p-6">
            <div className={labelClass}>Order</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <input
                  className={inputClass}
                  placeholder="Order ref — 3SV-…"
                  value={orderRef}
                  onChange={(e) => setOrderRef(e.target.value)}
                />
                <div className="mt-1.5 text-[12px] text-[#8b87a3]">
                  Invoice no: <span className="font-semibold text-[#6ee7ef]">{invoiceNo || '—'}</span> (auto)
                </div>
              </div>
              <input
                type="date"
                className={inputClass}
                value={dateISO}
                onChange={(e) => setDateISO(e.target.value)}
              />
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
                <span className="text-[12px] text-[#8b87a3]">days unpaid (expiry shown on invoice)</span>
              </div>
            ) : null}
            {refWasCancelled ? (
              <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-4 py-2.5 text-[12.5px] text-amber-200/90">
                Warning: is order ref ({orderRef.trim().toUpperCase()}) pe pehle koi invoice CANCEL
                ho chuki hai — dobara check kar lo.
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
                const allowedSeats = seatsAllowedForModel(row.model);
                return (
                  <div key={index} className="rounded-xl border border-white/10 bg-white/[.02] p-3">
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
                        className="rounded-lg border border-white/10 p-2 text-[#9a96b2] transition-colors hover:border-red-400/50 hover:text-red-300"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        className={fieldClass + ' min-w-0 flex-1'}
                        value={row.model}
                        onChange={(e) => patchRow(index, { model: e.target.value as ModelId })}
                      >
                        {MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={fieldClass + ' w-[118px] shrink-0'}
                        value={row.seats}
                        onChange={(e) => patchRow(index, { seats: e.target.value as SeatsId })}
                      >
                        {SEATS.filter((s) => allowedSeats.includes(s.id)).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        className={fieldClass + ' w-[76px] shrink-0 text-center'}
                        value={row.qty}
                        onChange={(e) =>
                          patchRow(index, { qty: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })
                        }
                      />
                    </div>
                    {product && (
                      <div className="mt-2 text-[12.5px] text-[#8b87a3]">
                        {formatUSD(catalogInvoiceItem(product.id, row.model, row.seats, 1)?.unit ?? 0)} per unit
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-2 rounded-xl border border-dashed border-white/20 px-4 py-2.5 text-[13px] font-medium text-[#d8d5e8] transition-colors hover:border-white/40 hover:text-white"
              >
                <Plus className="h-4 w-4" /> Add item
              </button>
            </div>

            <div className={labelClass + ' mt-5'}>License keys (optional — one per line)</div>
            <textarea
              className={inputClass + ' min-h-[84px] font-mono text-[13px]'}
              placeholder={'VidaPay Full Bundle: 3SV-XXXX-XXXX-XXXX-XXXX\n(optional "Label: key" — plain key bhi chalega)'}
              value={keysText}
              onChange={(e) => setKeysText(e.target.value)}
            />

            <div className={labelClass + ' mt-5'}>Notes</div>
            <textarea
              className={inputClass + ' min-h-[70px]'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />

            {/* totals + actions */}
            <div className="mt-5 rounded-xl border border-white/10 bg-white/[.02] p-4 text-[13.5px]">
              <div className="flex justify-between text-[#9a96b2]">
                <span>Subtotal (list)</span>
                <span>{formatUSD(totals.listSubtotal)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="mt-1 flex justify-between text-[#6ee7ef]">
                  <span>Launch Offer discount</span>
                  <span>−{formatUSD(totals.discount)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-[15px] font-bold">
                <span>Total ({status === 'PAID' ? 'paid' : status === 'CANCELLED' ? 'cancelled' : 'due'})</span>
                <span>{formatUSD(totals.total)}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                disabled={!canSend}
                onClick={printInvoice}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-[13.5px] font-semibold text-[#0b0a10] transition-colors hover:bg-[#e8e6f2] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer className="h-4 w-4" /> Print / PDF
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={downloadHTML}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-[13.5px] font-medium text-[#d8d5e8] transition-colors hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" /> HTML file
              </button>
              <button
                type="button"
                disabled={!canSend}
                onClick={copyForEmail}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-[13.5px] font-medium text-[#d8d5e8] transition-colors hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ClipboardCheck className="h-4 w-4" /> Copy for email
              </button>
            </div>
            {flash && (
              <div className="mt-3 rounded-xl border border-[#6ee7ef]/30 bg-[#6ee7ef]/[.06] px-4 py-2.5 text-[13px] text-[#9fe8f2]">
                {flash}
              </div>
            )}
          </section>

          {/* ---------------- preview ---------------- */}
          <section>
            {canSend ? (
              <div className="lg:sticky lg:top-6">
                <iframe
                  title="Invoice preview"
                  srcDoc={previewDoc}
                  className="h-[860px] w-full rounded-xl border border-white/10 bg-white shadow-2xl shadow-black/40"
                />
                <p className="mt-3 flex items-center gap-2 text-[12.5px] text-[#8b87a3]">
                  <ShieldCheck className="h-4 w-4 text-[#6ee7ef]" />
                  Live preview — print, HTML download aur email paste teeno se EXACT yehi format customer ko jayega.
                </p>
              </div>
            ) : (
              <div className="flex h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-white/15 text-center">
                <FileText className="mb-3 h-8 w-8 text-[#6ee7ef]" />
                <p className="text-[15px] font-medium text-[#d8d5e8]">Invoice preview yahan banega</p>
                <p className="mt-1 max-w-[340px] text-[13px] text-[#8b87a3]">
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
