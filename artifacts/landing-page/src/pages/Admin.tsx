import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearch } from 'wouter';
import { Check, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { formatUSD } from '@/lib/catalog';

interface OrderSummary {
  id: string;
  status: string;
  createdAt: string;
  total: number;
  customerName: string;
  customerEmail: string;
  itemCount: number;
  itemsPreview: string;
}

interface OrderItem {
  lineKey: string;
  productName: string;
  modelLabel: string;
  seatsLabel: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  licenseKey: string;
}

interface FullOrder {
  id: string;
  status: string;
  createdAt: string;
  customer: { name: string; email: string; company?: string; messenger?: string; notes?: string };
  items: OrderItem[];
  total: number;
  downloadUrl: string;
  rejectionReason: string;
}

async function api(body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = { ok: false, error: 'Unexpected server response.' };
  }
  return { status: res.status, data };
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-[15px] text-white placeholder:text-[#6d6a80] outline-none focus:border-[#6ee7ef]/60';

function statusBadge(status: string): string {
  if (status === 'APPROVED') return 'border-emerald-400/30 bg-emerald-400/[.08] text-emerald-200';
  if (status === 'REJECTED') return 'border-rose-400/30 bg-rose-400/[.08] text-rose-200';
  return 'border-amber-400/30 bg-amber-400/[.08] text-amber-200';
}

export default function Admin() {
  const search = useSearch();
  const [authed, setAuthed] = useState<'checking' | 'no' | 'yes'>('checking');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selected, setSelected] = useState<FullOrder | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [downloadDraft, setDownloadDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const [instructions, setInstructions] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const flashMsg = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(''), 3200);
  };

  const loadOrders = useCallback(async () => {
    const { status, data } = await api({ action: 'list' });
    if (status === 401) {
      setAuthed('no');
      return;
    }
    if (data.ok) {
      setAuthed('yes');
      setOrders((data.orders ?? []) as OrderSummary[]);
    }
  }, []);

  const openOrder = useCallback(async (id: string) => {
    setBusy(`get:${id}`);
    const { status, data } = await api({ action: 'get', id });
    setBusy('');
    if (status === 401) {
      setAuthed('no');
      return;
    }
    if (data.ok) {
      const order = data.order as unknown as FullOrder;
      setSelected(order);
      setDownloadDraft(order.downloadUrl ?? '');
      setKeyDrafts(
        Object.fromEntries(order.items.map((it) => [it.lineKey, it.licenseKey ?? ''])),
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api({ action: 'settings-get' });
        if (data.paymentInstructions) setInstructions(String(data.paymentInstructions));
        await loadOrders();
      } catch {
        setAuthed('no');
      } finally {
        setAuthed((prev) => (prev === 'checking' ? 'no' : prev));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const wanted = new URLSearchParams(search || '').get('order');
    if (wanted && authed === 'yes') void openOrder(wanted);
  }, [search, authed, openOrder]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const { status, data } = await api({ action: 'login', password });
    if (status === 200 && data.ok) {
      setPassword('');
      await loadOrders();
    } else {
      setLoginError(String(data.error ?? 'Sign-in failed.'));
    }
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!selected) return;
    setBusy(action);
    const { status, data } = await api({ action, id: selected.id, ...extra });
    setBusy('');
    if (status === 401) {
      setAuthed('no');
      return;
    }
    if (data.ok) {
      const hint = data.emailHint ? ` (note: ${String(data.emailHint)})` : '';
      flashMsg(
        action === 'approve'
          ? `Approved ${selected.id} — customer notified${hint}`
          : action === 'reject'
            ? `Rejected ${selected.id}`
            : action === 'unapprove'
              ? `${selected.id} moved back to pending`
              : 'Saved',
      );
      await openOrder(selected.id);
      await loadOrders();
    } else {
      flashMsg(String(data.error ?? 'Action failed.'));
    }
  };

  const saveSettings = async () => {
    setBusy('settings');
    const { data } = await api({ action: 'settings-set', paymentInstructions: instructions });
    setBusy('');
    if (data.ok) {
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 2000);
    } else {
      flashMsg(String(data.error ?? 'Could not save settings.'));
    }
  };

  if (authed === 'checking') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#060509] text-[#8d8a9e]">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" /> Loading admin…
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#060509]">
      <header className="border-b border-white/[.06]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 lg:px-8">
          <a href="/" className="text-[15px] font-semibold tracking-[.08em] text-white">
            3S VERSE <span className="ml-2 text-[12px] font-normal text-[#8d8a9e]">dealer console</span>
          </a>
          {authed === 'yes' ? (
            <button
              type="button"
              onClick={async () => {
                await api({ action: 'logout' });
                setAuthed('no');
                setOrders([]);
                setSelected(null);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-[13px] text-[#d8d5e8] hover:border-white/40 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
        {flash ? (
          <p className="mb-6 rounded-xl border border-[#6ee7ef]/25 bg-[#6ee7ef]/[.06] px-4 py-3 text-[13.5px] text-[#d8d5e8]">
            {flash}
          </p>
        ) : null}

        {authed !== 'yes' ? (
          <form onSubmit={login} className="mx-auto mt-10 max-w-sm rounded-3xl border border-white/[.08] bg-[#0b0a11] p-8">
            <h1 className="text-[20px] font-light text-white">Dealer console sign-in</h1>
            <p className="mt-1.5 text-[13px] text-[#8d8a9e]">
              Seller access only — approve orders and deliver licenses.
            </p>
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} mt-5`}
              placeholder="Admin password"
              aria-label="Admin password"
            />
            {loginError ? (
              <p className="mt-3 text-[13px] text-rose-300">{loginError}</p>
            ) : null}
            <button
              type="submit"
              className="mt-5 w-full rounded-xl bg-white px-6 py-3 text-[15px] font-semibold text-[#0b0a10]"
            >
              Sign in
            </button>
            <p className="mt-4 text-[12px] leading-5 text-[#6d6a80]">
              Set ADMIN_PASSWORD in the Netlify environment variables (Site configuration →
              Environment variables), then redeploy.
            </p>
          </form>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[16px] font-medium text-white">Orders</h2>
                <button
                  type="button"
                  onClick={() => void loadOrders()}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3.5 py-2 text-[12.5px] text-[#d8d5e8] hover:border-white/40 hover:text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>
              <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                {orders.length === 0 ? (
                  <p className="rounded-2xl border border-white/[.08] bg-[#0b0a11] px-4 py-6 text-center text-[13.5px] text-[#8d8a9e]">
                    No orders yet — they appear here the moment a customer checks out.
                  </p>
                ) : null}
                {orders.map((order) => (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => void openOrder(order.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      selected?.id === order.id
                        ? 'border-[#6ee7ef]/40 bg-[#6ee7ef]/[.05]'
                        : 'border-white/[.08] bg-[#0b0a11] hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono-tech text-[12.5px] text-[#d8d5e8]">{order.id}</span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadge(order.status)}`}>
                        {order.status}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-[13.5px] text-white">{order.customerName}</p>
                    <p className="truncate text-[12px] text-[#8d8a9e]">{order.itemsPreview}</p>
                    <p className="mt-1 text-[12.5px] text-[#b9b6c9]">
                      {formatUSD(order.total)} ·{' '}
                      {new Date(order.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-6">
              {selected ? (
                <div className="rounded-3xl border border-white/[.08] bg-[#0b0a11] p-6 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-mono-tech text-[13px] text-[#8d8a9e]">{selected.id}</p>
                      <p className="mt-1 text-[15px] text-white">
                        {selected.customer.name}{' '}
                        <span className="text-[13px] text-[#8d8a9e]">
                          &lt;{selected.customer.email}&gt;
                        </span>
                      </p>
                      {selected.customer.company ? (
                        <p className="text-[12.5px] text-[#8d8a9e]">{selected.customer.company}</p>
                      ) : null}
                      {selected.customer.messenger ? (
                        <p className="text-[12.5px] text-[#8d8a9e]">
                          TG/WA: {selected.customer.messenger}
                        </p>
                      ) : null}
                      {selected.customer.notes ? (
                        <p className="mt-2 max-w-xl rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2 text-[12.5px] text-[#b9b6c9]">
                          {selected.customer.notes}
                        </p>
                      ) : null}
                    </div>
                    <span className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium ${statusBadge(selected.status)}`}>
                      {selected.status}
                    </span>
                  </div>

                  <div className="mt-6 space-y-3">
                    {selected.items.map((item) => (
                      <div
                        key={item.lineKey}
                        className="rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[14px] text-white">
                            {item.productName}
                            <span className="ml-2 text-[12px] text-[#8d8a9e]">
                              {item.modelLabel} · {item.seatsLabel} · ×{item.qty}
                            </span>
                          </span>
                          <span className="font-mono-tech text-[13px] text-[#d8d5e8]">
                            {formatUSD(item.lineTotal)}
                          </span>
                        </div>
                        <input
                          value={keyDrafts[item.lineKey] ?? ''}
                          onChange={(e) =>
                            setKeyDrafts({ ...keyDrafts, [item.lineKey]: e.target.value })
                          }
                          className={`${inputClass} mt-3 font-mono-tech text-[13px]`}
                          placeholder="Paste license key from the keygen (VP3S-…)"
                          aria-label={`License key for ${item.productName}`}
                        />
                      </div>
                    ))}
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-1.5 block text-[12.5px] font-medium text-[#b9b6c9]">
                      Download link (sent to the customer on approval)
                    </span>
                    <input
                      value={downloadDraft}
                      onChange={(e) => setDownloadDraft(e.target.value)}
                      className={`${inputClass} font-mono-tech text-[13px]`}
                      placeholder="https://… (direct download URL)"
                    />
                  </label>

                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy === 'approve'}
                      onClick={() => void act('approve', { keys: keyDrafts, downloadUrl: downloadDraft })}
                      className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[14.5px] font-semibold text-[#0b0a10] transition-transform hover:scale-[1.02] disabled:opacity-60"
                    >
                      {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Approve &amp; email keys
                    </button>
                    <button
                      type="button"
                      disabled={busy === 'reject'}
                      onClick={() =>
                        void act('reject', {
                          reason: window.prompt('Rejection reason (sent to no one — for your records):', '') ?? '',
                        })
                      }
                      className="rounded-xl border border-rose-400/40 px-5 py-3 text-[14px] text-rose-200 hover:bg-rose-400/[.08] disabled:opacity-60"
                    >
                      Reject
                    </button>
                    {selected.status !== 'PENDING' ? (
                      <button
                        type="button"
                        disabled={busy === 'unapprove'}
                        onClick={() => void act('unapprove')}
                        className="rounded-xl border border-white/15 px-5 py-3 text-[14px] text-[#d8d5e8] hover:border-white/40 disabled:opacity-60"
                      >
                        Move back to pending
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-white/[.08] bg-[#0b0a11] p-8 text-[14px] text-[#8d8a9e]">
                  Select an order on the left to review payment and deliver license keys.
                </div>
              )}

              <div className="rounded-3xl border border-white/[.08] bg-[#0b0a11] p-6 sm:p-8">
                <h3 className="text-[15px] font-medium text-white">Payment instructions</h3>
                <p className="mt-1 text-[12.5px] text-[#8d8a9e]">
                  Shown to customers after checkout and on the order status page. Bank transfer
                  (ACH/wire), Wise, PayPal, USDT — whatever you accept.
                </p>
                <textarea
                  rows={5}
                  maxLength={2000}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className={`${inputClass} mt-4`}
                />
                <button
                  type="button"
                  disabled={busy === 'settings'}
                  onClick={() => void saveSettings()}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-[13.5px] text-white hover:border-white/40 disabled:opacity-60"
                >
                  {busy === 'settings' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {settingsSaved ? 'Saved' : 'Save instructions'}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
