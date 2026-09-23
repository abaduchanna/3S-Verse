/**
 * 3S Verse — Download Gateway (Cloudflare Worker)
 * ================================================
 * Serves the FULL (paid) Windows builds ONLY to customers whose order
 * number is present and active in the license ledger. The FULL builds
 * live in PRIVATE GitHub repos and are NEVER publicly downloadable —
 * this worker is the single gate in front of them.
 *
 *   GET /download?order=3SV-XXXXXXXX&product=extractor|ordering|rebate
 *   GET /download?order=3SV-XXXXXXXX&product=bundle   → HTML page with
 *                                                       one button per
 *                                                       covered tool
 *   POST /order   → order intake: the website POSTs the customer's
 *                   order here and the worker files it into the ledger
 *                   repo (ledger/orders_inbox/<ref>.json) so the
 *                   License Studio "Orders" tab can pick it up
 *   GET /         → info page
 *
 * HOW A REQUEST IS HANDLED
 *   1. Normalize the order number (trim + uppercase).
 *   2. Load ledger/orders.json from the PRIVATE vidapay-license-server
 *      repo through the GitHub Contents API (in-memory cache, 5 min).
 *   3. Validate: order exists → status "active" → package not expired
 *      ("expiry" model must have expires >= today) → requested product is
 *      covered by the package (bundle covers all three tools).
 *   4. Stream the current release asset of the private build repo straight
 *      to the customer (Content-Disposition: attachment). The customer
 *      ALWAYS gets the newest build — nothing to re-upload, ever.
 *
 * SETUP (summary — full walkthrough in README.md)
 *   Secrets (Worker → Settings → Variables):
 *     GH_TOKEN            fine-grained PAT, Contents: Read-only on
 *                         vidapay-license-server, vidapay-extractor,
 *                         vidapay-ordering, vidapay-rebate-filing
 *     LEDGER_WRITE_TOKEN  fine-grained PAT, Contents: Read+Write on
 *                         vidapay-license-server ONLY (the Studio
 *                         admin token works) — used by POST /order to
 *                         file orders into the inbox
 *   Variables (plain text):
 *     LEDGER_REPO   "abaduchanna/vidapay-license-server"
 *     LEDGER_PATH   "ledger/orders.json"
 *     OWNER         "abaduchanna"
 *   Then paste this worker's URL into the website config:
 *     artifacts/landing-page/src/lib/catalog.ts → PAID_DOWNLOAD.gatewayUrl
 *
 * Revoking a customer: set "status": "revoked" (or expire the package) in
 * ledger/orders.json — their download gate closes within 5 minutes.
 *
 * Developed by www.3SVerse.com (c) 2026
 */

const OWNER_DEFAULT = "abaduchanna";
const LEDGER_REPO_DEFAULT = "abaduchanna/vidapay-license-server";
const LEDGER_PATH_DEFAULT = "ledger/orders.json";
const INBOX_DIR_DEFAULT = "ledger/orders_inbox";
const CACHE_SECONDS = 300;

/* Order intake rate limit (per IP): 5 orders / 15 min, same as the old
   Netlify order function. */
const INBOX_WINDOW_MS = 15 * 60 * 1000;
const INBOX_MAX_PER_WINDOW = 5;
const inboxHits = new Map(); // ip → [timestamps]

/* product → private repo + release asset name (the FULL builds).
   "bundle" is expanded to all three products at validation time. */
const ASSET_MAP = {
  extractor: { repo: "vidapay-extractor", asset: "VidaPay_Incentive_Extractor_FULL.exe" },
  ordering: { repo: "vidapay-ordering", asset: "VidaPay_Device_Ordering_FULL.exe" },
  rebate: { repo: "vidapay-rebate-filing", asset: "VidaPay_Rebate_Filing_FULL.exe" },
};
const PRODUCT_NAMES = {
  extractor: "VidaPay Incentive Extractor",
  ordering: "VidaPay Device Ordering",
  rebate: "VidaPay Rebate Filing",
};
const ALL_PRODUCTS = Object.keys(ASSET_MAP);

