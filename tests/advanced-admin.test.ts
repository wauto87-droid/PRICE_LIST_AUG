import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import { settings } from "../backend/admin/service";
import { saveProduct, getProduct, toInput } from "../backend/products/service";
import { productInput, masterPrice } from "../backend/pricing/engine";
import { importCandidate } from "../backend/pricing/transfer";
import {
  preview,
  apply,
  saveRule,
  matches,
  ruleSchema,
} from "../backend/bulk/service";
import {
  mapRows,
  reviewRows,
  confirmImport,
  rollback,
  reopen as reopenImport,
  getImportPage,
  previewConfirmation,
} from "../backend/imports/service";
import { saveDraft, reviewIssue, issue } from "../backend/quotations/service";
import {
  getSettings,
  saveSettings,
  sequenceState,
} from "../backend/quotations/settings";
import { quotationHtml } from "../backend/pdf/template";
import { handle } from "../backend/api/router";

test("Advanced administration: reviewed rules, safe imports, global numbering and branding", async (t) => {
  const db = await embedded();
  await migrate(db);
  try {
    process.env.SETUP_TOKEN = "advanced-admin-only-setup-token-123";
    process.env.APP_ORIGIN = "http://localhost:18180";
    await setup(db, {
      token: process.env.SETUP_TOKEN,
      username: "advanced",
      password: "Advanced-test-password-129",
      name: "Admin",
      companyName: "AMT Electric",
    });
    const auth = await login(db, {
        username: "advanced",
        password: "Advanced-test-password-129",
      }),
      cookie = sessionCookie(auth.token).split(";")[0];
    const actor = await authenticate(
      db,
      new Request("http://localhost:18180", { headers: { Cookie: cookie } }),
    );
    const base = productInput.parse({
      partNumber: "LS-BKJ63",
      description: "LS switch / مفتاح",
      brand: "LS Electric",
      cost: "80",
      defaultLevel: "RETAIL",
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
    const product = await db.transaction((tx) => saveProduct(tx, actor, base));
    const definition = ruleSchema.parse({
      conditions: [{ field: "partNumber", operator: "PREFIX", value: "LS-" }],
      actions: [
        {
          field: "fixedPrice",
          level: "WHOLESALE",
          operation: "INCREASE_PERCENT",
          value: "10",
        },
      ],
    });
    await t.test(
      "Rule matching, preview exact prices, idempotent application and stale conflicts",
      async () => {
        assert(matches(definition, base, ["EXISTING"]));
        assert(
          !matches(
            {
              ...definition,
              conditions: [
                {
                  field: "partNumber",
                  operator: "EQ",
                  value: "MISSING",
                  level: "DEFAULT",
                },
              ],
            },
            base,
            [],
          ),
        );
        const saved = await saveRule(db, actor, {
          name: "LS wholesale +10%",
          definition,
        });
        const p = await preview(db, actor, {
          scope: "CATALOG",
          ruleId: saved.id,
          definition,
        });
        assert.equal(p.matched, 1);
        assert.equal(p.items[0].differences[0].after, "99.00");
        assert.equal(
          masterPrice(
            toInput(await getProduct(db, product.id)),
            "WHOLESALE",
          ).toFixed(2),
          "90.00",
        );
        assert.deepEqual(
          await apply(db, actor, p.id),
          await apply(db, actor, p.id),
        );
        const stale = await preview(db, actor, {
          scope: "CATALOG",
          definition,
        });
        const current = await getProduct(db, product.id);
        await db.transaction((tx) =>
          saveProduct(
            tx,
            actor,
            { ...toInput(current), description: "Edited" },
            product.id,
            current.version,
          ),
        );
        await assert.rejects(apply(db, actor, stale.id), /changed/i);
        const zero = await preview(db, actor, {
          scope: "CATALOG",
          definition: {
            ...definition,
            conditions: [
              { field: "partNumber", operator: "EQ", value: "NONE" },
            ],
          },
        });
        assert.equal(zero.matched, 0);
        await assert.rejects(apply(db, actor, zero.id), /No matched/);
      },
    );
    await t.test(
      "Both template examples preserve formulas, blank fields and default levels",
      async () => {
        for (const kind of ["simple", "advanced"]) {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(
            (await fs.readFile(`assets/templates/${kind}.xlsx`)) as any,
          );
          assert.equal(wb.worksheets[0].name, "PriceUpdate");
          assert(wb.getWorksheet("Instructions"));
          const sheet = wb.getWorksheet("Examples")!;
          const mapped: Record<string, any> = {};
          sheet.getRow(1).eachCell((cell, i) => {
            const value = sheet.getCell(2, i).value;
            if (value !== null && value !== "")
              mapped[String(cell.value)] = String(value);
          });
          const p = importCandidate(mapped, {}, base);
          assert.equal(p.levels!.length, 3);
          assert.equal(masterPrice(p).toFixed(2), "100.00");
          assert.equal(masterPrice(p, "WHOLESALE").toFixed(2), "90.00");
          assert.equal(wb.worksheets[0].getCell("E2").value, null);
        }
        const partial = importCandidate(
          { "WHOLESALE.sellingPrice": "91" },
          {},
          base,
        );
        assert.equal(partial.levels![0].method, "FIXED");
        assert.equal(partial.levels![1].method, "COST_MARKUP");
        assert.equal(partial.defaultLevel, "RETAIL");
      },
    );
    await t.test(
      "Supplier-simple template ships the expected supplier-facing columns",
      async () => {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(
          (await fs.readFile("assets/templates/supplier-simple.xlsx")) as any,
        );
        assert.equal(wb.worksheets[0].name, "PriceUpdate");
        assert(wb.getWorksheet("Instructions"));
        const sheet = wb.getWorksheet("Examples")!;
        const headers = Array.from(
          sheet.getRow(1).values as ExcelJS.CellValue[],
        )
          .slice(1)
          .map((value: ExcelJS.CellValue) => String(value ?? ""));
        assert.deepEqual(headers, [
          "Part Reference",
          "Local Description",
          "Activity",
          "Public Pricelist",
          "Currency",
        ]);
        const values = Array.from(
          sheet.getRow(2).values as ExcelJS.CellValue[],
        )
          .slice(1)
          .map((value: ExcelJS.CellValue) => String(value ?? ""));
        assert.equal(values[0], "28900");
        assert.equal(values[2], "PPCCB");
        assert.equal(values[3], "492");
      },
    );
    const stage = async (raw: any[], mode = "UPDATE_ONLY") => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,mode) VALUES($1,'LS-test.xlsx','fixture','EXCEL','AWAITING_REVIEW',$2,$3)",
        [id, actor.id, mode],
      );
      for (let i = 0; i < raw.length; i++)
        await db.query(
          "INSERT INTO import_rows(id,job_id,row_number,raw) VALUES($1,$2,$3,$4)",
          [randomUUID(), id, i + 1, JSON.stringify(raw[i])],
        );
      return id;
    };
    await t.test(
      "Actual LS workbook extraction and grouped staging",
      { skip: !process.env.LS_WORKBOOK_PATH },
      async () => {
        const { stdout } = await promisify(execFile)(
          process.env.PYTHON_BIN || "python3",
          ["scripts/extract.py", process.env.LS_WORKBOOK_PATH!, "100"],
          { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        );
        const extracted = JSON.parse(stdout);
        assert.equal(extracted.rows.length, 856);
        const id = await stage(extracted.rows);
        await mapRows(db, actor, id, {
          mapping: {
            partNumber: "Item",
            description: "Description",
            listPrice: "P.L (SAR)",
          },
          defaults: { method: "LIST_DISCOUNT", baseDiscount: "0" },
          version: 1,
          mode: "CREATE_UPDATE",
        });
        const p = await preview(db, actor, {
          scope: "IMPORT",
          importId: id,
          definition: {
            conditions: [
              { field: "partNumber", operator: "PREFIX", value: "BKJ" },
              { field: "state", operator: "EQ", value: "VALID" },
            ],
            actions: [{ field: "brand", value: "LS Electric" }],
          },
        });
        assert(p.matched > 1);
        assert.equal(p.errors, 0);
        assert(p.items.every((i) => i.verified === false));
      },
    );
    await t.test(
      "Default update-only blocks unknown; create mode requires individual verification",
      async () => {
        const id = await stage([
          { part: "UNKNOWN", description: "New switch", price: "30" },
        ]);
        const mapping = {
          partNumber: "part",
          description: "description",
          "END_CUSTOMER.sellingPrice": "price",
        };
        await mapRows(db, actor, id, {
          mapping,
          defaults: { defaultLevel: "END_CUSTOMER" },
          version: 1,
        });
        let row = (await one(db, "SELECT * FROM import_rows WHERE job_id=$1", [
          id,
        ]))!;
        assert(row.errors.length > 0);
        await mapRows(db, actor, id, {
          mapping,
          defaults: { defaultLevel: "END_CUSTOMER" },
          version: 2,
          mode: "CREATE_UPDATE",
        });
        const p = await preview(db, actor, {
          scope: "IMPORT",
          importId: id,
          acknowledgeVerification: true,
          definition: {
            conditions: [],
            actions: [
              { field: "decision", value: "UPDATE" },
              { field: "verified", value: "true" },
            ],
          },
        });
        assert.equal(p.errors, 1);
        await reviewRows(db, actor, id, {
          rows: [{ id: row.id, decision: "UPDATE", verified: true }],
        });
        const version = (await one(
          db,
          "SELECT version FROM import_jobs WHERE id=$1",
          [id],
        ))!.version;
        await confirmImport(db, actor, id, version);
        assert(
          await one(
            db,
            "SELECT id FROM products WHERE normalized_part='UNKNOWN'",
          ),
        );
        const imported = await one(
          db,
          "SELECT version FROM import_jobs WHERE id=$1",
          [id],
        );
        await reopenImport(db, actor, id, { version: imported!.version });
        const reopened = await getImportPage(db, actor, id, 0, 50, "all");
        assert.equal(reopened.rows.length, 1);
        assert.equal(
          (await one(db, "SELECT status FROM import_jobs WHERE id=$1", [id]))!
            .status,
          "AWAITING_REVIEW",
        );
        assert.equal(
          (await one(db, "SELECT active FROM products WHERE normalized_part='UNKNOWN'"))!
            .active,
          false,
        );
      },
    );
    await t.test(
      "Guided public-price discount import applies Activity presets and minimum floors",
      async () => {
        const id = await stage(
          [
            {
              part: "DISC-PPCCB",
              description: "Preset A",
              Activity: "PPCCB",
              "Public Pricelist": "21.126328146000006",
            },
            {
              part: "DISC-OTHER",
              description: "Preset B",
              Activity: "LIGHTING",
              "Public Pricelist": "48.988366811999995",
            },
          ],
          "CREATE_UPDATE",
        );
        await mapRows(db, actor, id, {
          mapping: {
            partNumber: "part",
            description: "description",
            listPrice: "Public Pricelist",
          },
          defaults: {
            vat: "15",
            guidedImport: {
              mode: "PUBLIC_PRICE_DISCOUNT",
              groupColumn: "Activity",
              defaultPreset: {
                finalDiscount: "60",
                wholesaleDiscount: "55",
                minimumDiscount: "70",
              },
              groupPresets: {
                LIGHTING: {
                  finalDiscount: "50",
                  wholesaleDiscount: "45",
                  minimumDiscount: "65",
                },
              },
            },
          },
          version: 1,
          mode: "CREATE_UPDATE",
        });
        const rows = (
          await db.query(
            "SELECT row_number,proposed,errors FROM import_rows WHERE job_id=$1 ORDER BY row_number",
            [id],
          )
        ).rows;
        assert.deepEqual(rows[0].errors, []);
        assert.equal(rows[0].proposed.listPrice, "21.126328");
        assert.equal(rows[0].proposed.method, "LIST_DISCOUNT");
        assert.equal(rows[0].proposed.defaultLevel, "END_CUSTOMER");
        assert.equal(rows[0].proposed.baseDiscount, "60");
        assert.equal(rows[0].proposed.minimum, "6.34");
        assert.equal(
          rows[0].proposed.levels.find((level: any) => level.code === "WHOLESALE")
            .baseDiscount,
          "55",
        );
        assert.deepEqual(rows[1].errors, []);
        assert.equal(rows[1].proposed.listPrice, "48.988367");
        assert.equal(rows[1].proposed.baseDiscount, "50");
        assert.equal(rows[1].proposed.minimum, "17.15");
        assert.equal(
          rows[1].proposed.levels.find((level: any) => level.code === "WHOLESALE")
            .baseDiscount,
          "45",
        );
      },
    );
    await t.test(
      "Guided public-price discount import leaves minimum protection off when minimum discount is zero",
      async () => {
        const id = await stage(
          [
            {
              part: "DISC-NO-MIN",
              description: "No minimum",
              Activity: "GENERAL",
              "Public Pricelist": "100",
            },
          ],
          "CREATE_UPDATE",
        );
        await mapRows(db, actor, id, {
          mapping: {
            partNumber: "part",
            description: "description",
            listPrice: "Public Pricelist",
          },
          defaults: {
            vat: "15",
            guidedImport: {
              mode: "PUBLIC_PRICE_DISCOUNT",
              groupColumn: "Activity",
              defaultPreset: {
                finalDiscount: "20",
                wholesaleDiscount: "15",
                minimumDiscount: "0",
              },
              groupPresets: {},
            },
          },
          version: 1,
          mode: "CREATE_UPDATE",
        });
        const row = await one(
          db,
          "SELECT proposed,errors FROM import_rows WHERE job_id=$1",
          [id],
        );
        assert.deepEqual(row!.errors, []);
        assert.equal(row!.proposed.minimumEnabled, false);
        assert.equal(row!.proposed.minimum, "0");
      },
    );
    await t.test(
      "Supplier-style headers auto-map through guided create-and-update staging",
      async () => {
        const id = await stage([
          {
            "Part Reference": "AUTO-28900",
            "Local Description": "Auto mapped breaker",
            Activity: "PPCCB",
            "Public Pricelist": "100",
          },
        ]);
        await mapRows(db, actor, id, {
          mapping: {
            partNumber: "Part Reference",
            description: "Local Description",
            listPrice: "Public Pricelist",
          },
          defaults: {
            vat: "15",
            guidedImport: {
              mode: "PUBLIC_PRICE_DISCOUNT",
              groupColumn: "Activity",
              defaultPreset: {
                finalDiscount: "60",
                wholesaleDiscount: "55",
                minimumDiscount: "70",
              },
              groupPresets: {},
            },
          },
          version: 1,
          mode: "CREATE_UPDATE",
        });
        const row = await one(
          db,
          "SELECT proposed,errors,duplicate_id FROM import_rows WHERE job_id=$1",
          [id],
        );
        assert.deepEqual(row!.errors, []);
        assert.equal(row!.duplicate_id, null);
        assert.equal(row!.proposed.partNumber, "AUTO-28900");
        assert.equal(row!.proposed.description, "Auto mapped breaker");
        assert.equal(row!.proposed.baseDiscount, "60");
        assert.equal(row!.proposed.minimum, "30.00");
      },
    );
    await t.test(
      "856-row selection evaluates the complete import, not preview page",
      async () => {
        const id = await stage(
          Array.from({ length: 856 }, (_, i) => ({ part: `LS-${i}` })),
        );
        await db.query(
          "UPDATE import_rows SET proposed=jsonb_build_object('partNumber',raw->>'part'),errors='[\"Unmapped\"]'::jsonb WHERE job_id=$1",
          [id],
        );
        const p = await preview(db, actor, {
          scope: "IMPORT",
          importId: id,
          definition: {
            conditions: [
              { field: "partNumber", operator: "PREFIX", value: "LS-" },
            ],
            actions: [{ field: "decision", value: "SKIP" }],
          },
        });
        assert.equal(p.matched, 856);
        assert.equal(p.items.length, 50);
        assert.equal(p.errors, 0);
        await apply(db, actor, p.id);
        assert.equal(
          Number(
            (await one(
              db,
              "SELECT count(*) AS n FROM import_rows WHERE job_id=$1 AND decision='SKIP'",
              [id],
            ))!.n,
          ),
          856,
        );
      },
    );
    await t.test(
      "Reviewed partial price update can be confirmed and rolled back",
      async () => {
        const before = toInput(await getProduct(db, product.id)),
          id = await stage([{ part: before.partNumber, price: "110" }]);
        await mapRows(db, actor, id, {
          mapping: { partNumber: "part", "WHOLESALE.sellingPrice": "price" },
          defaults: {},
          version: 1,
        });
        const p = await preview(db, actor, {
          scope: "IMPORT",
          importId: id,
          acknowledgeVerification: true,
          definition: {
            conditions: [{ field: "state", operator: "EQ", value: "VALID" }],
            actions: [
              { field: "decision", value: "UPDATE" },
              { field: "verified", value: "true" },
            ],
          },
        });
        assert.equal(p.errors, 0);
        await apply(db, actor, p.id);
        const accepted = await previewConfirmation(db, actor, id);
        await db.query("UPDATE settings SET version=version+1 WHERE id=1");
        await assert.rejects(
          confirmImport(db, actor, id, 3, accepted.token),
          /changed/i,
        );
        await assert.rejects(
          confirmImport(db, actor, id, 3, "1.expired"),
          /expired/i,
        );
        await confirmImport(
          db,
          actor,
          id,
          3,
          (await previewConfirmation(db, actor, id)).token,
        );
        assert.equal(
          masterPrice(
            toInput(await getProduct(db, product.id)),
            "WHOLESALE",
          ).toFixed(2),
          "110.00",
        );
        await rollback(db, actor, id);
        assert.equal(
          masterPrice(
            toInput(await getProduct(db, product.id)),
            "WHOLESALE",
          ).toFixed(2),
          masterPrice(before, "WHOLESALE").toFixed(2),
        );
        const rolledBack = await one(
          db,
          "SELECT version FROM import_jobs WHERE id=$1",
          [id],
        );
        await reopenImport(db, actor, id, { version: rolledBack!.version });
        assert.equal(
          (await one(db, "SELECT status FROM import_jobs WHERE id=$1", [id]))!
            .status,
          "AWAITING_REVIEW",
        );
      },
    );
    let issued: any;
    await t.test(
      "Global sequence survives rollback, concurrent calls, prefix changes and immutable branding",
      async () => {
        const config = await settings(db),
          request = {
            customer: { name: "Test customer" },
            lines: [
              {
                productId: product.id,
                sellingLevel: "RETAIL",
                quantity: "1",
                discount: "0",
                override: false,
                reason: "",
              },
            ],
          };
        const secondId = randomUUID();
        await db.query(
          "INSERT INTO users(id,username,name,password_hash,role_id) SELECT $1,'secondissuer','Second issuer',password_hash,'ADMIN' FROM users WHERE id=$2",
          [secondId, actor.id],
        );
        const secondLogin = await login(db, {
          username: "secondissuer",
          password: "Advanced-test-password-129",
        });
        const secondActor = await authenticate(
          db,
          new Request("http://localhost:18180", {
            headers: { Cookie: sessionCookie(secondLogin.token).split(";")[0] },
          }),
        );
        const actors = [actor, secondActor];
        const drafts = await Promise.all(
          actors.map((a) => saveDraft(db, a, request, config)),
        );
        const reviews = await Promise.all(
          drafts.map((d, i) => reviewIssue(db, actors[i], d.id, config)),
        );
        const quotes = await Promise.all(
          drafts.map((d, i) =>
            issue(db, actors[i], d.id, reviews[i].token, config),
          ),
        );
        assert.deepEqual(quotes.map((q) => q.number).sort(), [
          "AMT-QT-000001",
          "AMT-QT-000002",
        ]);
        issued = quotes[0];
        let consumed = "";
        await assert.rejects(
          db.transaction(async (tx) => {
            consumed = (await one(
              tx,
              "SELECT nextval('quotation_serial_seq')::text AS n",
            ))!.n;
            throw Error("simulated failure");
          }),
        );
        assert(BigInt((await sequenceState(db)).next) > BigInt(consumed));
        const st = await getSettings(db, actor),
          payload = {
            quotation: {
              ...st.quotation,
              prefix: "AMT-SALES",
              legalName: "New Legal",
              watermark: {
                ...st.quotation.watermark,
                enabled: true,
                text: "AMT / الكهرباء",
              },
            },
            version: st.version,
            companyName: st.companyName,
            companyArabic: st.companyArabic,
            pdfUnitPrices: st.pdfUnitPrices,
          };
        await assert.rejects(
          saveSettings(db, actor, {
            ...payload,
            nextSerial: "1",
            reason: "invalid",
          }),
          /increase/,
        );
        await assert.rejects(
          saveSettings(db, actor, { ...payload, nextSerial: "100" }),
          /reason/,
        );
        await saveSettings(db, actor, {
          ...payload,
          nextSerial: "100",
          reason: "Reserve old printed range",
        });
        const d = await saveDraft(db, actor, request, config),
          r = await reviewIssue(db, actor, d.id, config),
          q = await issue(db, actor, d.id, r.token, config);
        assert.equal(q.number, "AMT-SALES-000100");
        const raw = (await one(db, "SELECT * FROM quotations WHERE id=$1", [
            q.id,
          ]))!,
          html = quotationHtml(raw, {}, "fallback");
        assert(html.includes("New Legal"));
        assert(html.includes('class="watermark"'));
        assert(html.includes("data:image/svg+xml;base64,"));
        assert(!html.includes("COST_MARKUP"));
        const original = (await one(
          db,
          "SELECT * FROM quotations WHERE id=$1",
          [issued.id],
        ))!;
        assert(
          !quotationHtml(original, await settings(db), "fallback").includes(
            "New Legal",
          ),
        );
      },
    );
    await t.test(
      "Number search defaults to owned quotations; explicit all scope requires permission",
      async () => {
        const otherId = randomUUID(),
          role = (await one(db, "SELECT id FROM roles WHERE id='STAFF'"))!;
        await db.query(
          "INSERT INTO users(id,username,name,password_hash,role_id) SELECT $1,'other','Other',password_hash,$2 FROM users WHERE id=$3",
          [otherId, role.id, actor.id],
        );
        await db.query("UPDATE quotations SET owner_id=$1 WHERE id=$2", [
          otherId,
          issued.id,
        ]);
        const request = async (query: string) =>
          handle(
            new Request("http://localhost:18180/api/v1/quotations?" + query, {
              headers: { Cookie: cookie },
            }),
            db,
          );
        assert.equal(
          (await (await request("q=" + issued.number)).json()).length,
          0,
        );
        assert.equal(
          (await (await request("q=" + issued.number + "&scope=all")).json())
            .length,
          1,
        );
        const other = await login(db, {
            username: "other",
            password: "Advanced-test-password-129",
          }),
          otherCookie = sessionCookie(other.token).split(";")[0];
        const denied = await handle(
          new Request("http://localhost:18180/api/v1/quotations?scope=all", {
            headers: { Cookie: otherCookie },
          }),
          db,
        );
        assert.equal(denied.status, 403);
        const list = await handle(
          new Request("http://localhost:18180/api/v1/quotations?q=AMT-SALES", {
            headers: { Cookie: otherCookie },
          }),
          db,
        );
        assert.equal((await list.json()).length, 0);
      },
    );
  } finally {
    await db.close?.();
  }
});
