// Netlify Function — POST /api/order
//
// Dealer Tools license store — order intake.
//
// Zero runtime deps beyond @netlify/blobs (kept external by the Netlify
// bundler). Prices are ALWAYS recomputed server-side from the shared
// catalog (../../src/lib/catalog.ts) — client-sent amounts are ignored.
//
// Required environment variable:
//   RESEND_API_KEY   — API key from resend.com/api-keys
//   ADMIN_PASSWORD   — unlocks /admin (the approval UI); if unset the
//                      order API still works but approval is impossible
// Optional:
//   CONTACT_TO       — seller inbox (default Connect@3SVerse.com)
//   RESEND_FROM      — verified From identity (default 3S Verse Website
//                      <connect@3sverse.com>; falls back to
//                      onboarding@resend.dev if the domain is rejected)
//   SITE_URL         — public origin used in email links
//                      (default https://3sverse.com)
//
// Storage: Netlify Blobs, store "dealer-orders", one JSON document per
// order (key = order id). The admin function lists/updates the same store.

import { getStore } from "@netlify/blobs";
import {
  MODELS,
  PC_MAX,
  PC_MIN,
  PRODUCTS,
  formatUSD,
  pcLabel,
  productById,
  unitPrice,
  type ModelId,
} from "../../src/lib/catalog";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ORDERS_PER_WINDOW = 5;

const SELLER_EMAIL = resolveEnv("CONTACT_TO") ?? "Connect@3SVerse.com";
const RESEND_FROM =
  resolveEnv("RESEND_FROM") ?? "3S Verse Website <connect@3sverse.com>";
const SITE_URL = resolveEnv("SITE_URL") ?? "https://3sverse.com";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const requestTimestamps = new Map<string, number[]>();

/** Case-insensitive env lookup — the Netlify UI happily stores
 * "Resend_API_Key" while code expects "RESEND_API_KEY". */
function resolveEnv(name: string): string | undefined {
  const exact = process.env[name];
  if (exact) return exact;
  const target = name.toLowerCase();
  for (const key of Object.keys(process.env)) {
    if (key.toLowerCase() === target) return process.env[key];
  }
  return undefined;
}

function json(
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

function clientKey(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function rateLimitRetryAfter(key: string): number | null {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  for (const [mapKey, timestamps] of requestTimestamps) {
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length === 0) {
      requestTimestamps.delete(mapKey);
    } else {
      requestTimestamps.set(mapKey, recent);
    }
  }
  const timestamps = requestTimestamps.get(key) ?? [];
  if (timestamps.length >= MAX_ORDERS_PER_WINDOW) {
    return Math.max(
      1,
      Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
  }
  timestamps.push(now);
  requestTimestamps.set(key, timestamps);
  return null;
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function orderId(): string {
  const d = new Date();
  const stamp = [
    String(d.getFullYear()).slice(2),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("");
  const rand = randomToken(4).toUpperCase().slice(0, 6);
  return `DL-${stamp}-${rand}`;
}

interface IncomingItem {
  productId?: unknown;
  model?: unknown;
  pcs?: unknown;
}

interface OrderLine {
  lineKey: string;
  productId: string;
  productName: string;
  model: ModelId;
  modelLabel: string;
  pcs: number;
  seatsLabel: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  licenseKey: string;
}

function readPcs(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < PC_MIN || n > PC_MAX) return null;
  return n;
}

function buildLines(rawItems: unknown): { lines: OrderLine[] } | { error: string } {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 10) {
    return { error: "Order must contain between 1 and 10 items." };
  }
  const merged = new Map<string, OrderLine>();
  for (const raw of rawItems as IncomingItem[]) {
    const productId = readText(raw?.productId, 40);
    const model = readText(raw?.model, 16) as ModelId;
    const pcs = readPcs(raw?.pcs);
    const product = productById(productId);
    if (!product) return { error: "Unknown product selected." };
    if (!MODELS.some((m) => m.id === model)) {
      return { error: "Unknown billing model selected." };
    }
    if (pcs === null) {
      return { error: `PC count must be a whole number between ${PC_MIN} and ${PC_MAX}.` };
    }
    if (model === "trial" && pcs !== 1) {
      return { error: "Trials are limited to 1 PC." };
    }
    const modelLabel = MODELS.find((m) => m.id === model)!.label;
    const price = unitPrice(product, model, pcs);
    const lineKey = `${productId}|${model}|${pcs}`;
    const existing = merged.get(lineKey);
    if (existing) {
      existing.qty += 1;
      existing.lineTotal = existing.qty * price;
    } else {
      merged.set(lineKey, {
        lineKey,
        productId,
        productName: product.name,
        model,
        modelLabel,
        pcs,
        seatsLabel: pcLabel(pcs),
        qty: 1,
        unitPrice: price,
        lineTotal: price,
        licenseKey: "",
      });
    }
  }
  return { lines: Array.from(merged.values()) };
}

function orderEmailHtml(rec: {
  id: string;
  customer: Record<string, string>;
  items: OrderLine[];
  total: number;
}): string {
  const rows = rec.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${it.productName}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${it.modelLabel}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${it.seatsLabel}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${it.qty}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${formatUSD(it.lineTotal)}</td></tr>`,
    )
    .join("");
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">
      <h2 style="margin:0 0 4px">New dealer order ${rec.id}</h2>
      <p style="margin:0 0 16px;color:#555">Total <strong>${formatUSD(rec.total)}</strong></p>
      <p><strong>${rec.customer.name}</strong> &lt;${rec.customer.email}&gt;<br/>
      ${rec.customer.company ? `Company: ${rec.customer.company}<br/>` : ""}
      ${rec.customer.messenger ? `Telegram/WhatsApp: ${rec.customer.messenger}<br/>` : ""}
      ${rec.customer.notes ? `Notes: ${rec.customer.notes}` : ""}</p>
      <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
        <thead><tr>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">Product</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">Model</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">PCs</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">Qty</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">Price</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p>Approve it here after payment: <a href="${SITE_URL}/admin?order=${rec.id}">${SITE_URL}/admin?order=${rec.id}</a></p>
    </div>`;
}

async function emailSeller(rec: {
  id: string;
  customer: Record<string, string>;
  items: OrderLine[];
  total: number;
}): Promise<{ ok: boolean; hint?: string }> {
  const apiKey = resolveEnv("RESEND_API_KEY");
  if (!apiKey) return { ok: false, hint: "RESEND_API_KEY is not set" };
  const send = async (fromAddress: string) =>
    fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [SELLER_EMAIL],
        reply_to: rec.customer.email,
        subject: `New dealer order ${rec.id} — ${formatUSD(rec.total)}`.replace(
          /[\r\n]+/g,
          " ",
        ),
        html: orderEmailHtml(rec),
      }),
    }).then(async (r) => ({ status: r.status, body: await r.text() }));

  let result = await send(RESEND_FROM);
  if (result.status >= 400) {
    result = await send("onboarding@resend.dev");
  }
  if (result.status >= 400) {
    console.error(
      `[order] seller email failed — status=${result.status} body=${result.body.slice(0, 400)}`,
    );
    return { ok: false, hint: "seller notification email failed" };
  }
  return { ok: true };
}