/* ------------------------- tiny in-memory cache ------------------------- */
const cache = new Map(); // key → { at, data }

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_SECONDS * 1000) return hit.data;
  const data = await loader();
  cache.set(key, { at: Date.now(), data });
  return data;
}

/* ------------------------------ GitHub I/O ------------------------------ */
function ghHeaders(token, octetStream = false) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: octetStream
      ? "application/octet-stream"
      : "application/vnd.github+json",
    "User-Agent": "3sverse-download-gateway",
  };
}

async function loadLedger(env) {
  const repo = env.LEDGER_REPO || LEDGER_REPO_DEFAULT;
  const path = env.LEDGER_PATH || LEDGER_PATH_DEFAULT;
  return cached(`ledger:${repo}:${path}`, async () => {
    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=main`;
    const res = await fetch(url, { headers: ghHeaders(env.GH_TOKEN) });
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`ledger HTTP ${res.status}`);
    const meta = await res.json();
    const content = atob((meta.content || "").replace(/\s/g, ""));
    const bytes = Uint8Array.from(content, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  });
}

async function findAsset(env, repo, assetName) {
  const owner = env.OWNER || OWNER_DEFAULT;
  return cached(`release:${repo}`, async () => {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const res = await fetch(url, { headers: ghHeaders(env.GH_TOKEN) });
    if (!res.ok) throw new Error(`release HTTP ${res.status} for ${repo}`);
    const rel = await res.json();
    const asset = (rel.assets || []).find((a) => a.name === assetName);
    if (!asset) throw new Error(`asset ${assetName} not found in ${repo} ${rel.tag_name}`);
    return { id: asset.id, name: asset.name, size: asset.size, tag: rel.tag_name };
  });
}

/* ------------------------------ validation ------------------------------ */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function expandProducts(order) {
  const owned = Array.isArray(order.products) ? order.products : [];
  if (owned.includes("bundle")) return ALL_PRODUCTS.slice();
  return owned.filter((p) => ALL_PRODUCTS.includes(p));
}

/* ---------------------------- order intake ----------------------------- */
function corsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonCors(request, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}

function inboxIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function inboxRateLimited(ip) {
  const now = Date.now();
  const recent = (inboxHits.get(ip) || []).filter((t) => now - t < INBOX_WINDOW_MS);
  if (recent.length >= INBOX_MAX_PER_WINDOW) {
    inboxHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  inboxHits.set(ip, recent);
  return false;
}

function readText(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

const INBOX_PRODUCTS = { extractor: 1, ordering: 1, rebate: 1 };
const INBOX_MODELS = { trial: 1, monthly: 1, annual: 1, lifetime: 1 };

function sanitizeInboxOrder(body) {
  const ref = readText(body.ref, 24).toUpperCase();
  if (!/^3SV-[A-Z0-9]{4,12}$/.test(ref)) return { error: "Bad order reference." };
  const name = readText(body.name, 120);
  const email = readText(body.email, 254).toLowerCase();
  if (!name) return { error: "Name is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "A valid email is required." };
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length < 1 || rawItems.length > 10) return { error: "Order must contain 1-10 items." };
  const items = [];
  for (const it of rawItems) {
    const productId = readText(it?.productId, 40);
    const model = readText(it?.model, 16);
    const pcs = Number(it?.pcs);
    const qty = Math.max(1, Math.min(10, Number(it?.qty) || 1));
    if (!INBOX_PRODUCTS[productId]) return { error: "Unknown product." };
    if (!INBOX_MODELS[model]) return { error: "Unknown billing model." };
    if (!Number.isInteger(pcs) || pcs < 1 || pcs > 50) return { error: "Bad PC count." };
    items.push({ productId, model, pcs, qty });
  }
  const total = Number(body.total);
  return {
    order: {
      ref,
      status: "pending",
      createdAt: new Date().toISOString(),
      customer: {
        name,
        email,
        company: readText(body.company, 160),
        messenger: readText(body.messenger, 120),
        notes: readText(body.notes, 1000),
      },
      items,
      totalLabel: readText(body.totalLabel, 32) ||
        (Number.isFinite(total) ? `$${total.toFixed(2)}` : ""),
      source: "3sverse.com",
    },
  };
}

async function handleOrderPost(request, env) {
  if (!env.LEDGER_WRITE_TOKEN) {
    return jsonCors(request, 503, { ok: false, error: "Order intake is not configured yet (missing LEDGER_WRITE_TOKEN)." });
  }
  if (inboxRateLimited(inboxIp(request))) {
    return jsonCors(request, 429, { ok: false, error: "Too many orders — please try again later." });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonCors(request, 400, { ok: false, error: "Invalid request body." });
  }
  const clean = sanitizeInboxOrder(body);
  if (clean.error) return jsonCors(request, 400, { ok: false, error: clean.error });
  const order = clean.order;
  const repo = env.LEDGER_REPO || LEDGER_REPO_DEFAULT;
  const dir = env.INBOX_DIR || INBOX_DIR_DEFAULT;
  const url = `https://api.github.com/repos/${repo}/contents/${dir}/${order.ref}.json`;
  const put = async (payload) =>
    fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.LEDGER_WRITE_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "3sverse-download-gateway",
      },
      body: JSON.stringify(payload),
    });
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(order, null, 2))));
  let res = await put({
    message: `order inbox ${order.ref}`,
    content,
  });
  if (res.status === 422) {
    return jsonCors(request, 409, { ok: false, error: "This order reference was already received." });
  }
  if (res.status >= 400) {
    return jsonCors(request, 502, { ok: false, error: `Could not file the order (GitHub ${res.status}).` });
  }
  return jsonCors(request, 200, { ok: true, ref: order.ref });
}

