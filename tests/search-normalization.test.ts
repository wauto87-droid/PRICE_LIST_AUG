import test from "node:test";
import assert from "node:assert/strict";
import { embedded, migrate } from "../backend/core/db";
import { search, saveProduct } from "../backend/products/service";
import { productInput } from "../backend/pricing/engine";

const actor: any = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Search Tester",
  role: "ADMIN",
  permissions: ["PRODUCT_VIEW", "PRODUCT_EDIT", "COST_VIEW", "MIN_PRICE_VIEW"],
  maxDiscount: "100",
};

test("Universal Part Number Search Normalization & Delimiter Matching", async (t) => {
  const db = await embedded();
  await migrate(db);

  await db.query(`
    INSERT INTO roles (id, permissions, max_discount)
    VALUES ('ADMIN', '{PRODUCT_VIEW,PRODUCT_EDIT,COST_VIEW,MIN_PRICE_VIEW}', 100)
    ON CONFLICT (id) DO NOTHING
  `);

  await db.query(`
    INSERT INTO users (id, username, name, role_id, permissions, password_hash, disabled)
    VALUES ($1, 'searchtester', $2, 'ADMIN', $3, 'hash', false)
    ON CONFLICT (id) DO NOTHING
  `, [actor.id, actor.name, actor.permissions]);

  const catalog = [
    {
      partNumber: "ABN103c-60A",
      description: "MCCB 3P 60A 22KA/380V 55DEGREE",
      brand: "LS",
      category: "BREAKER",
      cost: "100",
    },
    {
      partNumber: "BKJ63 1P 2A",
      description: "MCB 2A 1P 6KA/400V C Curve",
      brand: "LS",
      category: "BREAKER",
      cost: "10",
    },
    {
      partNumber: "BKJ63 1P 20A",
      description: "MCB 20A 1P 6KA/400V C Curve",
      brand: "LS",
      category: "BREAKER",
      cost: "10",
    },
    {
      partNumber: "BKJ63 1P 32A",
      description: "MCB 32A 1P 6KA/400V C Curve",
      brand: "LS",
      category: "BREAKER",
      cost: "10",
    },
    {
      partNumber: "2CDS381103R0634",
      description: "S301P-C63NA",
      brand: "ABB",
      category: "BREAKER",
      cost: "200",
    },
    {
      partNumber: "MT-32/3K 22A",
      description: "OVERLOAD RELAY 16-22A FOR MC-9B~40A",
      brand: "LS",
      category: "RELAY",
      cost: "50",
    },
    {
      partNumber: "MC-22b 220V",
      description: "CONTACTOR 3P 22A AC3 220VAC",
      brand: "LS",
      category: "CONTACTOR",
      cost: "80",
    },
    {
      partNumber: "EZ9F56116",
      description: "EASY9 MCB 1P 16A C 6000A 230V MINIATURE",
      brand: "Schneider",
      category: "BREAKER",
      cost: "15",
    },
  ];

  for (const item of catalog) {
    const input = productInput.parse({
      partNumber: item.partNumber,
      description: item.description,
      brand: item.brand,
      category: item.category,
      cost: item.cost,
      markup: "20",
      method: "COST_MARKUP",
      defaultLevel: "END_CUSTOMER",
      levels: [
        { code: "WHOLESALE", method: "COST_MARKUP", markup: "10" },
        { code: "RETAIL", method: "COST_MARKUP", markup: "15" },
        { code: "END_CUSTOMER", method: "COST_MARKUP", markup: "20" },
      ],
      active: true,
      unit: "pcs",
      vat: "15",
    });
    await db.transaction((tx) => saveProduct(tx, actor, input));
  }

  await t.test("LS MCCB breaker matches across spaces, hyphens, and ratings", async () => {
    const queries = [
      "ABN",
      "ABN103",
      "ABN 103",
      "ABN-103",
      "103c",
      "103c-60A",
      "ABN 60A",
      "ABN-60A",
      "ABN 60",
      "ABN-60",
      "ABN 103 60A",
      "ABN103C-60A",
    ];
    for (const q of queries) {
      const results: any = await search(db, actor, q, {}, false);
      const parts = results.map((r: any) => r.partNumber);
      assert(
        parts.includes("ABN103c-60A"),
        `Query "${q}" should match ABN103c-60A, got: ${parts.join(", ") || "NONE"}`,
      );
    }
  });

  await t.test("LS MCB breaker matches across spaces, hyphens, and poles", async () => {
    const queries = [
      "BKJ",
      "BKJ63",
      "BKJ 20",
      "BKJ-20",
      "BKJ 20A",
      "BKJ-20A",
      "BKJ63 20A",
      "BKJ63-20A",
      "BKJ 1P",
      "BKJ63 1P",
      "BKJ63 1P 20A",
      "BKJ63-1P-20A",
    ];
    for (const q of queries) {
      const results: any = await search(db, actor, q, {}, false);
      const parts = results.map((r: any) => r.partNumber);
      assert(
        parts.includes("BKJ63 1P 20A"),
        `Query "${q}" should match BKJ63 1P 20A, got: ${parts.join(", ") || "NONE"}`,
      );
    }
  });

  await t.test("LS Overload relay matches across slashes, hyphens, and ratings", async () => {
    const queries = [
      "MT-32",
      "MT32",
      "MT 32",
      "32/3K",
      "32 3K",
      "323K",
      "MT 22",
      "MT-22",
      "MT 22A",
      "MT-22A",
      "MT-32 22A",
      "MT32 22A",
      "MT-32/22",
      "MT-32-22",
      "MT32/22",
      "MT32-22",
      "MT-32/22A",
      "MT-32/3K 22A",
    ];
    for (const q of queries) {
      const results: any = await search(db, actor, q, {}, false);
      const parts = results.map((r: any) => r.partNumber);
      assert(
        parts.includes("MT-32/3K 22A"),
        `Query "${q}" should match MT-32/3K 22A, got: ${parts.join(", ") || "NONE"}`,
      );
    }
  });

  await t.test("Schneider Easy9 matches across prefixes, hyphens, and spaces", async () => {
    const queries = [
      "EZ9",
      "EZ9F",
      "EZ9 16",
      "EZ9-16",
      "EZ9 16A",
      "EZ9-16A",
      "EZ9F 16",
      "EZ9F-16",
      "EZ9F-16A",
      "EZ9 56116",
      "EZ9-56116",
      "EZ 56116",
      "EZ9F-56116",
      "EZ9F 56116",
    ];
    for (const q of queries) {
      const results: any = await search(db, actor, q, {}, false);
      const parts = results.map((r: any) => r.partNumber);
      assert(
        parts.includes("EZ9F56116"),
        `Query "${q}" should match EZ9F56116, got: ${parts.join(", ") || "NONE"}`,
      );
    }
  });

  await db.query(`INSERT INTO product_aliases(normalized, product_id, label, kind)
    SELECT 'BKJ63N 1P 20A', id, 'BKJ63N 1P 20A', 'DELIVERY_NOTE' FROM products WHERE part_number = 'BKJ63 1P 20A'`);
  await db.query(`INSERT INTO product_aliases(normalized, product_id, label, kind)
    SELECT 'BKJ63N 1P 32A', id, 'BKJ63N 1P 32A', 'DELIVERY_NOTE' FROM products WHERE part_number = 'BKJ63 1P 32A'`);

  await t.test("Rating boundary matching and model stemming prioritize target ratings", async () => {
    // Query 63n 1p 2: Must return BKJ63 1P 2A as top result
    const r1: any = await search(db, actor, "63n 1p 2", {}, false);
    assert.equal(r1[0]?.partNumber, "BKJ63 1P 2A");

    // Query BKJ63 1P 2A: Must return BKJ63 1P 2A and NOT match 32A
    const r2: any = await search(db, actor, "BKJ63 1P 2A", {}, false);
    assert.equal(r2[0]?.partNumber, "BKJ63 1P 2A");
    assert(!r2.some((x: any) => x.partNumber === "BKJ63 1P 32A"));

    // Query 63 1p 2
    const r3: any = await search(db, actor, "63 1p 2", {}, false);
    assert.equal(r3[0]?.partNumber, "BKJ63 1P 2A");

    // Query bkj 1p 2
    const r4: any = await search(db, actor, "bkj 1p 2", {}, false);
    assert.equal(r4[0]?.partNumber, "BKJ63 1P 2A");

    // Query bkj63n 2
    const r5: any = await search(db, actor, "bkj63n 2", {}, false);
    assert.equal(r5[0]?.partNumber, "BKJ63 1P 2A");

    // Query bkj 1p 20
    const r6: any = await search(db, actor, "bkj 1p 20", {}, false);
    assert.equal(r6[0]?.partNumber, "BKJ63 1P 20A");

    // Query bkj 1p 32
    const r7: any = await search(db, actor, "bkj 1p 32", {}, false);
    assert.equal(r7[0]?.partNumber, "BKJ63 1P 32A");

    // Query BKJ 1P C2
    const r8: any = await search(db, actor, "BKJ 1P C2", {}, false);
    assert.equal(r8[0]?.partNumber, "BKJ63 1P 2A");

    // Query BKJ 1P C20
    const r9: any = await search(db, actor, "BKJ 1P C20", {}, false);
    assert.equal(r9[0]?.partNumber, "BKJ63 1P 20A");

    // Query BKJ 1P C32
    const r10: any = await search(db, actor, "BKJ 1P C32", {}, false);
    assert.equal(r10[0]?.partNumber, "BKJ63 1P 32A");
  });

  await t.test("Admin catalog search supports normalized clean parts and pagination", async () => {
    const res: any = await search(db, actor, "BKJ63 1P", {}, true);
    assert.equal(res.items.length, 3);
    assert(res.items.some((x: any) => x.partNumber === "BKJ63 1P 20A"));

    const res2: any = await search(db, actor, "MT-32", {}, true);
    assert.equal(res2.items.length, 1);
    assert.equal(res2.items[0].partNumber, "MT-32/3K 22A");

    const res3: any = await search(db, actor, "ABN 103", {}, true);
    assert.equal(res3.items.length, 1);
    assert.equal(res3.items[0].partNumber, "ABN103c-60A");
  });

  await db.close?.();
});
