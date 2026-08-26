import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import {
  productInput,
  levelInput,
  calculate,
  masterPrice,
  validateProduct,
} from "../backend/pricing/engine";
import { importCandidate, tierColumns } from "../backend/pricing/transfer";
import {
  saveProduct,
  getProduct,
  toInput,
  staffProduct,
  search,
} from "../backend/products/service";
import {
  saveDraft,
  reviewIssue,
  issue,
  getQuote,
  savedLineInput,
  publicQuote,
} from "../backend/quotations/service";
import { bulkPrice, settings } from "../backend/admin/service";
import {
  mapRows,
  reviewRows,
  confirmImport,
  rollback,
} from "../backend/imports/service";
import { exportCatalog } from "../backend/worker/export";
import { quotationHtml } from "../backend/pdf/template";
import { handle } from "../backend/api/router";

const fixture = () =>
  productInput.parse({
    partNumber: "AMT-DIST-01",
    description: "Distribution switch / مفتاح",
    cost: "80",
    defaultLevel: "RETAIL",
    minimumEnabled: true,
    minimum: "85",
    quantityPrecision: 3,
    levels: [
      { code: "WHOLESALE", method: "FIXED", fixedPrice: "90" },
      { code: "RETAIL", method: "COST_MARKUP", markup: "25" },
      {
        code: "END_CUSTOMER",
        method: "LIST_DISCOUNT",
        listPrice: "200",
        baseDiscount: "40",
      },
    ],
  });
