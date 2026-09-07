import test from "node:test";
import assert from "node:assert/strict";
import { whatsapp } from "../backend/storefront/whatsapp";
test("WhatsApp transport exposes actionable 503 errors without leaking credentials", async () => {
  const fetch = globalThis.fetch;
  const url = process.env.WHATSAPP_SERVICE_URL, token = process.env.WHATSAPP_SERVICE_TOKEN;
  process.env.WHATSAPP_SERVICE_URL = "http://127.0.0.1:3010";
  process.env.WHATSAPP_SERVICE_TOKEN = "test-secret-do-not-expose";
  try {
    globalThis.fetch = async () => new Response("", {status:401});
    await assert.rejects(whatsapp("status"), (e: any) => e.status === 503 && /same service token/.test(e.message) && !e.message.includes("test-secret"));
    globalThis.fetch = async () => { throw new Error("private transport details"); };
    await assert.rejects(whatsapp("status"), (e: any) => e.status === 503 && /unreachable/.test(e.message) && !e.message.includes("private transport"));
  } finally {
    globalThis.fetch = fetch;
    if (url === undefined) delete process.env.WHATSAPP_SERVICE_URL; else process.env.WHATSAPP_SERVICE_URL = url;
    if (token === undefined) delete process.env.WHATSAPP_SERVICE_TOKEN; else process.env.WHATSAPP_SERVICE_TOKEN = token;
  }
});
