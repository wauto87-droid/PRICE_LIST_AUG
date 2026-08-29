import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { embedded, migrate, one } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
import { analyze, get, processAnalysis } from "../backend/sales-checks/service";
import {
  exportSalesCheckXlsx,
  salesCheckHtml,
} from "../backend/worker/sales-check";
import { json } from "../backend/core/audit";

test("Sales price check preserves lines, loosely matches punctuation, and exports", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "sales-check-setup-token-long-enough";
  process.env.UPLOAD_DIR = path.join(
    process.cwd(),
    ".data",
    "sales-check-test-" + randomUUID(),
  );
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const auth = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(auth.token).split(";")[0] },
    }),
  );
  const product = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "LC1-D09",
      description: "Contactor",
      method: "LIST_DISCOUNT",
      listPrice: "100",
      baseDiscount: "20",
      cost: "0",
      markup: "0",
      vat: "15",
      minimumEnabled: false,
      minimum: "0",
      unit: "pcs",
      quantityPrecision: 0,
      active: true,
      aliases: [],
      keywords: "",
      brand: "",
      category: "",
    }),
  );
  for (const part of ["AB-1", "AB.1"])
    await db.transaction((tx) =>
      saveProduct(tx, actor, {
        partNumber: part,
        description: part,
        method: "LIST_DISCOUNT",
        listPrice: "50",
        baseDiscount: "0",
        cost: "0",
        markup: "0",
        vat: "15",
        minimumEnabled: false,
        minimum: "0",
        unit: "pcs",
        quantityPrecision: 0,
        active: true,
        aliases: [],
        keywords: "",
        brand: "",
        category: "",
      }),
    );
  const reportId = randomUUID();
  await db.query(
    "INSERT INTO sales_price_reports(id,filename,file_path,status,owner_id,columns,summary) VALUES($1,'7740.XLS','fixture','AWAITING_MAPPING',$2,$3,'{}')",
    [reportId, actor.id, json(["Item Code", "Sales Price"])],
  );
  const raw = [
    { "Item Code": "LC1 . D09", "Sales Price": "80" },
    { "Item Code": "LC1 . D09", "Sales Price": "120" },
    { "Item Code": "AB 1", "Sales Price": "40" },
    { "Item Code": "UNKNOWN", "Sales Price": "10" },
    { "Item Code": "LC1-D09", "Sales Price": "invalid" },
  ];
  for (let i = 0; i < raw.length; i++)
    await db.query(
      "INSERT INTO sales_price_rows(id,report_id,row_number,raw) VALUES($1,$2,$3,$4)",
      [randomUUID(), reportId, i + 1, json(raw[i])],
    );
  const queued = await analyze(db, actor, reportId, {
    version: 1,
    partNumber: "Item Code",
    salesPrice: "Sales Price",
  });
  assert.equal(queued.status, "PENDING");
  const processing: any = await get(db, actor, reportId, 0, 50, "ALL", "");
  assert.equal(processing.status, "PROCESSING");
  assert.equal(processing.progress.percentage, 0);
  await assert.rejects(
    analyze(db, actor, reportId, {
      version: 1,
      partNumber: "Item Code",
      salesPrice: "Sales Price",
    }),
    /already being checked|not ready for mapping/,
  );
  await processAnalysis(db, reportId, actor.id);
  const report = await get(db, actor, reportId, 0, 50, "ALL", "");
  assert.equal(report.rows.length, 5);
  assert.equal((report as any).progress.percentage, 100);
  assert.equal((report as any).progress.remainingSeconds, 0);
  assert.equal(report.rows[0].product_id, product.id);
  assert.equal(report.rows[0].match_type, "LOOSE");
  assert.equal(report.rows[0].item_check, "Checked");
  assert.equal(report.rows[0].discount_percent, "20.000000");
  assert.equal(report.rows[1].discount_percent, "-20.000000");
  assert.equal(report.rows[2].status, "AMBIGUOUS");
  assert.equal(report.rows[2].item_check, "Not matched item");
  assert.equal(report.rows[3].status, "UNMATCHED");
  assert.equal(report.rows[3].item_check, "Not matched item");
  assert.equal(report.rows[4].status, "INVALID");
  assert.equal(report.rows[4].item_check, "Checked");
  assert.equal(
    (await get(db, actor, reportId, 0, 50, "CHECKED", "")).resultCount,
    3,
  );
  assert.equal(
    (await get(db, actor, reportId, 0, 50, "NOT_MATCHED", "")).resultCount,
    2,
  );
  const minimumDiscount = await get(
    db,
    actor,
    reportId,
    0,
    50,
    "ALL",
    "",
    "10",
  );
  assert.deepEqual(
    minimumDiscount.rows.map((row: any) => row.row_number),
    [1],
  );
  const stackedDiscountFilter = await get(
    db,
    actor,
    reportId,
    0,
    50,
    "MATCHED",
    "",
    "10",
  );
  assert.deepEqual(
    stackedDiscountFilter.rows.map((row: any) => row.row_number),
    [1],
  );
  const discountDescending = await get(
    db,
    actor,
    reportId,
    0,
    50,
    "ALL",
    "",
    "",
    "DISCOUNT_DESC",
  );
  assert.deepEqual(
    discountDescending.rows.map((row: any) => row.row_number),
    [1, 2, 3, 4, 5],
  );
  const discountAscending = await get(
    db,
    actor,
    reportId,
    0,
    50,
    "ALL",
    "",
    "",
    "DISCOUNT_ASC",
  );
  assert.deepEqual(
    discountAscending.rows.map((row: any) => row.row_number),
    [2, 1, 3, 4, 5],
  );
  const defaultOrder = await get(db, actor, reportId, 0, 50, "ALL", "");
  assert.deepEqual(
    defaultOrder.rows.map((row: any) => row.row_number),
    [1, 2, 3, 4, 5],
  );
  const exportId = randomUUID();
  await exportSalesCheckXlsx(db, exportId, reportId);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(
    path.join(
      process.env.UPLOAD_DIR,
      "sales-check-exports",
      exportId + ".xlsx",
    ),
  );
  assert.equal(book.getWorksheet("Sales Price Check")!.rowCount, 6);
  assert.equal(
    book.getWorksheet("Sales Price Check")!.getCell("H2").value,
    "Checked",
  );
  assert.equal(
    book.getWorksheet("Sales Price Check")!.getCell("H4").value,
    "Not matched item",
  );
  const html = await salesCheckHtml(db, reportId);
  assert.match(html, /LC1 \. D09/);
  assert.match(html, /Not matched item/);
  if (process.env.SALES_CHECK_VISUAL_DIR) {
    await fs.mkdir(process.env.SALES_CHECK_VISUAL_DIR, { recursive: true });
    await fs.copyFile(
      path.join(
        process.env.UPLOAD_DIR,
        "sales-check-exports",
        exportId + ".xlsx",
      ),
      path.join(process.env.SALES_CHECK_VISUAL_DIR, "sales-price-check.xlsx"),
    );
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(await salesCheckHtml(db, reportId));
      await page.pdf({
        path: path.join(
          process.env.SALES_CHECK_VISUAL_DIR,
          "sales-price-check.pdf",
        ),
        format: "A4",
        landscape: true,
        printBackground: true,
      });
    } finally {
      await browser.close();
    }
  }
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  await db.close?.();
});
