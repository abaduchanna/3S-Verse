import { useMemo, useState, type FormEvent } from 'react';
import { Check, Copy, Loader2, Minus, Plus, ShieldCheck, ShoppingCart, Trash2 } from 'lucide-react';
import {
  MODELS,
  PRODUCTS,
  SEATS,
  formatUSD,
  seatsAllowedForModel,
  unitPrice,
  type ModelId,
  type SeatsId,
} from '@/lib/catalog';

interface Line {
  productId: string;
  model: ModelId;
  seats: SeatsId;
  qty: number;
}

interface OrderResult {
  id: string;
  token: string;
  totalLabel: string;
  statusUrl: string;
  paymentInstructions: string;
  emailHint?: string;
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-[15px] text-white placeholder:text-[#6d6a80] outline-none transition-colors focus:border-[#6ee7ef]/60';

function pill(active: boolean): string {
  return [
    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200',
    active
      ? 'bg-white text-[#0b0a10]'
      : 'border border-white/15 text-[#d8d5e8] hover:border-white/40 hover:text-white',
  ].join(' ');
}

export default function DealerStore() {
  const [selections, setSelections] = useState<Record<string, { model: ModelId; seats: SeatsId }>>(
    Object.fromEntries(
      PRODUCTS.map((p) => [p.id, { model: 'lifetime' as ModelId, seats: '1pc' as SeatsId }]),
    ),
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [form, setForm] = useState({ name: '', email: '', company: '', messenger: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OrderResult | null>(null);
  const [copied, setCopied] = useState(false);

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const product = PRODUCTS.find((p) => p.id === l.productId);
        return product ? sum + unitPrice(product, l.model, l.seats) * l.qty : sum;
      }, 0),
    [lines],
  );

  const setSelection = (productId: string, patch: Partial<{ model: ModelId; seats: SeatsId }>) => {
    setSelections((prev) => {
      const next = { ...prev[productId], ...patch };
      if (!seatsAllowedForModel(next.model).includes(next.seats)) next.seats = '1pc';
      return { ...prev, [productId]: next };
    });
  };

  const addLine = (productId: string) => {
    const sel = selections[productId];
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.productId === productId && l.model === sel.model && l.seats === sel.seats,
      );
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, qty: Math.min(10, l.qty + 1) } : l,
        );
      }
      return [...prev, { productId, model: sel.model, seats: sel.seats, qty: 1 }];
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

  const copyStatusUrl = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(new URL(result.statusUrl, window.location.origin).href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the link is visible for manual copy */
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || lines.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          items: lines.map(({ productId, model, seats }) => ({ productId, model, seats })),
        }),
      });
      const data = (await res.json()) as Record<string, unknown> & OrderResult;
      if (!res.ok || !data.ok) {
        setError(String(data.error ?? 'Could not place the order — please try again.'));
        return;
      }
      setResult({
        id: data.id,
        token: data.token,
        totalLabel: data.totalLabel ?? formatUSD(total),
        statusUrl: data.statusUrl,
        paymentInstructions: data.paymentInstructions ?? '',
        emailHint: data.emailHint,
      });
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-16">
      <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-3 flex items-center gap-2 font-mono-tech text-[10px] uppercase tracking-[.22em] text-[#e44bd7]">
            <ShoppingCart className="h-3.5 w-3.5" /> Buy licenses
          </p>
          <h3 className="text-[clamp(1.7rem,2.6vw,2.5rem)] font-light leading-[1.08] tracking-[-0.02em] text-white">
            Dealer license store
          </h3>
        </div>
        <p className="max-w-md text-[14px] font-light leading-6 text-[#b9b6c9]">
          Pick a tool, choose a model, and place your order. USD billing — pay by bank transfer,
          Wise, PayPal, or USDT. License keys and download links are delivered after payment
          confirmation.
        </p>
      </div>

      {result ? (
        <div className="rounded-3xl border border-[#6ee7ef]/25 bg-[#0b0a11] p-8 sm:p-10">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#6ee7ef]/15 text-[#6ee7ef]">
              <Check className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[17px] font-medium text-white">Order placed — {result.id}</p>
              <p className="text-[13.5px] text-[#b9b6c9]">
                Total {result.totalLabel} · a copy of these details was sent to the 3S Verse team.
              </p>
            </div>
          </div>
          <p className="mb-2 text-[13px] font-medium uppercase tracking-[.14em] text-[#8d8a9e]">
            Your order status link — save it
          </p>
          <div className="mb-6 flex flex-col gap-3 sm:flex-row">
            <code className="flex-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 font-mono-tech text-[13px] text-[#d8d5e8]">
              {typeof window !== 'undefined'
                ? new URL(result.statusUrl, window.location.origin).href
                : result.statusUrl}
            </code>
            <button
              type="button"
              onClick={copyStatusUrl}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-[14px] font-medium text-white transition-colors hover:border-white/40"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="mb-2 text-[13px] font-medium uppercase tracking-[.14em] text-[#8d8a9e]">
            How payment works
          </p>
          <p className="max-w-2xl text-[14px] font-light leading-6 text-[#b9b6c9]">
            {result.paymentInstructions}
          </p>
          {result.emailHint ? (
            <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-4 py-3 text-[13px] text-amber-200/90">
              Note: the seller notification could not be emailed automatically
              ({result.emailHint}). The order is safely stored and visible in the admin console.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {PRODUCTS.map((product) => {
            const sel = selections[product.id];
            const price = unitPrice(product, sel.model, sel.seats);
            return (
              <div
                key={product.id}
                className="flex flex-col rounded-3xl border border-white/[.08] bg-[#0b0a11] p-6"
              >
                <h4 className="text-[16.5px] font-medium leading-snug text-white">{product.name}</h4>
                <p className="mt-1.5 text-[13px] font-light leading-5 text-[#8d8a9e]">
                  {product.tagline}
                </p>
                <ul className="mt-4 flex-1 space-y-2">
                  {product.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[12.5px] font-light leading-5 text-[#d8d5e8]">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6ee7ef]" />
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
                  <div className="flex flex-wrap gap-1.5">
                    {SEATS.map((s) => {
                      const allowed = seatsAllowedForModel(sel.model).includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={!allowed}
                          className={[pill(sel.seats === s.id), !allowed ? 'cursor-not-allowed opacity-30' : ''].join(' ')}
                          onClick={() => setSelection(product.id, { seats: s.id })}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-end justify-between border-t border-white/[.07] pt-4">
                    <div>
                      <p className="text-[26px] font-light leading-none text-white">
                        {price === 0 ? 'Free' : formatUSD(price)}
                      </p>
                      <p className="mt-1 text-[11.5px] text-[#8d8a9e]">
                        {sel.model === 'trial'
                          ? '7 days · 1 PC'
                          : sel.model === '1y'
                            ? 'one-time · 12 months'
                            : 'one-time · yours forever'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addLine(product.id)}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                    >
                      <Plus className="h-4 w-4" /> Add
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!result && lines.length > 0 ? (
        <form
          onSubmit={submit}
          className="mt-8 rounded-3xl border border-white/[.08] bg-[#0b0a11] p-6 sm:p-8"
        >
          <p className="mb-4 text-[13px] font-medium uppercase tracking-[.14em] text-[#8d8a9e]">
            Your order
          </p>
          <div className="mb-6 space-y-2">
            {lines.map((line, index) => {
              const product = PRODUCTS.find((p) => p.id === line.productId)!;
              const lineTotal = unitPrice(product, line.model, line.seats) * line.qty;
              return (
                <div
                  key={`${line.productId}|${line.model}|${line.seats}`}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3"
                >
                  <span className="min-w-0 flex-1 text-[14px] text-white">
                    {product.name}
                    <span className="ml-2 text-[12px] text-[#8d8a9e]">
                      {MODELS.find((m) => m.id === line.model)?.label} ·{' '}
                      {SEATS.find((s) => s.id === line.seats)?.label}
                    </span>
                  </span>
                  <span className="font-mono-tech text-[13px] text-[#d8d5e8]">
                    {formatUSD(lineTotal)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => changeQty(index, -1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-[#d8d5e8] hover:border-white/40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-[14px] text-white">{line.qty}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => changeQty(index, 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-[#d8d5e8] hover:border-white/40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => removeLine(index)}
                      className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-[#e44bd7] hover:border-[#e44bd7]/60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-[14px] text-[#b9b6c9]">Total (USD)</span>
              <span className="text-[20px] font-light text-white">{formatUSD(total)}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium text-[#b9b6c9]">Name *</span>
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
              <span className="mb-1.5 block text-[12.5px] font-medium text-[#b9b6c9]">Email *</span>
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
              <span className="mb-1.5 block text-[12.5px] font-medium text-[#b9b6c9]">
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
              <span className="mb-1.5 block text-[12.5px] font-medium text-[#b9b6c9]">
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
              <span className="mb-1.5 block text-[12.5px] font-medium text-[#b9b6c9]">Notes</span>
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
            <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-4 py-3 text-[13.5px] text-rose-200">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-[12.5px] text-[#8d8a9e]">
              <ShieldCheck className="h-4 w-4 text-[#6ee7ef]" />
              Licenses are machine-locked · keys delivered after payment confirmation
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[15px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02] disabled:opacity-60"
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
