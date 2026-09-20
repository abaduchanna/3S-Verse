// Netlify Function — POST /api/admin
//
// Dealer Tools license store — seller approval console.
// The SPA at /admin talks to this single endpoint with an action dispatch.
//
// Actions:
//   login         { password }                       → sets HttpOnly cookie
//   logout                                           → clears cookie
//   list                                             → order summaries
//   get           { id }                             → full order (incl. keys)
//   approve       { id, keys: {lineKey: key}, downloadUrl } → APPROVED +
//                   customer email with keys + download link
//   reject        { id, reason }                     → REJECTED
//   unapprove     { id }                             → back to PENDING
//   settings-get                                     → payment instructions
//   settings-set  { paymentInstructions }            → save instructions
//
// Required environment variable:
//   ADMIN_PASSWORD — seller password. Without it the API returns 503 and
//                    the /admin UI shows setup instructions.
// Email (optional but expected): RESEND_API_KEY, CONTACT_TO, RESEND_FROM.

import { getStore } from "@netlify/blobs";
import { formatUSD } from "../../src/lib/catalog";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const COOKIE_NAME = "sv_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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

function ordersStore() {
  return getStore("dealer-orders");
}

function settingsStore() {
  return getStore("dealer-settings");
}

// ---------------------------------------------------------------- sessions

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Constant-time string compare (no early exit on mismatch). */
function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

async function adminSecret(): Promise<string | null> {
  const password = resolveEnv("ADMIN_PASSWORD");
  if (!password) return null;
  return `${password}|3sverse-admin-v1`;
}

async function sessionCookieValue(password: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = await hmac(String(exp), `${password}|3sverse-admin-v1`);
  return `${exp}.${sig}`;
}

