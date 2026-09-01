import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
import {
  captureLookup,
  captureCart,
  dashboard,
} from "../backend/price-watcher/service";
import { saveDraft } from "../backend/quotations/service";
const setupToken = "price-watcher-test-token-long-enough";
process.env.SETUP_TOKEN = setupToken;

test("Price Watcher settles revisions and promotes one interaction without double counting", async () => {
  const db = await embedded();
  await migrate(db);
  await setup(db, {
    token: setupToken,
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
  const product: any = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "WATCH-1",
      description: "Watcher item",
      brand: "",
      category: "",
      keywords: "",
      aliases: [],
      method: "LIST_DISCOUNT",
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
    }),
  );
  const interactionId = randomUUID();
  const line = {
    productId: product.id,
    sellingLevel: "END_CUSTOMER" as const,
    quantity: "2",
    discount: "10",
    override: false,
    reason: "",
    watcherEventId: interactionId,
  };
  await captureLookup(db, actor, { interactionId, line });
  await captureLookup(db, actor, {
    interactionId,
    line: { ...line, discount: "20" },
  });
  await captureCart(
    db,
    actor,
    { interactionId, line: { ...line, discount: "20" } },
    "15",
  );
  let event: any = await one(
    db,
    "SELECT * FROM price_watch_events WHERE id=$1",
    [interactionId],
  );
  assert.equal(event.stage, "CART");
  assert.equal(event.revision_count, 3);
  assert.equal(event.final_excl, "80.00");
  const quote: any = await saveDraft(
    db,
    actor,
    {
      customer: { name: "Watcher Customer" },
      lines: [{ ...line, discount: "20" }],
    },
    {},
  );
  event = await one(db, "SELECT * FROM price_watch_events WHERE id=$1", [
    interactionId,
  ]);
  assert.equal(event.stage, "DRAFT");
  assert.equal(event.quotation_id, quote.id);
  assert.equal(
    (await one(
      db,
      "SELECT count(*)::int n FROM price_watch_events WHERE id=$1",
      [interactionId],
    ))!.n,
    1,
  );
  const report: any = await dashboard(db, actor, {});
  assert.equal(report.summary.events, 1);
  assert.equal(report.summary.quantity, "2.000000");
  assert.equal(Number(report.groups[0].weighted_average), 80);
  const costProduct: any = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "WATCH-COST-1",
      description: "Cost watcher item",
      brand: "",
      category: "",
      keywords: "",
      aliases: [],
      method: "COST_MARKUP",
      cost: "50",
      markup: "25",
      listPrice: "0",
      baseDiscount: "0",
      vat: "15",
      minimumEnabled: false,
      minimum: "0",
      unit: "pcs",
      quantityPrecision: 0,
      active: true,
    }),
  );
  const markupInteractionId = randomUUID();
  await captureLookup(db, actor, {
    interactionId: markupInteractionId,
    line: {
      productId: costProduct.id,
      sellingLevel: "END_CUSTOMER",
      quantity: "1",
      discount: "0",
      markup: "10",
      override: false,
      reason: "",
    },
  });
  event = await one(db, "SELECT * FROM price_watch_events WHERE id=$1", [
    markupInteractionId,
  ]);
  assert.equal(event.final_excl, "55.00");
  assert.equal(event.requested_markup, "10.000000");
  assert.equal(event.effective_markup, "10.000000");
  await db.close?.();
});

test("Price Watcher groups reusable and standalone custom identities safely", async () => {
  const db = await embedded();
  await migrate(db);
  await setup(db, {
    token: setupToken,
    username: "admin2",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const logged = await login(db, { username: "admin2", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(logged.token).split(";")[0] },
    }),
  );
  for (const [part, description] of [
    [" Ab.c ", "First"],
    ["ab.c", "Changed"],
  ])
    await captureCart(
      db,
      actor,
      {
        line: {
          type: "CUSTOM",
          partNumber: part,
          description,
          unit: "pcs",
          quantity: "1",
          unitPriceExcl: "1600",
          discount: "0",
        },
      },
      "15",
    );
  const keys = (
    await db.query("SELECT item_key FROM price_watch_events ORDER BY item_key")
  ).rows;
  assert.deepEqual(
    keys.map((x: any) => x.item_key),
    ["CUSTOM-REF:AB.C", "CUSTOM-REF:AB.C"],
  );
  await db.close?.();
});