const line = { quantity: "0.5", discount: "0", override: false, reason: "" };
test("Selling-level calculation, defaults, rounding and shared floor", () => {
  const p = fixture(),
    policy = { maxDiscount: "10", canOverride: false };
  assert.equal(masterPrice(p).toFixed(2), "100.00");
  assert.equal(masterPrice(p, "WHOLESALE").toFixed(2), "90.00");
  assert.equal(masterPrice(p, "END_CUSTOMER").toFixed(2), "120.00");
  const price = calculate(p, policy, {
    ...line,
    sellingLevel: "WHOLESALE",
    discount: "30",
  });
  assert.equal(price.requestedDiscount, "30");
  assert.equal(price.allowedDiscount, "10");
  assert.equal(price.finalExcl, "85.00");
  assert.equal(price.subtotal, "42.50");
  assert.equal(price.vatAmount, "6.38");
  assert.equal(price.total, "48.88");
  assert.throws(
    () =>
      calculate(p, policy, {
        ...line,
        sellingLevel: "WHOLESALE",
        discount: "30",
        override: true,
        reason: "test",
      }),
    /not permitted/,
  );
  const overridden = calculate(
    p,
    { ...policy, canOverride: true },
    {
      ...line,
      sellingLevel: "WHOLESALE",
      discount: "30",
      override: true,
      reason: "Approved distributor order",
    },
  );
  assert.equal(overridden.finalExcl, "81.00");
  assert.equal(overridden.allowedDiscount, "10");
  assert.throws(
    () =>
      calculate(
        p,
        { ...policy, canOverride: true },
        { ...line, override: true },
      ),
    /reason/,
  );
  assert.throws(() => validateProduct({ ...p, minimum: "95" }), /WHOLESALE/);
  assert.throws(
    () => validateProduct({ ...p, defaultLevel: undefined }),
    /default/,
  );
  assert.throws(
    () => validateProduct({ ...p, levels: [p.levels![0], p.levels![0]] }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateProduct({
        ...p,
        levels: p.levels!.map((l) => ({ ...l, active: false })),
      }),
    /unavailable/,
  );
  assert.equal(
    masterPrice(
      validateProduct({
        ...p,
        defaultLevel: "WHOLESALE",
        levels: [p.levels![0]],
      }),
    ).toFixed(2),
    "90.00",
  );
  assert.equal(
    masterPrice(
      validateProduct({ ...p, levels: p.levels!.slice(0, 2) }),
    ).toFixed(2),
    "100.00",
  );
});

test("Tier-aware catalog, snapshots, reviewed imports, exports and security", async (t) => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "selling-level-tests-setup-token-long-enough";
  process.env.APP_ORIGIN = "http://localhost:18180";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "tieradmin",
    password: "Tier-test-password-129",
    name: "Tier Admin",
    companyName: "AMT Electric",
  });
  const auth = await login(db, {
    username: "tieradmin",
    password: "Tier-test-password-129",
  });
  const cookie = sessionCookie(auth.token).split(";")[0];
  const actor = await authenticate(
    db,
    new Request("http://localhost:18180", { headers: { Cookie: cookie } }),
  );
  const config = await settings(db);
  const staff = { ...actor, permissions: ["PRODUCT_VIEW"], maxDiscount: "10" };
  let saved = await db.transaction((tx) => saveProduct(tx, actor, fixture()));
  let draft: any, issued: any;
  await t.test(
    "Staff receives all active selling prices but no formulas or cost",
    async () => {
      const view = staffProduct(await getProduct(db, saved.id), staff, config);
      assert.equal(view.defaultLevel, "RETAIL");
      assert.equal(view.sellingLevels.length, 3);
      assert.deepEqual(
        view.sellingLevels.map((l: any) => l.masterExcl),
        ["90.00", "100.00", "120.00"],
      );
      for (const secret of [
        "cost",
        "markup",
        "baseDiscount",
        "minimum",
        "levels",
        "method",
        "fixedPrice",
      ])
        assert.equal(view[secret], undefined);
      assert(!JSON.stringify(view.sellingLevels).includes("markup"));
      assert.equal(
        (await search(db, staff, "AMT-DIST", config))[0].sellingLevels.length,
        3,
      );
    },
  );
  await t.test(
    "Default and explicit levels are backend-authoritative; forged prices and codes rejected",
    async () => {
      const call = async (data: any) =>
        handle(
          new Request("http://localhost:18180/api/v1/pricing", {
            method: "POST",
            headers: {
              Origin: process.env.APP_ORIGIN!,
              Cookie: cookie,
              "X-CSRF-Token": actor.csrf,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ productId: saved.id, ...line, ...data }),
          }),
          db,
        );
      const response = await call({});
      assert.equal(response.status, 200);
      assert.equal((await response.json()).sellingLevel, "RETAIL");
      assert.equal((await call({ sellingLevel: "FORGED" })).status, 400);
      assert.equal(
        (await call({ sellingLevel: "WHOLESALE", finalExcl: "1" })).status,
        400,
      );
    },
  );
  await t.test(
    "Different levels remain separate lines and snapshots pin selection across defaults",
    async () => {
      draft = await saveDraft(
        db,
        actor,
        {
          customer: { name: "Distributor" },
          lines: [
            { productId: saved.id, ...line, sellingLevel: "WHOLESALE" },
            { productId: saved.id, ...line },
          ],
        },
        config,
      );
      assert.equal(draft.lines.length, 2);
      assert.equal(draft.lines[1].input.sellingLevel, "RETAIL");
      const p = toInput(await getProduct(db, saved.id));
      saved = await db.transaction((tx) =>
        saveProduct(
          tx,
          actor,
          { ...p, defaultLevel: "END_CUSTOMER" },
          saved.id,
          saved.version,
        ),
      );
      const review = await reviewIssue(db, actor, draft.id, config);
      assert.equal(review.after[0].price.masterExcl, "90.00");
      assert.equal(review.after[1].price.masterExcl, "100.00");
      issued = await issue(db, actor, draft.id, review.token, config);
      const html = quotationHtml(issued, config, "data:image/svg+xml,");
      assert(!html.includes("120.00"));
      assert(!html.includes("fixedPrice"));
      const copy = await saveDraft(
        db,
        actor,
        { customer: issued.customer, lines: issued.lines.map(savedLineInput) },
        config,
      );
      assert.equal(copy.lines[0].input.sellingLevel, "WHOLESALE");
    },
  );
  await t.test(
    "Bulk previews target one level; cost edits affect markup levels; stale reviews blocked",
    async () => {
      const copy = await saveDraft(
        db,
        actor,
        {
          customer: {},
          lines: [{ productId: saved.id, ...line, sellingLevel: "WHOLESALE" }],
        },
        config,
      );
      const review = await reviewIssue(db, actor, copy.id, config);
      const operation = {
        items: [saved],
        operation: "FIXED_PRICE",
        value: "92",
        sellingLevel: "WHOLESALE",
      };
      const preview = await bulkPrice(db, actor, operation);
      assert.equal(preview.preview[0].levels[0].after, "92.00");
      assert.equal(
        masterPrice(
          toInput(await getProduct(db, saved.id)),
          "WHOLESALE",
        ).toFixed(2),
        "90.00",
      );
      await bulkPrice(db, actor, { ...operation, confirm: true });
      saved.version++;
      await assert.rejects(
        () => issue(db, actor, copy.id, review.token, config),
        /Review again/,
      );
      const cost = await bulkPrice(db, actor, {
        items: [saved],
        operation: "COST_INCREASE",
        value: "10",
      });
      assert.equal(
        cost.preview[0].levels.find((l: any) => l.code === "RETAIL")!.after,
        "110.00",
      );
      assert.equal(
        cost.preview[0].levels.find((l: any) => l.code === "WHOLESALE")!.after,
        "92.00",
      );
      const untouched = publicQuote(
        await getQuote(db, actor, issued.id),
        actor,
      );
      assert.deepEqual(untouched.lines, issued.lines);
      await assert.rejects(
        () =>
          db.transaction((tx) =>
            saveProduct(tx, actor, fixture(), saved.id, 1),
          ),
        /changed/,
      );
    },
  );
  await t.test(
    "Unavailable selected levels block pricing and issuing without default substitution",
    async () => {
      const q = await saveDraft(
        db,
        actor,
        {
          customer: {},
          lines: [{ productId: saved.id, ...line, sellingLevel: "WHOLESALE" }],
        },
        config,
      );
      const p = toInput(await getProduct(db, saved.id));
      saved = await db.transaction((tx) =>
        saveProduct(
          tx,
          actor,
          {
            ...p,
            levels: p.levels!.map((l) =>
              l.code === "WHOLESALE" ? { ...l, active: false } : l,
            ),
          },
          saved.id,
          saved.version,
        ),
      );
      await assert.rejects(
        () => reviewIssue(db, actor, q.id, config),
        /unavailable/,
      );
      const view = staffProduct(await getProduct(db, saved.id), staff, config);
      assert.equal(view.sellingLevels.length, 2);
      saved = await db.transaction((tx) =>
        saveProduct(tx, actor, p, saved.id, saved.version),
      );
    },
  );
  await t.test(
    "Partial reviewed import preserves other levels/default, retry is safe, rollback restores all levels",
    async () => {
      const before = toInput(await getProduct(db, saved.id)),
        importId = randomUUID(),
        rowId = randomUUID();
      await db.query(
        "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id) VALUES($1,'tiers.csv','test','EXCEL','AWAITING_REVIEW',$2)",
        [importId, actor.id],
      );
      await db.query(
        "INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,1,$3)",
        [
          rowId,
          importId,
          JSON.stringify({ part: before.partNumber, price: "96" }),
        ],
      );
      await mapRows(db, actor, importId, {
        mapping: { partNumber: "part", "WHOLESALE.fixedPrice": "price" },
        defaults: { method: "LIST_DISCOUNT", vat: "0" },
        version: 1,
      });
      const mapped = (await one(db, "SELECT * FROM import_rows WHERE id=$1", [
        rowId,
      ]))!;
      assert.deepEqual(mapped.errors, []);
      assert.equal(mapped.proposed.levels.length, 3);
      assert.equal(mapped.proposed.defaultLevel, "END_CUSTOMER");
      assert.equal(mapped.proposed.vat, before.vat);
      await reviewRows(db, actor, importId, {
        rows: [{ id: rowId, decision: "UPDATE", verified: true }],
      });
      await confirmImport(db, actor, importId, 3);
      assert.deepEqual(await confirmImport(db, actor, importId, 3), {
        ok: true,
        alreadyImported: true,
      });
      assert.equal(
        masterPrice(
          toInput(await getProduct(db, saved.id)),
          "WHOLESALE",
        ).toFixed(2),
        "96.00",
      );
      await rollback(db, actor, importId);
      assert.deepEqual(toInput(await getProduct(db, saved.id)), before);
      saved.version = (await getProduct(db, saved.id)).version;
    },
  );
  await t.test(
    "Full XLSX export round-trips formulas/defaults; staff export includes only selling amounts",
    async () => {
      process.env.UPLOAD_DIR = path.resolve("test-results/tiers");
      const exportId = randomUUID();
      await exportCatalog(db, exportId, true);
      const book = new ExcelJS.Workbook();
      await book.xlsx.readFile(
        path.join(process.env.UPLOAD_DIR, "exports", exportId + ".xlsx"),
      );
      const sheet = book.worksheets[0];
      const headers = sheet.getRow(1).values as any[];
      const mapped: Record<string, any> = {};
      sheet.getRow(2).eachCell((cell, i) => {
        if (cell.value !== "" && cell.value != null)
          mapped[headers[i]] =
            typeof cell.value === "boolean" ? cell.value : String(cell.value);
      });
      const imported = validateProduct(importCandidate(mapped, {}));
      const current = toInput(await getProduct(db, saved.id));
      assert.equal(imported.defaultLevel, current.defaultLevel);
      assert.deepEqual(imported.levels, current.levels);
      assert.equal(tierColumns.length, 18);
      const safeId = randomUUID();
      await exportCatalog(db, safeId, false);
      const safe = new ExcelJS.Workbook();
      await safe.xlsx.readFile(
        path.join(process.env.UPLOAD_DIR, "exports", safeId + ".xlsx"),
      );
      const names = JSON.stringify(safe.worksheets[0].getRow(1).values);
      assert(names.includes("WHOLESALE.masterExcl"));
      assert(!names.includes("markup"));
      assert(!names.includes("fixedPrice"));
      assert(!names.includes('"cost"'));
    },
  );
  await db.close?.();
});

