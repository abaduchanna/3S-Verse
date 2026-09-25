#!/usr/bin/env node
/**
 * generate-routes.mjs — post-vite-build step (run after `vite build`).
 *
 * GitHub Pages has no SPA fallback, so deep paths used to hit the 404 shim
 * (status 404 + JS redirect). Google Search Console therefore saw every
 * friendly shortcut as "Not found (404)" and none of the legal/download
 * views were indexable.
 *
 * This script turns each friendly shortcut into a REAL, indexable page:
 *   dist/public/<route>/index.html  — served by Pages with status 200.
 *
 * Each generated page:
 *   - is the full app bundle (same index.html), so the view renders
 *   - has its own <title>, <meta description> and <link rel="canonical">
 *     (replacing the homepage ones, so Google indexes clean URLs)
 *   - carries a tiny head-level shim that maps the path onto its
 *     hash-routed view (same mapping the 404 shim used) BEFORE the app
 *     bundle executes. /order needs no shim — wouter serves it at the
 *     real path.
 *
 * Aliases: /trial -> canonical /download/ (merged by Google, not in sitemap).
 * /order/ ships noindex,follow (functional tool page, not content).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url)); // package root (script lives at package root)
const dist = join(root, "dist", "public");
const indexHtml = join(dist, "index.html");

const SITE = "https://3sverse.com";

const ROUTES = {
  privacy: {
    title: "Privacy Policy — 3S Verse",
    description:
      "What 3S Verse collects, why, and the dealership data that never leaves your machines. Plain-language privacy policy for wireless dealers.",
    robots: "index,follow",
    canonical: `${SITE}/privacy/`,
    shim: "#/privacy",
  },
  terms: {
    title: "Terms & Conditions — 3S Verse",
    description:
      "The rules of doing business with 3S Verse: licenses, delivery, support and fair use — stated once, precisely, in plain English.",
    robots: "index,follow",
    canonical: `${SITE}/terms/`,
    shim: "#/terms",
  },
  refund: {
    title: "Refund Policy — 3S Verse",
    description:
      "30-day money-back guarantee on every 3S Verse license: if a tool does not do what the site promises on your dealership's data, you get a full refund.",
    robots: "index,follow",
    canonical: `${SITE}/refund/`,
    shim: "#/refund",
  },
  eula: {
    title: "End-User License Agreement — 3S Verse",
    description:
      "What your 3S Verse license covers: machines, seats, updates and the red lines — written to be read, not skimmed past.",
    robots: "index,follow",
    canonical: `${SITE}/eula/`,
    shim: "#/eula",
  },
  security: {
    title: "Security — 3S Verse",
    description:
      "Local-first by design: your dealership's data stays on your machines. How 3S Verse tools handle, store and never ship your data.",
    robots: "index,follow",
    canonical: `${SITE}/security/`,
    shim: "#/security",
  },
  about: {
    title: "About — 3S Verse",
    description:
      "Operator-built VidaPay dealer tools: local-first software that runs on your PC under your own login. Our mission, how we work and what we build — in plain English.",
    robots: "index,follow",
    canonical: `${SITE}/about/`,
    shim: "#/about",
  },
  pricing: {
    title: "Pricing — 3S Verse",
    description:
      "Per-PC pricing for the VidaPay dealer tools — free 7-day trial built into every download, lifetime one-time or monthly/annual plans, 30-day money-back guarantee.",
    robots: "index,follow",
    canonical: `${SITE}/pricing/`,
    shim: "#/pricing",
  },
  download: {
    title: "Download Free Trials — 3S Verse",
    description:
      "Free trials of every VidaPay workflow tool for wireless dealers — run each one on your own dealership data before you pay a cent.",
    robots: "index,follow",
    canonical: `${SITE}/download/`,
    shim: "#/download",
  },
  order: {
    title: "Order Status — 3S Verse",
    description:
      "Track your 3S Verse order: approval state, license keys and free re-downloads.",
    robots: "noindex,follow",
    canonical: `${SITE}/order/`,
    shim: null, // wouter serves /order at the real path — no hash redirect
  },
  trial: {
    title: "Download Free Trials — 3S Verse",
    description:
      "Free trials of every VidaPay workflow tool for wireless dealers — run each one on your own dealership data before you pay a cent.",
    robots: "index,follow",
    canonical: `${SITE}/download/`, // alias -> merge into /download/
    shim: "#/download",
  },
};

const SHIM = (view) => `<script>(function(){var p=location.pathname.replace(/\\/+$/,'').toLowerCase();var map={'/privacy':'#/privacy','/terms':'#/terms','/refund':'#/refund','/eula':'#/eula','/security':'#/security','/about':'#/about','/pricing':'#/pricing','/download':'#/download','/trial':'#/download'};var v=map[p];if(v){location.replace(location.origin+'/'+v+location.search);}})();</script>`;

function buildPage(route, meta) {
  let html = readFileSync(indexHtml, "utf-8");

  // 1. replace homepage <title> with the route title
  html = html.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${meta.title}</title>`,
  );

  // 2. replace homepage canonical with the route canonical
  html = html.replace(
    /<link\s+rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${meta.canonical}">`,
  );

  // 3. replace homepage meta description with the route description
  html = html.replace(
    /<meta\s+name="description"[^>]*>/,
    `<meta name="description" content="${meta.description.replace(/"/g, "&quot;")}">`,
  );

  // 4. robots directive (right after the canonical we just set)
  html = html.replace(
    /(<link\s+rel="canonical"[^>]*>)/,
    `$1\n    <meta name="robots" content="${meta.robots}">`,
  );

  // 5. inject the path->hash shim as the FIRST thing in <head> so it runs
  //    before the deferred module bundle boots React
  const headOpen = html.indexOf("<head>");
  if (headOpen === -1) throw new Error("no <head> in built index.html");
  const injectAt = headOpen + "<head>".length;
  const shim = meta.shim ? SHIM(meta.shim) : "";
  html =
    html.slice(0, injectAt) +
    `\n    ${shim}` +
    html.slice(injectAt);

  const dir = join(dist, route);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  return `${route}/index.html`;
}

if (!existsSync(indexHtml)) {
  console.error("generate-routes: dist/public/index.html not found — run vite build first");
  process.exit(1);
}

const written = [];
for (const [route, meta] of Object.entries(ROUTES)) {
  written.push(buildPage(route, meta));
}
console.log(`generate-routes: wrote ${written.length} route pages -> ${written.join(", ")}`);

// sanity: every generated page must have its own canonical + title
for (const [route, meta] of Object.entries(ROUTES)) {
  const html = readFileSync(join(dist, route, "index.html"), "utf-8");
  const canon = (html.match(/rel="canonical" href="([^"]+)"/) || [])[1];
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  if (canon !== meta.canonical || title !== meta.title) {
    throw new Error(`route ${route}: canonical/title injection failed`);
  }
  if (meta.shim && !html.includes("location.replace")) {
    throw new Error(`route ${route}: shim missing`);
  }
}
console.log("generate-routes: all pages verified (canonical + title + shim)");
