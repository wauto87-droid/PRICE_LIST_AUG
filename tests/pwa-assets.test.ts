import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
test("PWA manifest, scoped icons and service worker are complete and API-safe", async () => {
  const manifest = JSON.parse(
    await fs.readFile("public/manifest.webmanifest", "utf8"),
  );
  assert.equal(manifest.id, "/amt_price_list/");
  assert.equal(manifest.start_url, "/amt_price_list/");
  assert.equal(manifest.scope, "/amt_price_list/");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    assert(icon.src.startsWith("/amt_price_list/"));
    await fs.access("public/" + icon.src.split("/").pop());
  }
  const sw = await fs.readFile("public/sw.js", "utf8");
  assert(sw.includes('url.pathname.startsWith(BASE + "/api/")'));
  assert(sw.includes("if (DEVELOPMENT_HOST) return"));
  assert(!sw.match(/cache\.put\([^\n]*api/i));
});
