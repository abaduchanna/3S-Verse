import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearch } from 'wouter';
import { Check, Copy, Download, Loader2, Mail, ShieldCheck } from 'lucide-react';
import { formatUSD } from '@/lib/catalog';

interface OrderItem {
  productName: string;
  modelLabel: string;
  seatsLabel: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  licenseKey: string;
  hasKey: boolean;
}

interface Order {
  id: string;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  customerName: string;
  customerEmail: string;
  total: number;
  rejectionReason: string;
  downloadUrl: string;
  items: OrderItem[];
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-[15px] text-white placeholder:text-[#6d6a80] outline-none focus:border-[#6ee7ef]/60';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'border-amber-400/30 bg-amber-400/[.08] text-amber-200',
    APPROVED: 'border-emerald-400/30 bg-emerald-400/[.08] text-emerald-200',
    REJECTED: 'border-rose-400/30 bg-rose-400/[.08] text-rose-200',
  };
  const label: Record<string, string> = {
    PENDING: 'Awaiting payment confirmation',
    APPROVED: 'Approved — your licenses are ready',
    REJECTED: 'Rejected',
  };
  return (
    <span
      className={`inline-flex rounded-full border px-4 py-1.5 text-[13px] font-medium ${map[status] ?? map.PENDING}`}
    >
      {label[status] ?? status}
    </span>
  );
}

export default function OrderStatus() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lookupId, setLookupId] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(-1);

  const load = useCallback(async (id: string, token: string, email: string) => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ id });
      if (token) qs.set('t', token);
      if (email) qs.set('e', email);
      const res = await fetch(`/api/order-status?${qs.toString()}`);
      const data = (await res.json()) as { ok: boolean; order?: Order; error?: string };
      if (!res.ok || !data.ok || !data.order) {
        setError(data.error ?? 'Order not found.');
        setOrder(null);
      } else {
        setOrder(data.order);
      }
    } catch {
      setError('Network error — try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = params?.id ?? '';
    const qs = new URLSearchParams(search || '');
    const token = (qs.get('t') ?? '').trim();
    const email = (qs.get('e') ?? '').trim();
    if (id && (token || email)) {
      void load(id, token, email);
    } else {
      setLoading(false);
    }
  }, [params?.id, search, load]);

  const copyKey = async (key: string, index: number) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(-1), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#060509]">
      <header className="border-b border-white/[.06]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 lg:px-8">
          <a href="/" className="text-[15px] font-semibold tracking-[.08em] text-white">
            3S VERSE
          </a>
          <a
            href="/#tools"
            className="rounded-xl border border-white/15 px-4 py-2 text-[13.5px] text-[#d8d5e8] transition-colors hover:border-white/40 hover:text-white"
          >
            Dealer tools
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
        <h1 className="text-[clamp(1.8rem,3vw,2.6rem)] font-light tracking-[-0.02em] text-white">
          Order status
        </h1>
        <p className="mt-2 text-[14px] font-light text-[#b9b6c9]">
          License keys appear here as soon as your payment is confirmed.
        </p>

        {loading ? (
          <div className="mt-10 flex items-center gap-3 text-[#8d8a9e]">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading order…
          </div>
        ) : error ? (
          <div className="mt-8">
            <p className="rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-4 py-3 text-[13.5px] text-rose-200">
              {error}
            </p>
            <form
              className="mt-6 grid max-w-xl gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void load(lookupId.trim(), '', lookupEmail.trim().toLowerCase());
              }}
            >
              <input
                required
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                className={inputClass}
                placeholder="Order id (DL-…)"
                aria-label="Order id"
              />
              <input
                required
                type="email"
                value={lookupEmail}
                onChange={(e) => setLookupEmail(e.target.value)}
                className={inputClass}
                placeholder="Email used at checkout"
                aria-label="Email"
              />
              <button
                type="submit"
                className="rounded-xl bg-white px-6 py-3 text-[14.5px] font-semibold text-[#0b0a10] sm:col-span-2"
              >
                Find my order
              </button>
            </form>
          </div>
        ) : order ? (
          <div className="mt-8 space-y-6">
            <div className="rounded-3xl border border-white/[.08] bg-[#0b0a11] p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-mono-tech text-[13px] text-[#8d8a9e]">{order.id}</p>
                  <p className="mt-1 text-[13px] text-[#b9b6c9]">
                    Placed {new Date(order.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · {order.customerName}
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </div>

              {order.status === 'REJECTED' && order.rejectionReason ? (
                <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-4 py-3 text-[13.5px] text-rose-200">
                  {order.rejectionReason}
                </p>
              ) : null}

              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13.5px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[.14em] text-[#8d8a9e]">
                      <th className="py-2 pr-4 font-medium">Product</th>
                      <th className="py-2 pr-4 font-medium">Model</th>
                      <th className="py-2 pr-4 font-medium">PCs</th>
                      <th className="py-2 pr-4 font-medium">Qty</th>
                      <th className="py-2 pr-4 font-medium">Price</th>
                      <th className="py-2 font-medium">License key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item, index) => (
                      <tr key={index} className="border-t border-white/[.06]">
                        <td className="py-3 pr-4 text-white">{item.productName}</td>
                        <td className="py-3 pr-4 text-[#d8d5e8]">{item.modelLabel}</td>
                        <td className="py-3 pr-4 text-[#d8d5e8]">{item.seatsLabel}</td>
                        <td className="py-3 pr-4 text-[#d8d5e8]">{item.qty}</td>
                        <td className="py-3 pr-4 text-[#d8d5e8]">{formatUSD(item.lineTotal)}</td>
                        <td className="py-3">
                          {item.licenseKey ? (
                            <span className="inline-flex items-center gap-2">
                              <code className="font-mono-tech text-[12.5px] text-[#6ee7ef]">
                                {item.licenseKey}
                              </code>
                              {order.status === 'APPROVED' && item.hasKey ? (
                                <button
                                  type="button"
                                  aria-label="Copy license key"
                                  onClick={() => copyKey(item.licenseKey, index)}
                                  className="text-[#8d8a9e] hover:text-white"
                                >
                                  {copiedIndex === index ? (
                                    <Check className="h-3.5 w-3.5" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-[#8d8a9e]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/[.07] pt-4">
                <span className="text-[13.5px] text-[#b9b6c9]">Total</span>
                <span className="text-[20px] font-light text-white">{formatUSD(order.total)}</span>
              </div>

              {order.status === 'APPROVED' && order.downloadUrl ? (
                <a
                  href={order.downloadUrl}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[15px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                >
                  <Download className="h-4 w-4" /> Download your software
                </a>
              ) : null}

              {order.status === 'PENDING' ? (
                <p className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-4 py-3 text-[13.5px] text-amber-100/90">
                  Payment instructions were included in your order confirmation. As soon as your
                  payment is confirmed, your license keys and download link appear on this page.
                </p>
              ) : null}
            </div>

            <p className="flex items-center gap-2 text-[13px] text-[#8d8a9e]">
              <ShieldCheck className="h-4 w-4 text-[#6ee7ef]" />
              Every license is machine-locked to the PC it is activated on.
              <a
                href="mailto:Connect@3SVerse.com"
                className="ml-2 inline-flex items-center gap-1.5 text-[#6ee7ef] hover:text-white"
              >
                <Mail className="h-3.5 w-3.5" /> Connect@3SVerse.com
              </a>
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
