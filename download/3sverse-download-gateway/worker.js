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
 *   GET /                                             → info page
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
 *     GH_TOKEN  fine-grained PAT, Contents: Read-only on
 *               vidapay-license-server, vidapay-extractor,
 *               vidapay-ordering, vidapay-rebate-filing
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
const CACHE_SECONDS = 300;

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
