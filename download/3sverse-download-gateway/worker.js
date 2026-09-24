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
 *   2. Load ledger/orders.json from the PRIVATE 3SVerse_License_Server
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
 *                         3SVerse_License_Server, VidaPay_Incentive_Extractor,
 *                         VidaPay_Device_Ordering, VidaPay_Rebate_Filing
 *     LEDGER_WRITE_TOKEN  fine-grained PAT, Contents: Read+Write on
 *                         3SVerse_License_Server ONLY (the Studio
 *                         admin token works) — used by POST /order to
 *                         file orders into the inbox
 *   Variables (plain text):
 *     LEDGER_REPO   "abaduchanna/3SVerse_License_Server"
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
const LEDGER_REPO_DEFAULT = "abaduchanna/3SVerse_License_Server";
const LEDGER_PATH_DEFAULT = "ledger/orders.json";
const INBOX_DIR_DEFAULT = "ledger/orders_inbox";
const CACHE_SECONDS = 300;

/* Trial builds live in the PUBLIC 3sverse-downloads repo (GitHub serves
   them directly). The /trial route puts the same Turnstile gate in front
   of those public links so scrapers/bots cannot hammer them at scale. */
const TRIAL_DOWNLOADS_BASE =
  "https://github.com/abaduchanna/3sverse-downloads/releases/latest/download/";
const TRIAL_ASSETS = {
  extractor: "VidaPay_Incentive_Extractor_TRIAL.exe",
  ordering: "VidaPay_Device_Ordering_TRIAL.exe",
  rebate: "VidaPay_Rebate_Filing_TRIAL.exe",
};

/* --------------------------- Turnstile (bot gate) -----------------------
   Add these in Worker → Settings → Variables to switch the protection on:
     TURNSTILE_SITE_KEY   (plain text, from the CF dashboard widget)
     TURNSTILE_SECRET_KEY (secret, from the same widget)
   While either is missing the worker behaves exactly like the previous
   version (no challenge) so the rollout can be staged. */
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileConfigured(env) {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

async function verifyTurnstile(env, token, ip) {
  if (!turnstileConfigured(env)) return true; // protection not switched on
  if (!token) return false;
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: String(body),
    });
    const data = await res.json();
    return Boolean(data.success);
  } catch {
    return false; // fail closed when the gate is on
  }
}

/* Challenge page: renders the widget, and on success re-requests the same
   URL with &ct=<token> so the worker can verify it server-side. */