async function isAuthed(req: Request): Promise<boolean> {
  const secret = await adminSecret();
  if (!secret) return false;
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([0-9]+)\\.([A-Za-z0-9_-]+)`),
  );
  if (!match) return false;
  const exp = Number(match[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(match[1], secret);
  return safeEqual(expected, match[2]);
}

// ------------------------------------------------------------------- email

async function sendEmail(to: string, replyTo: string, subject: string, html: string): Promise<{ ok: boolean; hint?: string }> {
  const apiKey = resolveEnv("RESEND_API_KEY");
  if (!apiKey) return { ok: false, hint: "RESEND_API_KEY not set" };
  const from =
    resolveEnv("RESEND_FROM") ?? "3S Verse Website <connect@3sverse.com>";
  const send = async (fromAddress: string) =>
    fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress, to: [to], reply_to: replyTo, subject, html }),
    }).then(async (r) => ({ status: r.status, body: await r.text() }));
  let result = await send(from);
  if (result.status >= 400) {
    result = await send("onboarding@resend.dev");
  }
  if (result.status >= 400) {
    console.error(`[admin] email failed — status=${result.status} body=${result.body.slice(0, 300)}`);
    return { ok: false, hint: "email delivery failed" };
  }
  return { ok: true };
}

function approvalEmailHtml(order: {
  id: string;
  customer: { name: string };
  items: Array<{ productName: string; modelLabel: string; seatsLabel: string; qty: number; licenseKey: string }>;
  total: number;
  downloadUrl: string;
}): string {
  const rows = order.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${it.productName}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${it.modelLabel}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee">${it.seatsLabel}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee"><code>${it.licenseKey || "(sent separately)"}</code></td></tr>`,
    )
    .join("");
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px">
      <h2 style="margin:0 0 8px">Your 3S Verse order is approved</h2>
      <p style="color:#555">Thank you, ${order.customer.name} — payment for order
      <strong>${order.id}</strong> (${formatUSD(order.total)}) is confirmed.</p>
      <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
        <thead><tr>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">Product</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">Model</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">PCs</th>
          <th align="left" style="padding:6px 10px;border-bottom:2px solid #222">License key</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${order.downloadUrl ? `<p>Download: <a href="${order.downloadUrl}">${order.downloadUrl}</a></p>` : ""}
      <p style="color:#555">Activation: install the app, paste your key when asked, and it locks to that PC.
      Need help? Just reply to this email.</p>
      <p style="color:#888">3S Verse — www.3SVerse.com</p>
    </div>`;
}

// ------------------------------------------------------------------ handler

interface AdminBody {
  action?: unknown;
  password?: unknown;
  id?: unknown;
  keys?: unknown;
  downloadUrl?: unknown;
  reason?: unknown;
  paymentInstructions?: unknown;
}

function readText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed." });
  }
  const password = resolveEnv("ADMIN_PASSWORD");
  if (!password) {
    return json(503, {
      ok: false,
      error:
        "Admin access is not configured — set ADMIN_PASSWORD in the Netlify environment variables.",
    });
  }

  let body: AdminBody;
  try {
    body = (await req.json()) as AdminBody;
  } catch {
    return json(400, { ok: false, error: "Invalid request body." });
  }
  const action = readText(body.action, 24);

  // ---- login / logout (no auth required)
  if (action === "login") {
    const given = readText(body.password, 200);
    if (!given || !safeEqual(given, password)) {
      return json(401, { ok: false, error: "Wrong password." });
    }
    const value = await sessionCookieValue(password);
    return json(200, { ok: true }, {
      "Set-Cookie": `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
    });
  }
  if (action === "logout") {
    return json(200, { ok: true }, {
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    });
  }

  // ---- everything below requires a valid session
  if (!(await isAuthed(req))) {
    return json(401, { ok: false, error: "Not signed in." });
  }

  if (action === "list") {
    const store = ordersStore();
    const entries: Array<Record<string, unknown>> = [];
    const listed = await store.list({ paginate: true });
    for (const blob of listed.blobs) {
      const rec = (await store.get(blob.key, { type: "json" })) as null | {
        id: string;
        status: string;
        createdAt: string;
        total: number;
        customer: { name: string; email: string };
        items?: Array<{ productName: string; qty: number }>;
      };
      if (!rec) continue;
      entries.push({
        id: rec.id,
        status: rec.status,
        createdAt: rec.createdAt,
        total: rec.total,
        customerName: rec.customer?.name ?? "",
        customerEmail: rec.customer?.email ?? "",
        itemCount: rec.items?.length ?? 0,
        itemsPreview: (rec.items ?? [])
          .map((i) => `${i.productName} ×${i.qty}`)
          .join(", "),
      });
    }
    entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json(200, { ok: true, orders: entries.slice(0, 200) });
  }

  if (action === "get") {
    const id = readText(body.id, 40);
    const rec = (await ordersStore().get(id, { type: "json" })) as null | Record<string, unknown>;
    if (!rec) return json(404, { ok: false, error: "Order not found." });
    const { token: _token, ...safe } = rec as { token?: string };
    return json(200, { ok: true, order: safe });
  }

  if (action === "approve" || action === "reject" || action === "unapprove") {
    const id = readText(body.id, 40);
    const store = ordersStore();
    type Rec = {
      id: string;
      token: string;
      status: string;
      createdAt: string;
      customer: { name: string; email: string; company?: string; messenger?: string; notes?: string };
      items: Array<{ lineKey: string; productName: string; modelLabel: string; seatsLabel: string; qty: number; unitPrice: number; lineTotal: number; licenseKey: string }>;
      total: number;
      downloadUrl: string;
      approvedAt: string | null;
      rejectionReason: string;
    };
    const rec = (await store.get(id, { type: "json" })) as Rec | null;
    if (!rec) return json(404, { ok: false, error: "Order not found." });

    let emailResult: { ok: boolean; hint?: string } = { ok: true };

    if (action === "approve") {
      const keys = (body.keys ?? {}) as Record<string, string>;
      for (const item of rec.items) {
        const provided = readText(keys[item.lineKey], 120);
        if (provided) item.licenseKey = provided.toUpperCase();
      }
      rec.downloadUrl = readText(body.downloadUrl, 500);
      rec.status = "APPROVED";
      rec.approvedAt = new Date().toISOString();
      rec.rejectionReason = "";
      emailResult = await sendEmail(
        rec.customer.email,
        resolveEnv("CONTACT_TO") ?? "Connect@3SVerse.com",
        `Your 3S Verse order ${rec.id} is approved`,
        approvalEmailHtml(rec),
      );
    } else if (action === "reject") {
      rec.status = "REJECTED";
      rec.rejectionReason = readText(body.reason, 500);
      rec.approvedAt = null;
    } else {
      rec.status = "PENDING";
      rec.approvedAt = null;
      rec.rejectionReason = "";
    }

    await store.setJSON(id, rec);
    return json(200, { ok: true, emailHint: emailResult.ok ? undefined : emailResult.hint });
  }

  if (action === "settings-get") {
    const main = (await settingsStore().get("main", { type: "json" })) as
      | { paymentInstructions?: string }
      | null;
    return json(200, {
      ok: true,
      paymentInstructions:
        main?.paymentInstructions ??
        "We accept USD payments via bank transfer (ACH/wire), Wise, PayPal, or USDT (TRC20).",
    });
  }

  if (action === "settings-set") {
    const text = readText(body.paymentInstructions, 2000);
    if (!text) return json(400, { ok: false, error: "Payment instructions cannot be empty." });
    await settingsStore().setJSON("main", {
      paymentInstructions: text,
      updatedAt: new Date().toISOString(),
    });
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: "Unknown action." });
};

export const config = { path: "/api/admin" };
