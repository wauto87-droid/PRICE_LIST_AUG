import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { APP_BASE_PATH, appPath } from "../shared/paths";
import { sessionCookie } from "../backend/auth/service";
import { handle } from "../backend/api/router";
import { embedded, migrate } from "../backend/core/db";

test("base path is applied to API/assets/documents and cookies", () => {
  assert.equal(APP_BASE_PATH, "/amt_price_list");
  assert.equal(appPath("api/v1/health"), "/amt_price_list/api/v1/health");
  assert.match(sessionCookie("token"), /Path=\/amt_price_list\//);
  const sources = ["frontend/api.ts", "frontend/Admin.tsx", "frontend/Imports.tsx", "frontend/Quotations.tsx", "app/page.tsx"]
    .map((path) => fs.readFileSync(path, "utf8")).join("\n");
  assert(!sources.includes('fetch("/api/v1/'));
  assert(!sources.includes('href={"/api/v1/'));
  assert(!sources.includes('href="/"'));
});

test("manifest and worker remain within the AMT scope", () => {
  const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.start_url, "/amt_price_list/");
  assert.equal(manifest.scope, "/amt_price_list/");
  assert(manifest.icons.every((icon: any) => icon.src.startsWith("/amt_price_list/")));
  const worker = fs.readFileSync("public/sw.js", "utf8");
  assert(worker.includes('const BASE = "/amt_price_list"'));
  assert(worker.includes('url.pathname.startsWith(BASE + "/api/")'));
});

test("backend router accepts prefixed and internal API request paths", async () => {
  const db = await embedded();
  await migrate(db);
  for (const url of [
    "http://localhost/amt_price_list/api/v1/health",
    "http://localhost/api/v1/health",
  ]) {
    const response = await handle(new Request(url), db);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  await db.close?.();
});
