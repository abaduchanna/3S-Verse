// Netlify Function — GET / POST /api/visits
//
// Tiny global visit counter for the footer. State lives in Netlify Blobs,
// which ships with the Functions runtime — no configuration, no external
// service, and it must NOT be added to package.json (the bundler keeps it
// external; see external_node_modules in netlify.toml).
//
//   GET  /api/visits → { count }   read-only — used when this browser
//                                  session was already counted
//   POST /api/visits → { count }   increments once per browser session
//                                  (the client guards with sessionStorage)
//
// When the store is unreachable the endpoint degrades to 503 and the
// footer simply hides the counter — it must never break the page.

const STORE_NAME = "site-stats";
const COUNT_KEY = "pageviews";
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_BUMPS_PER_WINDOW = 20;

/** Best-effort spam guard for POST — mirrors the contact function. */
const bumpTimestamps = new Map<string, number[]>();

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

/** Returns Retry-After seconds when the client is over the limit, else null. */
function rateLimitRetryAfter(key: string): number | null {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  for (const [mapKey, timestamps] of bumpTimestamps) {
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length === 0) {
      bumpTimestamps.delete(mapKey);
    } else {
      bumpTimestamps.set(mapKey, recent);
    }
  }

  const timestamps = bumpTimestamps.get(key) ?? [];
  if (timestamps.length >= MAX_BUMPS_PER_WINDOW) {
    return Math.max(
      1,
      Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
  }

  timestamps.push(now);
  bumpTimestamps.set(key, timestamps);
  return null;
}

function isCount(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= 0
  );
}

/** Either a usable count, or the reason the counter is down (surfaced as a
 * short `detail` on the 503 so storage issues can be diagnosed from the
 * endpoint itself — it never contains secrets). */
type CountResult = { ok: true; count: number } | { ok: false; detail: string };

async function readCount(): Promise<CountResult> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const value = await store.get(COUNT_KEY, { type: "json" });
    return { ok: true, count: isCount(value) ? value : 0 };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[visits] read failed — ${detail}`);
    return { ok: false, detail };
  }
}

async function bumpCount(): Promise<CountResult> {
  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const current = await store.get(COUNT_KEY, { type: "json" });
    // A corrupt or missing value restarts the count instead of 500-ing.
    const next = (isCount(current) ? current : 0) + 1;
    await store.setJSON(COUNT_KEY, next);
    return { ok: true, count: next };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[visits] increment failed — ${detail}`);
    return { ok: false, detail };
  }
}

export default async function handler(req: Request): Promise<Response> {
  const unavailable = (result: { ok: false; detail: string }) =>
    json(503, {
      error: "Visit counter is not available.",
      detail: result.detail.slice(0, 160),
    });

  if (req.method === "GET") {
    const result = await readCount();
    return result.ok
      ? json(200, { count: result.count })
      : unavailable(result);
  }

  if (req.method === "POST") {
    const retryAfter = rateLimitRetryAfter(clientKey(req));
    if (retryAfter !== null) {
      const result = await readCount();
      return json(
        429,
        {
          error: "Too many requests.",
          ...(result.ok ? { count: result.count } : {}),
        },
        { "Retry-After": String(retryAfter) },
      );
    }
    const result = await bumpCount();
    return result.ok
      ? json(200, { count: result.count })
      : unavailable(result);
  }

  return json(405, { error: "Method not allowed." }, { Allow: "GET, POST" });
}
