import test from "node:test";
import assert from "node:assert/strict";
import { api, readApiResponse } from "../frontend/api";

test("API helper parses JSON responses", async () => {
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
  assert.deepEqual(await readApiResponse(response), { ok: true });
});

test("API helper turns HTML responses into a readable error", async () => {
  const response = new Response("<!DOCTYPE html><html></html>", {
    status: 500,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  await assert.rejects(
    () => readApiResponse(response),
    /returned a page instead of app data/i,
  );
});

test("WhatsApp service failure stays local while transport failure signals offline", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  let lost = 0;
  events.addEventListener("amt-connection-lost", () => lost++);
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "WhatsApp service is unreachable" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
    await assert.rejects(api("storefront-admin/whatsapp/status"), (error: any) =>
      error.status === 503 && error.message === "WhatsApp service is unreachable");
    assert.equal(lost, 0, "A WhatsApp outage must not disable Commercial operations");

    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(api("storefront-admin/management"), /Failed to fetch/);
    assert.equal(lost, 1, "Actual network failures must still signal offline");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
