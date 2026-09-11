// Netlify Function — POST /api/contact
//
// The Express api-server (artifacts/api-server) is NOT deployed anywhere:
// Netlify only publishes the static landing-page build, so /api/contact
// used to 404 and every contact submission failed. This serverless port
// keeps the exact same request/response contract but runs on Netlify.
//
// Zero npm dependencies — uses the platform fetch / Request / Response.
//
// Required environment variable (Netlify UI → Site configuration →
// Environment variables):
//   RESEND_API_KEY  — API key from resend.com/api-keys
//
// Optional environment variables:
//   CONTACT_TO      — inbox that receives inquiries (default Connect@3SVerse.com)
//   RESEND_FROM     — verified "From" identity (default connect@3sverse.com;
//                     requires 3sverse.com to be verified in Resend. While the
//                     domain is unverified, set this to onboarding@resend.dev —
//                     Resend then only allows delivery to your own account email.)

const CONTACT_TO = resolveEnv("CONTACT_TO") ?? "Connect@3SVerse.com";
const RESEND_FROM =
  resolveEnv("RESEND_FROM") ?? "3S Verse Website <connect@3sverse.com>";

/** Case-insensitive env lookup — the Netlify UI happily stores
 * "Resend_API_Key" while the code expects "RESEND_API_KEY" (env names are
 * case-sensitive), which silently breaks delivery. Match any casing. */
function resolveEnv(name: string): string | undefined {
  const exact = process.env[name];
  if (exact) return exact;
  const target = name.toLowerCase();
  for (const key of Object.keys(process.env)) {
    if (key.toLowerCase() === target) return process.env[key];
  }
  return undefined;
}

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_ORGANIZATION_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 5000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_CONTACT_REQUESTS_PER_WINDOW = 5;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Best-effort rate limiting — function isolates are ephemeral, so this
 * throttles bursts within a warm instance but is not a global guarantee. */
const requestTimestamps = new Map<string, number[]>();

type ContactBody = {
  name?: unknown;
  email?: unknown;
  organization?: unknown;
  message?: unknown;
  website?: unknown;
};

function json(
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

  for (const [mapKey, timestamps] of requestTimestamps) {
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length === 0) {
      requestTimestamps.delete(mapKey);
    } else {
      requestTimestamps.set(mapKey, recent);
    }
  }

  const timestamps = requestTimestamps.get(key) ?? [];
  if (timestamps.length >= MAX_CONTACT_REQUESTS_PER_WINDOW) {
    return Math.max(
      1,
      Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
  }

  timestamps.push(now);
  requestTimestamps.set(key, timestamps);
  return null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed." }, { Allow: "POST" });
  }

  let body: ContactBody;
  try {
    body = (await req.json()) as ContactBody;
  } catch {
    return json(400, { error: "Invalid request body." });
  }

  const website = readText(body.website, 200);
  if (website) {
    // Honeypot field must stay empty — silently reject bots.
    return json(400, { error: "Unable to process this submission." });
  }

  const name = readText(body.name, MAX_NAME_LENGTH);
  const email = readText(body.email, MAX_EMAIL_LENGTH);
  const organization = readText(body.organization, MAX_ORGANIZATION_LENGTH);
  const message = readText(body.message, MAX_MESSAGE_LENGTH);

  if (!name || !email || !organization || !message) {
    return json(
      400,
      { error: "Name, email, organization, and message are required." },
    );
  }

  if (!emailPattern.test(email)) {
    return json(400, { error: "Please provide a valid email address." });
  }

  const retryAfter = rateLimitRetryAfter(clientKey(req));
  if (retryAfter !== null) {
    return json(
      429,
      { error: "Too many messages from this address. Please try again later." },
      { "Retry-After": String(retryAfter) },
    );
  }

  const apiKey = resolveEnv("RESEND_API_KEY");
  if (!apiKey) {
    console.error(
      "[contact] RESEND_API_KEY is not set — email delivery is not configured.",
    );
    return json(503, { error: "Email delivery is not configured." });
  }

  const text = [
    "New project inquiry from the 3S Verse website",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Organization: ${organization}`,
    "",
    "Message:",
    message,
  ].join("\n");

  const sendViaResend = async (fromAddress: string) => {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [CONTACT_TO],
        reply_to: email,
        subject: `New project inquiry from ${name}`.replace(/[\r\n]+/g, " "),
        text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, body };
  };

  try {
    let result = await sendViaResend(RESEND_FROM);

    // Resend refuses a "From" address on a domain that isn't verified yet.
    // Retry once with Resend's sandbox sender — it only delivers to the
    // Resend account's own email address, so it can never misdeliver.
    if (!result.ok && result.status === 403 && /domain|verif/i.test(result.body)) {
      console.error(
        `[contact] From-domain rejected by Resend — retrying with onboarding@resend.dev. body=${result.body.slice(0, 400)}`,
      );
      result = await sendViaResend("onboarding@resend.dev");
    }

    if (!result.ok) {
      console.error(
        `[contact] Resend rejected submission — status=${result.status} body=${result.body.slice(0, 600)}`,
      );
      return json(502, { error: "The message could not be delivered right now." });
    }

    const data = (() => {
      try {
        return JSON.parse(result.body) as { id?: string };
      } catch {
        return null;
      }
    })();
    console.log(
      `[contact] Inquiry from ${email} accepted by Resend — id=${data?.id ?? "unknown"}`,
    );
    return json(200, { ok: true });
  } catch (error) {
    console.error(
      `[contact] Submission failed — ${error instanceof Error ? error.message : String(error)}`,
    );
    return json(502, { error: "The message could not be delivered right now." });
  }
}
