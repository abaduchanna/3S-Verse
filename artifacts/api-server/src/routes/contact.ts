import { Router, type IRouter, type RequestHandler } from "express";

const router: IRouter = Router();

const CONTACT_EMAIL = "Connect@3SVerse.com";
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_ORGANIZATION_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 5000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_CONTACT_REQUESTS_PER_WINDOW = 5;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const contactRequestTimestamps = new Map<string, number[]>();

type ContactBody = {
  name?: unknown;
  email?: unknown;
  organization?: unknown;
  message?: unknown;
  website?: unknown;
};

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const contactRateLimit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  for (const [key, timestamps] of contactRequestTimestamps) {
    const recentTimestamps = timestamps.filter((timestamp) => timestamp > windowStart);
    if (recentTimestamps.length === 0) {
      contactRequestTimestamps.delete(key);
    } else {
      contactRequestTimestamps.set(key, recentTimestamps);
    }
  }

  const clientKey = req.ip || req.socket.remoteAddress || "unknown";
  const timestamps = contactRequestTimestamps.get(clientKey) ?? [];

  if (timestamps.length >= MAX_CONTACT_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
    );
    res.set("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      error: "Too many messages from this address. Please try again later.",
    });
    return;
  }

  timestamps.push(now);
  contactRequestTimestamps.set(clientKey, timestamps);
  next();
};

router.post("/contact", contactRateLimit, async (req, res) => {
  const body = (req.body ?? {}) as ContactBody;
  const name = readText(body.name, MAX_NAME_LENGTH);
  const email = readText(body.email, MAX_EMAIL_LENGTH);
  const organization = readText(body.organization, MAX_ORGANIZATION_LENGTH);
  const message = readText(body.message, MAX_MESSAGE_LENGTH);
  const website = readText(body.website, 200);

  if (website) {
    res.status(400).json({ error: "Unable to process this submission." });
    return;
  }

  if (!name || !email || !organization || !message) {
    res.status(400).json({ error: "Name, email, organization, and message are required." });
    return;
  }

  if (!emailPattern.test(email)) {
    res.status(400).json({ error: "Please provide a valid email address." });
    return;
  }

  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "Email delivery is not configured." });
    return;
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

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "3S Verse Website <connect@3sverse.com>",
        to: [CONTACT_EMAIL],
        reply_to: email,
        subject: `New project inquiry from ${name}`,
        text,
      }),
    });

    if (!response.ok) {
      req.log?.error({ statusCode: response.status }, "Resend rejected contact submission");
      res.status(502).json({ error: "The message could not be delivered right now." });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    req.log?.error({ err: error }, "Contact submission failed");
    res.status(502).json({ error: "The message could not be delivered right now." });
  }
});

export default router;