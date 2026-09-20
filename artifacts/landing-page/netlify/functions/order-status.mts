// Netlify Function — GET /api/order-status
//
// Dealer Tools license store — customer order status.
//
//   GET /api/order-status?id=DL-...&t=<token>   (token from the success
//                                               screen / status link)
//   GET /api/order-status?id=DL-...&e=<email>   (fallback: order id +
//                                               the buyer's email)
//
// License keys are only revealed when the order is APPROVED; otherwise
// they are masked. The download URL is only included when approved.
// Zero runtime deps beyond @netlify/blobs.

import { getStore } from "@netlify/blobs";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_LOOKUPS_PER_WINDOW = 30;
const lookups = new Map<string, number[]>();

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
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
  for (const [mapKey, timestamps] of lookups) {
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length === 0) {
      lookups.delete(mapKey);
    } else {
      lookups.set(mapKey, recent);
    }
  }
  const timestamps = lookups.get(key) ?? [];
  if (timestamps.length >= MAX_LOOKUPS_PER_WINDOW) {
    return Math.max(1, Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000));
  }
  timestamps.push(now);
  lookups.set(key, timestamps);
  return null;
}

function maskKey(key: string): string {
  const cleaned = key.replace(/\s+/g, "");
  if (cleaned.length <= 5) return "•••••";
  return `••••-${cleaned.slice(-5)}`;
}

interface StoredItem {
  lineKey: string;
  productName: string;
  modelLabel: string;
  seatsLabel: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  licenseKey: string;
}

interface StoredOrder {
  id: string;
  token: string;
  status: string;
  createdAt: string;
  customer: { name: string; email: string; company?: string };
  items: StoredItem[];
  total: number;
  downloadUrl: string;
  approvedAt: string | null;
  rejectionReason: string;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") {
    return json(405, { ok: false, error: "Method not allowed." });
  }
  const retry = rateLimitRetryAfter(clientKey(req));
  if (retry) {
    return json(429, { ok: false, error: "Too many lookups." },
      { "Retry-After": String(retry) });
  }

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim().slice(0, 40);
  const token = (url.searchParams.get("t") ?? "").trim().slice(0, 80);
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase().slice(0, 254);

  if (!id || (!token && !email)) {
    return json(400, { ok: false, error: "Order id and token (or email) required." });
  }

  let rec: StoredOrder | null;
  try {
    const store = getStore("dealer-orders");
    rec = (await store.get(id, { type: "json" })) as StoredOrder | null;
  } catch (err) {
    console.error(`[order-status] read failed: ${String(err).slice(0, 300)}`);
    return json(503, { ok: false, error: "Order service unavailable — try again shortly." });
  }

  // Same response for "missing" and "bad credentials" — no order probing.
  if (!rec || (token ? rec.token !== token : rec.customer.email.toLowerCase() !== email)) {
    return json(404, { ok: false, error: "Order not found — check the id and link." });
  }

  const approved = rec.status === "APPROVED";
  return json(200, {
    ok: true,
    order: {
      id: rec.id,
      status: rec.status,
      createdAt: rec.createdAt,
      approvedAt: rec.approvedAt,
      customerName: rec.customer.name,
      customerEmail: rec.customer.email,
      total: rec.total,
      rejectionReason: rec.status === "REJECTED" ? rec.rejectionReason : "",
      downloadUrl: approved ? rec.downloadUrl : "",
      items: rec.items.map((it) => ({
        productName: it.productName,
        modelLabel: it.modelLabel,
        seatsLabel: it.seatsLabel,
        qty: it.qty,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        licenseKey: approved ? it.licenseKey : maskKey(it.licenseKey || ""),
        hasKey: Boolean(it.licenseKey),
      })),
    },
  });
};

export const config = { path: "/api/order-status" };