test("Migration retains legacy prices and issued JSON without rewriting snapshots", async () => {
  const db = await embedded();
  await db.query(
    "CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
  );
  for (const name of ["001_initial.sql", "002_search.sql"]) {
    const sql = await fs.readFile(path.join("database", name), "utf8");
    await db.transaction(async (tx) => {
      for (const stmt of sql.split(";").filter((s) => s.trim()))
        await tx.query(stmt);
      await tx.query("INSERT INTO migrations(name) VALUES($1)", [name]);
    });
  }
  process.env.SETUP_TOKEN = "legacy-migration-setup-token-minimum-length";
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "legacyadmin",
    password: "Legacy-test-password-129",
    name: "Legacy",
    companyName: "AMT Electric",
  });
  const id = randomUUID(),
    qid = randomUUID(),
    user = (await one(db, "SELECT id FROM users LIMIT 1"))!;
  await db.query(
    "INSERT INTO products(id,part_number,normalized_part,description,quantity_precision) VALUES($1,'LEGACY','LEGACY','Old item',0)",
    [id],
  );
  await db.query(
    "INSERT INTO product_pricing VALUES($1,'COST_MARKUP',100,25,0,0,125,15,true,110)",
    [id],
  );
  const oldLines = [
    {
      productId: id,
      input: { productId: id, ...line },
      price: { finalExcl: "125.00", finalIncl: "143.75" },
    },
  ];
  await db.query(
    "INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'QT-LEGACY','ISSUED',$2,'{}',$3,'{}')",
    [qid, user.id, JSON.stringify(oldLines)],
  );
  await migrate(db);
  await migrate(db);
  const p = toInput(await getProduct(db, id));
  assert.equal(p.defaultLevel, "END_CUSTOMER");
  assert.equal(p.levels!.length, 1);
  assert.equal(masterPrice(p).toFixed(2), "125.00");
  assert.deepEqual(
    (await one(db, "SELECT lines FROM quotations WHERE id=$1", [qid]))!.lines,
    oldLines,
  );
  assert.equal(savedLineInput(oldLines[0]).sellingLevel, "END_CUSTOMER");
  await db.close?.();
});