function challengePage(request, env, nextUrl) {
  if (!turnstileConfigured(env)) {
    // Unreachable in normal flow (verify passes when unconfigured) — kept
    // as a safe fallback so a relative nextUrl can never hit Response.redirect.
    return errorPage(500, "Download gate is not configured yet.");
  }
  const siteKey = env.TURNSTILE_SITE_KEY;
  const sep = nextUrl.includes("?") ? "&" : "?";
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>3S Verse — quick check</title>` +
    `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer><\/script>` +
    `</head><body style="font-family:Arial,sans-serif;background:#f4f3f8;padding:40px;text-align:center;">` +
    `<div style="max-width:420px;margin:60px auto 0;background:#fff;border:1px solid #e6e4ee;border-radius:12px;padding:36px;">` +
    `<h1 style="margin:0 0 8px;font-size:19px;">Quick security check</h1>` +
    `<p style="color:#6b6880;font-size:13px;line-height:1.6;margin:0 0 20px;">This one-click check keeps downloads fast and bot-free for everyone.</p>` +
    `<div id="tsbox" style="display:flex;justify-content:center;"></div>` +
    `<p id="tserr" style="color:#b91c1c;font-size:12px;display:none;">Check failed — please try again.</p>` +
    `<p style="color:#6b6880;font-size:12px;margin-top:18px;">3S Verse · Connect@3SVerse.com</p>` +
    `</div>` +
    `<script>
      function _onToken(token){
        window.location.href = ${JSON.stringify(nextUrl + sep + "ct=")} + encodeURIComponent(token);
      }
      window._tsOnToken = _onToken;
      window.onload = function(){
        function render(){
          if (!window.turnstile){ setTimeout(render, 200); return; }
          try {
            turnstile.render("#tsbox", { sitekey: ${JSON.stringify(siteKey)}, callback: _onToken, "error-callback": function(){ document.getElementById("tserr").style.display="block"; } });
          } catch(e){ document.getElementById("tserr").style.display="block"; }
        }
        render();
      };
    <\/script>` +
    `</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/* Order intake + contact relay rate limit (per IP): 5 orders / 15 min,
   10 contact posts / 15 min. */
const INBOX_WINDOW_MS = 15 * 60 * 1000;
const INBOX_MAX_PER_WINDOW = 5;
const CONTACT_WINDOW_MS = 15 * 60 * 1000;
const CONTACT_MAX_PER_WINDOW = 10;
const hitWindows = new Map(); // "kind:ip" → [timestamps]

function rateLimited(kind, ip, windowMs, maxPerWindow) {
  const now = Date.now();
  const k = kind + ":" + ip;
  const recent = (hitWindows.get(k) || []).filter((t) => now - t < windowMs);
  if (recent.length >= maxPerWindow) {
    hitWindows.set(k, recent);
    return true;
  }
  recent.push(now);
  hitWindows.set(k, recent);
  return false;
}

function inboxIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/* product → private repo + release asset name (the FULL builds).
   "bundle" is expanded to all three products at validation time. */
const ASSET_MAP = {
  extractor: { repo: "VidaPay_Incentive_Extractor", asset: "VidaPay_Incentive_Extractor_FULL.exe" },
  ordering: { repo: "VidaPay_Device_Ordering", asset: "VidaPay_Device_Ordering_FULL.exe" },
  rebate: { repo: "VidaPay_Rebate_Filing", asset: "VidaPay_Rebate_Filing_FULL.exe" },
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
  const ip = inboxIp(request);
  if (rateLimited("order", ip, INBOX_WINDOW_MS, INBOX_MAX_PER_WINDOW)) {
    return jsonCors(request, 429, { ok: false, error: "Too many orders — please try again later." });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonCors(request, 400, { ok: false, error: "Invalid request body." });
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
    return jsonCors(request, 403, { ok: false, error: "Security check failed or missing — please retry the order." });
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
<p style="color:#6b6880;font-size:12px;">Routes: /download?order=…&product=… · /trial?product=… · POST /order · POST /contact</p>
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
/* ------------------- contact relay (Turnstile-gated) --------------------
   The website's forms post here; the worker verifies the Turnstile token
   server-side and only then relays the payload to FormSubmit. This gives
   the static site (GitHub Pages) a real server-side bot gate. */
const FORUM_SUBMIT_URL = "https://formsubmit.co/ajax/connect@3sverse.com";
const CONTACT_ALLOWED_FIELDS = new Set([
  "name", "email", "store", "company", "tool", "rating", "review", "text",
  "message", "phone", "messenger", "notes", "_subject", "_template",
  "_replyto", "_autoresponse", "_honey",
]);

async function handleContactPost(request, env) {
  const ip = inboxIp(request);
  if (rateLimited("contact", ip, CONTACT_WINDOW_MS, CONTACT_MAX_PER_WINDOW)) {
    return jsonCors(request, 429, { ok: false, error: "Too many messages — please try again later." });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonCors(request, 400, { ok: false, error: "Invalid request body." });
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
    return jsonCors(request, 403, { ok: false, error: "Security check failed or missing — please retry." });
  }
  if (body._honey) {
    // Honeypot filled -> almost certainly a bot. Pretend success, send nothing.
    return jsonCors(request, 200, { ok: true });
  }
  const fields = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (k === "turnstileToken" || k === "website") continue;
    if (!CONTACT_ALLOWED_FIELDS.has(k)) continue;
    fields[k] = typeof v === "string" ? v.slice(0, 4000) : v;
  }
  if (!fields.name && !fields.email && !fields._subject) {
    return jsonCors(request, 400, { ok: false, error: "Nothing to send." });
  }
  try {
    const upstream = await fetch(FORUM_SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(fields),
    });
    const payload = await upstream.json().catch(() => ({}));
    return jsonCors(request, upstream.ok && payload.success === "true" ? 200 : 502,
      upstream.ok && payload.success === "true"
        ? { ok: true }
        : { ok: false, error: "The mail relay rejected the message — please email Connect@3SVerse.com directly." });
  } catch {
    return jsonCors(request, 502, { ok: false, error: "Mail relay unreachable — please email Connect@3SVerse.com directly." });
  }
}

/* ------------------------------- router -------------------------------- */
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

    if (url.pathname === "/contact") {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      if (request.method !== "POST") {
        return jsonCors(request, 405, { ok: false, error: "Method not allowed." });
      }
      return handleContactPost(request, env);
    }

    if (url.pathname === "/trial") {
      const tproduct = (url.searchParams.get("product") || "").trim().toLowerCase();
      const asset = TRIAL_ASSETS[tproduct];
      if (!asset) {
        return errorPage(404, "Unknown trial product — use /trial?product=extractor|ordering|rebate.");
      }
      const target = TRIAL_DOWNLOADS_BASE + asset;
      const ct = url.searchParams.get("ct") || "";
      if (!(await verifyTurnstile(env, ct, inboxIp(request)))) {
        return challengePage(request, env, url.pathname + "?product=" + encodeURIComponent(tproduct));
      }
      return Response.redirect(target, 302);
    }

    if (url.pathname !== "/download") {
      return errorPage(404, "Unknown path — use /download?order=…&product=…");
    }

    /* Paid-download Turnstile gate: first hit (no ct token) shows the
       one-click check; the widget bounces back with &ct=<token> which is
       verified server-side before a single byte of the build is served. */
    {
      const ct = url.searchParams.get("ct") || "";
      if (!(await verifyTurnstile(env, ct, inboxIp(request)))) {
        const qs = new URLSearchParams(url.search);
        qs.delete("ct");
        return challengePage(request, env, url.pathname + "?" + qs.toString());
      }
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
