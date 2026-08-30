import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../frontend/api";

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
