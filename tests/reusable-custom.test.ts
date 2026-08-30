import test from "node:test";
import assert from "node:assert/strict";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import { saveDraft } from "../backend/quotations/service";
import {
  search,
  list,
  update,
  convert,
} from "../backend/reusable-custom/service";

test("Reusable custom items are deduplicated, reusable, admin-managed, and safely converted", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "reusable-custom-setup-token-long-enough";
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
  const line = {
    type: "CUSTOM" as const,
    partNumber: "SPECIAL-1",
    description: "Special fabricated panel",
    unit: "pcs",
    quantity: "2",
    unitPriceExcl: "100",
    discount: "5",
  };
  await assert.rejects(
    saveDraft(
      db,
      actor,
      { customer: {}, lines: [{ ...line, quantity: "0" }] },
      {},
    ),
  );
  assert.equal(
    (await one(db, "SELECT count(*)::int n FROM reusable_custom_items"))!.n,
    0,
  );
  const first: any = await saveDraft(
    db,
    actor,
    { customer: { name: "First" }, lines: [line] },
    {},
  );
  assert.ok(first.lines[0].reusableItemId);
  assert.equal(first.lines[0].reusableResolution, "CREATED");
  assert.equal(
    first.lines[0].input.reusableItemId,
    first.lines[0].reusableItemId,
  );
  let saved: any[] = await search(db, actor, "special");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].usage_count, 1);
  const reusableId = saved[0].id;
  await saveDraft(
    db,
    actor,
    {
      customer: first.customer,
      lines: first.lines.map((savedLine: any) => savedLine.input),
    },
    {},
    first.id,
    first.version,
  );
  saved = await search(db, actor, "special");
  assert.equal(saved[0].usage_count, 1);
  const staffActor = { ...actor, permissions: ["QUOTE_CREATE", "QUOTE_EDIT"] };
  assert.equal((await search(db, staffActor, "special")).length, 1);
  await assert.rejects(list(db, staffActor, "", "ALL"), /permission/i);
  const second: any = await saveDraft(
    db,
    actor,
    {
      customer: { name: "Second" },
      lines: [
        {
          ...line,
          partNumber: " special-1 ",
          description: "Different quotation wording",
          unitPriceExcl: "125",
        },
      ],
    },
    {},
  );
  assert.equal(second.lines[0].reusableItemId, reusableId);
  assert.equal(second.lines[0].reusableResolution, "EXISTING");
  saved = await search(db, actor, "special");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].usage_count, 2);
  assert.equal(saved[0].suggestedUnitPrice, "100.000000");
  await saveDraft(
    db,
    actor,
    {
      customer: {},
      lines: [
        { ...line, partNumber: "SECOND", description: "Second custom item" },
      ],
    },
    {},
  );
  const secondSaved = (await search(db, actor, "Second custom"))[0];
  await assert.rejects(
    update(db, actor, secondSaved.id, {
      reference: "SPECIAL-1",
      description: "Second custom item",
      unit: "pcs",
      suggestedUnitPrice: "100",
      suggestedDiscount: "5",
      version: secondSaved.version,
    }),
    /already exists/i,
  );
  const third: any = await saveDraft(
    db,
    actor,
    {
      customer: {},
      lines: [
        {
          ...line,
          partNumber: "OTHER",
          description: "  special   fabricated PANEL ",
          unitPriceExcl: "150",
        },
      ],
    },
    {},
  );
  assert.equal(third.lines[0].reusableItemId, reusableId);
  const changed: any = await update(db, actor, reusableId, {
    reference: "SPECIAL-1",
    description: "Special fabricated panel - reviewed",
    unit: "set",
    suggestedUnitPrice: "110",
    suggestedDiscount: "7",
    version: saved[0].version,
  });
  assert.equal(changed.unit, "set");
  const product: any = await convert(db, actor, reusableId, {
    version: changed.version,
    product: {
      partNumber: "SPECIAL-1",
      description: "Special fabricated panel - reviewed",
      method: "LIST_DISCOUNT",
      listPrice: "110",
      baseDiscount: "7",
      cost: "0",
      markup: "0",
      vat: "15",
      minimumEnabled: false,
      minimum: "0",
      unit: "set",
      quantityPrecision: 0,
      active: true,
      aliases: [],
      keywords: "",
      brand: "",
      category: "",
    },
  });
  assert.ok(product.id);
  assert.equal((await search(db, actor, "SPECIAL-1")).length, 0);
  const converted: any[] = await list(db, actor, "SPECIAL-1", "CONVERTED");
  assert.equal(converted[0].product_id, product.id);
  await assert.rejects(
    saveDraft(db, actor, { customer: {}, lines: [line] }, {}),
    (error: any) =>
      error.status === 409 &&
      error.details?.code === "CATALOG_MATCH" &&
      error.details?.productId === product.id,
  );
  const original = await one(db, "SELECT lines FROM quotations WHERE id=$1", [
    first.id,
  ]);
  assert.equal(original!.lines[0].description, "Special fabricated panel");
  assert.equal(original!.lines[0].price.finalExcl, "95.00");
  await db.close?.();
});
