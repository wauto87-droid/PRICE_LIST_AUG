import test from "node:test";
import assert from "node:assert/strict";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
import {
  configuration,
  saveConfiguration,
  randomSelection,
  queue,
  get,
  processJob,
  editSuggestion,
  confirm,
} from "../backend/product-enrichment/service";

test("AI product enrichment stays staged, filters safely, and confirms without touching pricing", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "product-enrichment-setup-token-long-enough";
  process.env.AI_SECRET_ENCRYPTION_KEY = "ab".repeat(32);
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const logged = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(logged.token).split(";")[0] },
    }),
  );
  const base = {
    brand: "Schneider",
    category: "Switchgear",
    keywords: "",
    aliases: [],
    method: "LIST_DISCOUNT" as const,
    cost: "0",
    markup: "0",
    listPrice: "100",
    baseDiscount: "0",
    vat: "15",
    minimumEnabled: false,
    minimum: "0",
    unit: "pcs",
    quantityPrecision: 0,
    active: true,
  };
  const missing: any = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      ...base,
      partNumber: "AI-100",
      description: "AI-100",
    }),
  );
  await db.transaction((tx) =>
    saveProduct(tx, actor, {
      ...base,
      partNumber: "GOOD-1",
      description: "Existing proper description",
    }),
  );
  assert.deepEqual(
    (
      await randomSelection(db, actor, {
        filters: {
          query: "",
          minimumFilter: "ALL",
          statusFilter: "ALL",
          methodFilter: "ALL",
          contentFilter: "MISSING",
        },
        count: 100,
      })
    ).map((x: any) => x.id),
    [missing.id],
  );
  await saveConfiguration(db, actor, {
    apiKey: "sk-test-secret-that-must-never-leak",
    model: "gpt-5.4-nano",
  });
  assert.equal((await configuration(db, actor)).configured, true);
  const stored: any = await one(
    db,
    "SELECT encode(ciphertext,'hex') ciphertext FROM app_secrets WHERE key='OPENAI_API_KEY'",
  );
  assert.equal(
    stored.ciphertext.includes(
      Buffer.from("sk-test-secret-that-must-never-leak").toString("hex"),
    ),
    false,
  );
  const queued: any = await queue(db, actor, {
    items: [{ id: missing.id, version: missing.version }],
    filters: {
      query: "",
      minimumFilter: "ALL",
      statusFilter: "ALL",
      methodFilter: "ALL",
      contentFilter: "MISSING",
    },
  });
  const before: any = await one(
    db,
    "SELECT description,details,version FROM products WHERE id=$1",
    [missing.id],
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          status: "FOUND",
          reason: "Exact manufacturer result",
          description: "Compact auxiliary contact block",
          manufacturer: "Schneider Electric",
          productName: "Auxiliary contact block",
          productType: "Control accessory",
          series: "TeSys",
          specifications: [{ label: "Contacts", value: "2NO + 2NC" }],
          applications: ["Contactor auxiliary signalling"],
          confidence: "HIGH",
        }),
        output: [
          {
            action: {
              sources: [
                {
                  title: "Manufacturer page",
                  url: "https://example.com/product",
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    await processJob(db, queued.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
  let report: any = await get(db, actor, queued.id);
  assert.equal(report.status, "READY");
  assert.equal(report.rows[0].status, "FOUND");
  assert.deepEqual(
    await one(
      db,
      "SELECT description,details,version FROM products WHERE id=$1",
      [missing.id],
    ),
    before,
  );
  report = await editSuggestion(db, actor, report.rows[0].id, {
    suggestion: {
      description: "Reviewed auxiliary contact block",
      manufacturer: "Schneider Electric",
      productName: "Auxiliary contact block",
      productType: "Control accessory",
      series: "TeSys",
      specifications: [{ label: "Contacts", value: "2NO + 2NC" }],
      applications: ["Contactor signalling"],
      confidence: "HIGH",
    },
  });
  await confirm(db, actor, queued.id, { rowIds: [report.rows[0].id] });
  const after: any = await one(
    db,
    "SELECT p.description,p.details,p.version,pp.list_price FROM products p JOIN product_pricing pp ON pp.product_id=p.id WHERE p.id=$1",
    [missing.id],
  );
  assert.equal(after.description, "Reviewed auxiliary contact block");
  assert.equal(after.details.series, "TeSys");
  assert.equal(after.version, before.version + 1);
  assert.equal(after.list_price, "100.000000");
  await db.close?.();
});