function validate(ledger, orderNo, product) {
  if (!orderNo || !/^3SV-/.test(orderNo)) {
    return { ok: false, status: 400, message: "Order number must look like 3SV-… (see your invoice)." };
  }
  const order = ledger[orderNo];
  if (!order) {
    return { ok: false, status: 403, message: "Order number not found. Check your invoice or contact Connect@3SVerse.com." };
  }
  if (order.status === "revoked") {
    return { ok: false, status: 403, message: "This license has been revoked. Contact Connect@3SVerse.com if you believe this is a mistake." };
  }
  if (order.status !== "active") {
    return { ok: false, status: 403, message: "This order is not active yet. If you just paid, give us a few hours to activate it." };
  }
  if (order.model === "expiry") {
    const exp = String(order.expires || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || exp < todayISO()) {
      return { ok: false, status: 403, message: "Your 1-year package has expired — renew to keep downloading updates." };
    }
  }
  const owned = expandProducts(order);
  if (product === "bundle") {
    if (!owned.length) {
      return { ok: false, status: 403, message: "This order does not cover any downloadable tool." };
    }
    return { ok: true, products: owned };
  }
  if (!owned.includes(product)) {
    return { ok: false, status: 403, message: `This order does not include ${PRODUCT_NAMES[product] || product}.` };
  }
  return { ok: true, products: [product] };
}

