import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearch } from 'wouter';
import { Check, Copy, Download, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { PAID_DOWNLOAD, formatUSD, PRODUCTS } from '@/lib/catalog';
import { downloadsForProduct } from '@/lib/downloads';

interface OrderItem {
  productName: string;
  modelLabel: string;
  seatsLabel: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  licenseKey: string;
  hasKey: boolean;
  downloadUrl?: string;
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
  'w-full rounded-xl border border-border bg-foreground/[.04] px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground outline-none focus:border-brand-cyan/60';

interface StaticEntry {
  products: string[];
  model?: string;
}

/** Order references are stored only as SHA-256 hashes in a public JSON
 * file (the site is static on GitHub Pages), so the registry leaks
 * nothing — but a customer who knows their exact reference unlocks the
 * download panel for exactly the products they purchased. */
async function staticOrderLookup(rawRef: string): Promise<{ ref: string; products: string[] } | null> {
  const ref = rawRef.trim().toUpperCase();
  if (!ref) return null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/orders.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { orders?: Record<string, StaticEntry> };
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(ref),
    );
    const key = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const entry = (data.orders || {})[key];
    if (!entry || !entry.products?.length) return null;
    return { ref, products: entry.products };
  } catch {
    return null;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'border-amber-400/30 bg-amber-400/[.08] text-amber-700 dark:text-amber-200',
    APPROVED: 'border-emerald-400/30 bg-emerald-400/[.08] text-emerald-700 dark:text-emerald-200',
    REJECTED: 'border-rose-400/30 bg-rose-400/[.08] text-rose-700 dark:text-rose-200',
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
  const [staticOrder, setStaticOrder] = useState<{ ref: string; products: string[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lookupId, setLookupId] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(-1);

  const load = useCallback(async (id: string, token: string, email: string) => {
    setLoading(true);
    setError('');
    setStaticOrder(null);
    // No credentials typed? The order-reference registry still works —
    // the reference itself is the proof of purchase.
    if (!token && !email) {
      const matched = await staticOrderLookup(id);
      if (matched) {
        setStaticOrder(matched);
        setLoading(false);
        return;
      }
      setError('Order not found — check the order reference and try again.');
      setOrder(null);
      setLoading(false);
      return;
    }
    try {
      const qs = new URLSearchParams({ id });
      if (token) qs.set('t', token);
      if (email) qs.set('e', email);
      const res = await fetch(`/api/order-status?${qs.toString()}`);
      const data = (await res.json()) as { ok: boolean; order?: Order; error?: string };
      if (!res.ok || !data.ok || !data.order) throw new Error(data.error ?? 'Order not found.');
      setOrder(data.order);
    } catch {
      // Server mode unavailable (static hosting) — fall back to the
      // order-reference registry for free re-downloads.
      const matched = await staticOrderLookup(id);
      if (matched) {
        setStaticOrder(matched);
      } else {
        setError('Order not found — check the id and link.');
        setOrder(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = params?.id ?? '';
    const qs = new URLSearchParams(search || '');
    const token = (qs.get('t') ?? '').trim();
    const email = (qs.get('e') ?? '').trim();
    if (id) {
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
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 lg:px-8">
          <a href="/" className="text-[15px] font-semibold tracking-[.08em] text-foreground">
            3S VERSE
          </a>
          <a
            href="/#tools"
            className="rounded-xl border border-input px-4 py-2 text-[13.5px] text-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            Dealer tools
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
        <h1 className="text-[clamp(1.8rem,3vw,2.6rem)] font-light tracking-[-0.02em] text-foreground">
          Order status
        </h1>
        <p className="mt-2 text-[14px] font-light text-foreground/75">
          License keys appear here as soon as your payment is confirmed.
        </p>

        {loading ? (
          <div className="mt-10 flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading order…
          </div>
        ) : staticOrder ? (
          <div className="mt-8 rounded-3xl border border-emerald-400/25 bg-emerald-400/[.05] p-6 sm:p-8">
            <p className="flex items-center gap-2 text-[13px] font-medium uppercase tracking-[.14em] text-emerald-700 dark:text-emerald-300">
              <Lock className="h-4 w-4" /> Order verified — {staticOrder.ref}
            </p>
            <h2 className="mt-3 text-[clamp(1.4rem,2.2vw,1.9rem)] font-light text-foreground">
              Your downloads
            </h2>
            <p className="mt-2 max-w-2xl text-[13.5px] font-light leading-6 text-foreground/75">
              These buttons always serve the newest official build of each tool — when an
              update ships, come back to this page and re-download for free. Every build
              opens as a 7-day trial; the license key delivered with your invoice unlocks
              the full version permanently. No separate installer is needed for paid plans.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {staticOrder.products.flatMap((pid, i) => {
                const pname = PRODUCTS.find((p) => p.id === pid)?.name ?? pid;
                return downloadsForProduct(pid, staticOrder.ref).map((d, j) => (
                  <a
                    key={`${pid}-${j}`}
                    href={d.url}
                    data-testid={`button-static-download-${pid}-${j}`}
                    className="inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-3 text-[14px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                  >
                    <Download className="h-4 w-4" /> {d.label} — {pname}
                  </a>
                ));
              })}
            </div>
            {!PAID_DOWNLOAD.gatewayUrl ? (
              <p className="mt-4 rounded-xl border border-border bg-foreground/[.03] px-4 py-3 text-[13px] text-foreground/75">
                Your license key is being issued — email{' '}
                <a className="text-brand-cyan" href={`mailto:${PAID_DOWNLOAD.contactEmail}`}>
                  {PAID_DOWNLOAD.contactEmail}
                </a>{' '}
                with your order reference and we send it right away.
              </p>
            ) : null}
            <p className="mt-4 text-[12.5px] text-muted-foreground">
              Bookmark this page (3sverse.com/order/{staticOrder.ref}) — it is
              your permanent re-download link.
            </p>
          </div>
        ) : error ? (
          <div className="mt-8">
            <p className="rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-4 py-3 text-[13.5px] text-rose-700 dark:text-rose-200">
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
                className="rounded-xl border bg-white px-6 py-3 text-[14.5px] font-semibold text-[#0b0a10] sm:col-span-2"
              >
                Find my order
              </button>
            </form>
          </div>
        ) : order ? (
          <div className="mt-8 space-y-6">
            <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-mono-tech text-[13px] text-muted-foreground">{order.id}</p>
                  <p className="mt-1 text-[13px] text-foreground/75">
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
                <p className="mt-4 rounded-xl border border-rose-400/25 bg-rose-400/[.06] px-4 py-3 text-[13.5px] text-rose-700 dark:text-rose-200">
                  {order.rejectionReason}
                </p>
              ) : null}

              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13.5px]">
                  <thead>
                    <tr className="text-[12px] uppercase tracking-[.14em] text-muted-foreground">
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
                      <tr key={index} className="border-t border-border">
                        <td className="py-3 pr-4 text-foreground">{item.productName}</td>
                        <td className="py-3 pr-4 text-foreground">{item.modelLabel}</td>
                        <td className="py-3 pr-4 text-foreground">{item.seatsLabel}</td>
                        <td className="py-3 pr-4 text-foreground">{item.qty}</td>
                        <td className="py-3 pr-4 text-foreground">{formatUSD(item.lineTotal)}</td>
                        <td className="py-3">
                          {item.licenseKey ? (
                            <span className="inline-flex items-center gap-2">
                              <code className="font-mono-tech text-[12.5px] text-brand-cyan">
                                {item.licenseKey}
                              </code>
                              {order.status === 'APPROVED' && item.hasKey ? (
                                <button
                                  type="button"
                                  aria-label="Copy license key"
                                  onClick={() => copyKey(item.licenseKey, index)}
                                  className="text-muted-foreground hover:text-foreground"
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
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <span className="text-[13.5px] text-foreground/75">Total</span>
                <span className="text-[20px] font-light text-foreground">{formatUSD(order.total)}</span>
              </div>

              {order.status === 'APPROVED' &&
              order.items.some((it) => it.downloadUrl) ? (
                <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/[.04] p-5">
                  <p className="text-[15px] font-semibold text-foreground">
                    Your downloads
                  </p>
                  <p className="mt-1 text-[13px] text-foreground/75">
                    These buttons always serve the newest build — when a tool
                    is updated, re-download here for free. Same file for
                    monthly, annual and lifetime plans; your license key
                    decides the plan.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {order.items
                      .filter(
                        (it, index, arr) =>
                          it.downloadUrl &&
                          arr.findIndex((x) => x.productName === it.productName) ===
                            index,
                      )
                      .map((it, index) => (
                        <a
                          key={index}
                          href={it.downloadUrl}
                          data-testid={`button-download-${index}`}
                          className="inline-flex items-center gap-2 rounded-xl border bg-white px-5 py-3 text-[14px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                        >
                          <Download className="h-4 w-4" />
                          {it.productName} — latest build (.exe)
                        </a>
                      ))}
                  </div>
                </div>
              ) : order.status === 'APPROVED' && order.downloadUrl ? (
                <a
                  href={order.downloadUrl}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl border bg-white px-6 py-3 text-[15px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02]"
                >
                  <Download className="h-4 w-4" /> Download your software
                </a>
              ) : null}

              {order.status === 'PENDING' ? (
                <p className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/[.06] px-4 py-3 text-[13.5px] text-amber-800/90 dark:text-amber-100/90">
                  Payment instructions were included in your order confirmation. As soon as your
                  payment is confirmed, your license keys and download link appear on this page.
                </p>
              ) : null}
            </div>

            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-brand-cyan" />
              Every license is machine-locked to the PC it is activated on.
              <a
                href="mailto:Connect@3SVerse.com"
                className="ml-2 inline-flex items-center gap-1.5 text-brand-cyan hover:text-foreground"
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