async function paymentInstructions(): Promise<string> {
  try {
    const settings = getStore("dealer-settings");
    const main = (await settings.get("main", { type: "json" })) as
      | { paymentInstructions?: string }
      | null;
    if (main?.paymentInstructions) return main.paymentInstructions;
  } catch {
    /* settings store unreachable — fall through to default */
  }
  return (
    "We accept USD payments via bank transfer (ACH/wire), Wise, PayPal, " +
    "or USDT (TRC20). Payment details are sent to your email right after " +
    "you place the order. License keys and download links are released as " +
    "soon as your payment is confirmed — usually within a few hours."
  );
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed." });
  }
  const retry = rateLimitRetryAfter(clientKey(req));
  if (retry) {
    return json(
      429,
      { ok: false, error: "Too many orders — please try again later." },
      { "Retry-After": String(retry) },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: "Invalid request body." });
  }

  const name = readText(body.name, 120);
  const email = readText(body.email, 254).toLowerCase();
  const company = readText(body.company, 160);
  const messenger = readText(body.messenger, 120);
  const notes = readText(body.notes, 1000);

  if (!name) return json(400, { ok: false, error: "Name is required." });
  if (!emailPattern.test(email)) {
    return json(400, { ok: false, error: "A valid email is required." });
  }

  const built = buildLines(body.items);
  if ("error" in built) return json(400, { ok: false, error: built.error });

  const total = built.lines.reduce((sum, l) => sum + l.lineTotal, 0);
  if (total < 0) return json(400, { ok: false, error: "Invalid order total." });

  const id = orderId();
  const token = randomToken(24);
  const rec = {
    id,
    token,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    customer: { name, email, company, messenger, notes },
    items: built.lines,
    total,
    downloadUrl: "",
    approvedAt: null as string | null,
    rejectionReason: "",
  };

  try {
    const store = getStore("dealer-orders");
    await store.setJSON(id, rec);
  } catch (err) {
    console.error(`[order] blob save failed: ${String(err).slice(0, 300)}`);
    return json(503, {
      ok: false,
      error: "Could not save the order — please try again in a minute.",
    });
  }

  const mail = await emailSeller(rec);
  const instructions = await paymentInstructions();

  return json(200, {
    ok: true,
    id,
    token,
    total,
    totalLabel: formatUSD(total),
    statusUrl: `/order/${id}?t=${token}`,
    paymentInstructions: instructions,
    emailHint: mail.ok ? undefined : mail.hint,
  });
};

export const config = { path: "/api/order" };