/* -------------------------------- pages -------------------------------- */
function infoPage() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>3S Verse — Downloads</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f3f8;padding:40px;text-align:center;">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e4ee;border-radius:12px;padding:32px;">
<h1 style="margin:0 0 8px;font-size:20px;">3S Verse — Customer Downloads</h1>
<p style="color:#6b6880;font-size:14px;line-height:1.6;">Use the <strong>order number from your invoice</strong> on
<a href="https://3sverse.com" style="color:#0e7c8c;">3sverse.com</a> to download your software.
Free trials are available on the site without any sign-in.</p>
<p style="color:#6b6880;font-size:12px;">Support: Connect@3SVerse.com</p>
</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function bundlePage(orderNo, products) {
  const buttons = products
    .map(
      (p) =>
        `<a href="/download?order=${encodeURIComponent(orderNo)}&product=${p}" ` +
        `style="display:block;margin:10px auto;max-width:420px;padding:14px 18px;background:#0e7c8c;color:#fff;` +
        `border-radius:10px;text-decoration:none;font-weight:600;">${PRODUCT_NAMES[p]} — download (.exe)</a>`,
    )
    .join("\n");
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>3S Verse — Your downloads</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f3f8;padding:40px;text-align:center;">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e4ee;border-radius:12px;padding:32px;">
<h1 style="margin:0 0 6px;font-size:20px;">Order ${orderNo} — your software</h1>
<p style="color:#6b6880;font-size:13px;margin:0 0 18px;">Bundle license — every tool below is included. Always the newest build.</p>
${buttons}
<p style="color:#6b6880;font-size:12px;">Keys activate on first run on the registered PC(s).</p>
</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function errorPage(status, message) {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>3S Verse — Download</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f3f8;padding:40px;text-align:center;">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #fecaca;border-radius:12px;padding:32px;">
<h1 style="margin:0 0 8px;font-size:20px;color:#b91c1c;">Download unavailable</h1>
<p style="color:#6b6880;font-size:14px;line-height:1.6;">${message}</p>
<p style="color:#6b6880;font-size:12px;">3S Verse · Connect@3SVerse.com</p>
</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/* ------------------------------- handler ------------------------------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") return infoPage();

    if (url.pathname === "/order") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      if (request.method !== "POST") {
        return jsonCors(request, 405, { ok: false, error: "Method not allowed." });
      }
      return handleOrderPost(request, env);
    }

    if (url.pathname !== "/download") {
      return errorPage(404, "Unknown path — use /download?order=…&product=…");
    }

    if (!env.GH_TOKEN) {
      return errorPage(500, "Gateway is not configured yet (missing GH_TOKEN).");
    }

    const orderNo = (url.searchParams.get("order") || "").trim().toUpperCase();
    const product = (url.searchParams.get("product") || "bundle").trim().toLowerCase();

    let verdict;
    try {
      const ledger = await loadLedger(env);
      verdict = validate(ledger, orderNo, product);
    } catch (err) {
      return errorPage(502, `Could not verify orders (${err.message}). Try again in a minute.`);
    }
    if (!verdict.ok) return errorPage(verdict.status, verdict.message);

    /* Bundle (or any order covering several tools) → picker page. */
    if (product === "bundle" && verdict.products.length > 1) {
      return bundlePage(orderNo, verdict.products);
    }

    const target = verdict.products[0];
    const conf = ASSET_MAP[target];
    try {
      const asset = await findAsset(env, conf.repo, conf.asset);
      const owner = env.OWNER || OWNER_DEFAULT;
      const upstream = await fetch(
        `https://api.github.com/repos/${owner}/${conf.repo}/releases/assets/${asset.id}`,
        { headers: ghHeaders(env.GH_TOKEN, true), redirect: "follow" },
      );
      if (!upstream.ok || !upstream.body) {
        return errorPage(502, `Could not fetch the build (${upstream.status}). Try again shortly.`);
      }
      const headers = new Headers();
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename="${asset.name}"`);
      if (asset.size) headers.set("Content-Length", String(asset.size));
      headers.set("Cache-Control", "no-store");
      headers.set("X-3SV-Order", orderNo);
      headers.set("X-3SV-Build", asset.tag);
      return new Response(upstream.body, { status: 200, headers });
    } catch (err) {
      return errorPage(502, `Could not fetch the build (${err.message}). Try again shortly.`);
    }
  },
};
