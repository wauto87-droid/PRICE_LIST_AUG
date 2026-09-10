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
  activity,
  details,
} from "../backend/price-watcher/service";
import {
  activityColumns,
  groupColumns,
  staffColumns,
} from "../shared/price-watch";
import {
  priceWatcherHtml,
  exportPriceWatcherXlsx,
  priceWatcherOutputDir,
} from "../backend/worker/price-watcher";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
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
  const history = await activity(db, actor, {}, true);
  assert.equal(history.total, 2);
  assert.deepEqual(
    history.items.map((x) => Number(x.final_excl)),
    [80, 90],
  );
  assert.ok(
    history.items.every(
      (x) => x.stage === "LOOKUP" && x.quotation_id === quote.id,
    ),
  );
  const calculationId = randomUUID();
  const payload = {
    interactionId,
    calculationId,
    line: { ...line, discount: "30" },
  };
  await captureLookup(db, actor, payload);
  const captured = await one(
    db,
    "SELECT snapshot,captured_at FROM price_lookup_history WHERE id=$1",
    [calculationId],
  );
  await captureLookup(db, actor, payload);
  assert.deepEqual(
    await one(
      db,
      "SELECT snapshot,captured_at FROM price_lookup_history WHERE id=$1",
      [calculationId],
    ),
    captured,
  );
  assert.equal((await activity(db, actor, {}, true)).total, 3);
  assert.equal(
    (await one(db, "SELECT final_excl FROM price_watch_events WHERE id=$1", [
      interactionId,
    ]))!.final_excl,
    "80.00",
    "late lookup must not overwrite a quotation",
  );
  await assert.rejects(
    captureLookup(db, actor, { ...payload, line: { ...line, discount: "40" } }),
    /already used/,
  );
  assert.equal(
    (
      await activity(
        db,
        { ...actor, id: randomUUID(), permissions: ["PRODUCT_VIEW"] },
        { actorId: actor.id },
        true,
      )
    ).total,
    0,
    "personal history cannot be widened with another actor filter",
  );
  await assert.rejects(
    dashboard(db, { ...actor, permissions: ["PRODUCT_VIEW"] }, {}),
  );
  for (const direction of ["asc", "desc"]) {
    for (const c of activityColumns)
      assert.equal(
        (await activity(db, actor, { sort: c.key, direction })).total,
        4,
      );
    for (const c of groupColumns)
      assert.equal(
        (await dashboard(db, actor, { view: "GROUPS", sort: c.key, direction }))
          .groups.length,
        1,
      );
    for (const c of staffColumns)
      assert.equal(
        (
          await dashboard(db, actor, {
            staffSort: c.key,
            staffDirection: direction,
          })
        ).staff.length,
        1,
      );
  }
  await assert.rejects(
    activity(db, actor, { sort: "subtotal; DROP TABLE users" }),
    /Unsupported/,
  );
  const ascending = await activity(
    db,
    actor,
    { sort: "final_excl", direction: "asc", pageSize: 1 },
    true,
  );
  const next = await activity(
    db,
    actor,
    { sort: "final_excl", direction: "asc", pageSize: 1, page: 1 },
    true,
  );
  assert.equal(Number(ascending.items[0].final_excl), 70);
  assert.equal(Number(next.items[0].final_excl), 80);
  const evidence = await details(db, actor, {
    itemKey: `CATALOG:${product.id}`,
    pageSize: 1,
    page: 999,
  });
  assert.equal(evidence.page, 3);
  assert.equal(evidence.items.length, 1);
  const html = await priceWatcherHtml(db, actor, {
    stage: "LOOKUP",
    sort: "final_excl",
    direction: "asc",
  });
  assert.ok(html.indexOf("70.00") < html.indexOf("90.00"));
  assert.match(html, /not confirmed sales/);
  const exportId = randomUUID();
  try {
    await exportPriceWatcherXlsx(db, exportId, actor, {
      stage: "LOOKUP",
      sort: "final_excl",
      direction: "asc",
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(
      path.join(priceWatcherOutputDir(), exportId + ".xlsx"),
    );
    const sheet = book.getWorksheet("Individual Activity")!;
    assert.equal(sheet.rowCount, 4);
    assert.equal(sheet.getRow(2).getCell(10).value, 70);
  } finally {
    await fs.rm(path.join(priceWatcherOutputDir(), exportId + ".xlsx"), {
      force: true,
    });
  }
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
