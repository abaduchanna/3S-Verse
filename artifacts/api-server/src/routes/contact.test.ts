import { once } from "node:events";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "../app";

const originalFetch = globalThis.fetch;
const originalResendApiKey = process.env["RESEND_API_KEY"];
const resendRequests: Array<{ init?: RequestInit; url: string }> = [];
let server: Server;
let baseUrl: string;

const validContact = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  organization: "Analytical Engines",
  message: "We would like to discuss a new project.",
};

async function submit(body: Record<string, unknown>, ip: string) {
  return originalFetch(`${baseUrl}/api/contact`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

before(async () => {
  process.env["RESEND_API_KEY"] = "test-resend-key";

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://api.resend.com/emails") {
      resendRequests.push({ init, url });
      return new Response(JSON.stringify({ id: "test-email-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return originalFetch(input, init);
  };

  server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalResendApiKey === undefined) {
    delete process.env["RESEND_API_KEY"];
  } else {
    process.env["RESEND_API_KEY"] = originalResendApiKey;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("POST /api/contact", () => {
  test("delivers a valid inquiry through the mocked Resend API", async () => {
    const response = await submit(validContact, "192.0.2.10");

    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), { ok: true });
    assert.equal(resendRequests.length, 1);

    const request = resendRequests[0];
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(request.init?.headers instanceof Headers, false);
    const headers = request.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-resend-key");

    const payload = JSON.parse(String(request.init?.body)) as Record<string, unknown>;
    assert.deepEqual(payload.to, ["Connect@3SVerse.com"]);
    assert.equal(payload.reply_to, validContact.email);
    assert.equal(payload.subject, `New project inquiry from ${validContact.name}`);
    assert.match(String(payload.text), /Analytical Engines/);
  });

  test("keeps the existing required-field and email validation errors", async () => {
    const missingRequiredField = await submit(
      { ...validContact, message: "" },
      "192.0.2.11",
    );
    assert.equal(missingRequiredField.status, 400);
    assert.deepEqual(await responseJson(missingRequiredField), {
      error: "Name, email, organization, and message are required.",
    });

    const invalidEmail = await submit(
      { ...validContact, email: "not-an-email" },
      "192.0.2.12",
    );
    assert.equal(invalidEmail.status, 400);
    assert.deepEqual(await responseJson(invalidEmail), {
      error: "Please provide a valid email address.",
    });
    assert.equal(resendRequests.length, 1);
  });

  test("rejects honeypot submissions without calling Resend", async () => {
    const response = await submit(
      { ...validContact, website: "https://spam.example" },
      "192.0.2.13",
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await responseJson(response), {
      error: "Unable to process this submission.",
    });
    assert.equal(resendRequests.length, 1);
  });

  test("returns 429 with Retry-After on the sixth request from one IP", async () => {
    const ip = "192.0.2.14";

    for (let requestNumber = 1; requestNumber <= 5; requestNumber += 1) {
      const response = await submit(
        { ...validContact, message: `Inquiry ${requestNumber}` },
        ip,
      );
      assert.equal(response.status, 200);
    }

    const response = await submit(validContact, ip);

    assert.equal(response.status, 429);
    const retryAfter = response.headers.get("Retry-After");
    assert.ok(retryAfter);
    assert.match(retryAfter, /^\d+$/);
    assert.ok(Number(retryAfter) >= 1);
    assert.deepEqual(await responseJson(response), {
      error: "Too many messages from this address. Please try again later.",
    });
    assert.equal(resendRequests.length, 6);
  });
});