import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { embedded, migrate } from "../backend/core/db";
import {
  setup,
  login,
  authenticate,
  sessionCookie,
} from "../backend/auth/service";
import {
  analyze,
  get,
  remove,
  processAnalysis,
} from "../backend/quantity-finder/service";
import {
  exportQuantityXlsx,
  quantityHtml,
} from "../backend/worker/quantity-finder";
import { json } from "../backend/core/audit";

test("Quantity Finder groups exact source text and separates returns and invalid rows", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "quantity-finder-setup-token-long";
  process.env.UPLOAD_DIR = path.join(
    process.cwd(),
    ".data",
    "quantity-test-" + randomUUID(),
  );
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  const id = randomUUID();
  await db.query(
    "INSERT INTO quantity_reports(id,filename,file_path,status,owner_id,columns,summary) VALUES($1,'qty.xlsx','fixture','AWAITING_MAPPING',$2,$3,$4)",
    [
      id,
      actor.id,
      json(["Part Number", "Qty", "Description", "Unit Price", "Line Total"]),
      json({ totalRows: 8 }),
    ],
  );
  const source = [
    { p: "ABC", q: "2", d: "Panel A", u: "10", t: "20" },
    { p: "ABC", q: "3.5", d: "Panel A", u: "11", t: "38.5" },
    { p: "ABC", q: "-1", d: "Panel A Return", u: "10", t: "-10" },
    { p: "abc", q: "4", d: "Panel B", u: "15", t: "60" },
    { p: " ABC ", q: "5", d: "Panel C", u: "9", t: "45" },
    { p: "A.BC", q: "6", d: "Panel D", u: "8", t: "48" },
    { p: "", q: "2", d: "Missing", u: "5", t: "10" },
    { p: "ABC", q: "0", d: "Zero", u: "10", t: "0" },
  ];
  for (let i = 0; i < source.length; i++)
    await db.query(
      "INSERT INTO quantity_report_rows(id,report_id,row_number,raw) VALUES($1,$2,$3,$4)",
      [
        randomUUID(),
        id,
        i + 1,
        json({
          "Part Number": source[i].p,
          Qty: source[i].q,
          Description: source[i].d,
          "Unit Price": source[i].u,
          "Line Total": source[i].t,
        }),
      ],
    );
  await analyze(db, actor, id, {
    version: 1,
    partNumber: "Part Number",
    quantity: "Qty",
    description: "Description",
    unitPrice: "Unit Price",
    lineTotal: "Line Total",
  });
  await processAnalysis(db, id, actor.id);
  const result: any = await get(db, actor, id, 0, 50, "GROUPS", "", "PART_ASC");
  assert.equal(result.summary.groupCount, 4);
  assert.equal(result.summary.soldQuantity, "20.5");
  assert.equal(result.summary.returnedQuantity, "1");
  assert.equal(result.summary.netQuantity, "19.5");
  const abc = result.rows.find((row: any) => row.source_part === "ABC");
  assert.deepEqual(
    [
      abc.sold_quantity,
      abc.returned_quantity,
      abc.net_quantity,
      abc.occurrences,
    ],
    ["5.500000", "1.000000", "4.500000", 3],
  );
  assert.deepEqual(
    result.rows.map((row: any) => row.source_part),
    [" ABC ", "A.BC", "ABC", "abc"],
  );
  const invalid: any = await get(db, actor, id, 0, 50, "INVALID");
  assert.equal(invalid.resultCount, 2);
  assert.match(invalid.rows[0].error, /blank/);
  assert.match(invalid.rows[1].error, /zero/);
  const detail: any = await get(
    db,
    actor,
    id,
    0,
    50,
    "GROUPS",
    "",
    "PART_ASC",
    "ABC",
  );
  assert.equal(detail.group, "ABC");
  assert.equal(detail.groupRows.length, 3);
  assert.equal(detail.groupRows[0].description, "Panel A");
  assert.equal(detail.groupRows[0].unitPrice, "10");
  assert.equal(detail.groupRows[2].direction, "RETURNED");
  assert.equal(detail.groupInsights.unitPriceMin, "10.000000");
  assert.equal(detail.groupInsights.unitPriceMax, "11.000000");
  assert.equal(detail.groupInsights.lineTotalSum, "48.500000");
  const job = randomUUID();
  await exportQuantityXlsx(db, job, id);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(
    path.join(process.env.UPLOAD_DIR, "quantity-finder-exports", job + ".xlsx"),
  );
  assert.equal(book.getWorksheet("Grouped Results")!.rowCount, 5);
  assert.equal(book.getWorksheet("Invalid Rows")!.rowCount, 3);
  assert.match(await quantityHtml(db, id), /Returned/);
  if (process.env.QUANTITY_FINDER_VISUAL_DIR) {
    await fs.mkdir(process.env.QUANTITY_FINDER_VISUAL_DIR, { recursive: true });
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(await quantityHtml(db, id));
      await page.pdf({
        path: path.join(
          process.env.QUANTITY_FINDER_VISUAL_DIR,
          "quantity-finder.pdf",
        ),
        format: "A4",
        landscape: true,
        printBackground: true,
      });
    } finally {
      await browser.close();
    }
  }
  await db.query(
    "UPDATE jobs SET status='DONE' WHERE payload->>'reportId'=$1 AND kind IN ('QUANTITY_ANALYZE','QUANTITY_XLSX','QUANTITY_PDF')",
    [id],
  );
  await fs.writeFile("fixture", "");
  await remove(db, actor, id);
  await assert.rejects(() => get(db, actor, id), /not found/i);
  await fs.rm("fixture", { force: true });
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  await db.close?.();
});

test("Quantity Finder supports a mapped return quantity column and drilldown values", async () => {
  const db = await embedded();
  await migrate(db);
  process.env.SETUP_TOKEN = "quantity-finder-return-token-long";
  process.env.UPLOAD_DIR = path.join(
    process.cwd(),
    ".data",
    "quantity-return-test-" + randomUUID(),
  );
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "admin",
    password: "abcd",
    name: "Admin",
    companyName: "AMT",
  });
  const signed = await login(db, { username: "admin", password: "abcd" });
  const actor = await authenticate(
    db,
    new Request("http://localhost", {
      headers: { Cookie: sessionCookie(signed.token).split(";")[0] },
    }),
  );
  const id = randomUUID();
  await db.query(
    "INSERT INTO quantity_reports(id,filename,file_path,status,owner_id,columns,summary) VALUES($1,'returns.xlsx','fixture-returns','AWAITING_MAPPING',$2,$3,$4)",
    [
      id,
      actor.id,
      json(["Part Number", "Sold Qty", "Return Qty", "Description"]),
      json({ totalRows: 5 }),
    ],
  );
  const source = [
    { p: "ABC", s: "5", r: "0", d: "Sold row" },
    { p: "ABC", s: "0", r: "2", d: "Return row" },
    { p: "ABC", s: "3", r: "-1", d: "Negative return source" },
    { p: "XYZ", s: "0", r: "0", d: "Zero row" },
    { p: "XYZ", s: "4", r: "bad", d: "Invalid return" },
  ];
  for (let i = 0; i < source.length; i++)
    await db.query(
      "INSERT INTO quantity_report_rows(id,report_id,row_number,raw) VALUES($1,$2,$3,$4)",
      [
        randomUUID(),
        id,
        i + 1,
        json({
          "Part Number": source[i].p,
          "Sold Qty": source[i].s,
          "Return Qty": source[i].r,
          Description: source[i].d,
        }),
      ],
    );
  await analyze(db, actor, id, {
    version: 1,
    partNumber: "Part Number",
    quantity: "Sold Qty",
    returnQuantity: "Return Qty",
    description: "Description",
  });
  await processAnalysis(db, id, actor.id);
  const result: any = await get(db, actor, id, 0, 50, "GROUPS", "", "PART_ASC");
  assert.equal(result.summary.groupCount, 1);
  assert.equal(result.summary.soldQuantity, "8");
  assert.equal(result.summary.returnedQuantity, "3");
  assert.equal(result.summary.netQuantity, "5");
  const abc = result.rows.find((row: any) => row.source_part === "ABC");
  assert.deepEqual(
    [
      abc.sold_quantity,
      abc.returned_quantity,
      abc.net_quantity,
      abc.occurrences,
    ],
    ["8.000000", "3.000000", "5.000000", 3],
  );
  const invalid: any = await get(db, actor, id, 0, 50, "INVALID");
  assert.equal(invalid.resultCount, 2);
  assert.match(invalid.rows[0].error, /both be zero/i);
  assert.match(invalid.rows[1].error, /return quantity/i);
  const detail: any = await get(
    db,
    actor,
    id,
    0,
    50,
    "GROUPS",
    "",
    "PART_ASC",
    "ABC",
  );
  assert.equal(detail.groupRows.length, 3);
  assert.equal(detail.groupRows[0].soldQuantity, "5.000000");
  assert.equal(detail.groupRows[0].returnedQuantity, "0.000000");
  assert.equal(detail.groupRows[1].soldQuantity, "0.000000");
  assert.equal(detail.groupRows[1].returnedQuantity, "2.000000");
  assert.equal(detail.groupRows[1].direction, "RETURNED");
  assert.equal(detail.groupRows[2].returnSourceValue, "-1");
  assert.equal(detail.groupRows[2].returnedQuantity, "1.000000");
  assert.equal(detail.groupRows[2].netContribution, "2.000000");
  await db.query(
    "UPDATE jobs SET status='DONE' WHERE payload->>'reportId'=$1 AND kind='QUANTITY_ANALYZE'",
    [id],
  );
  await fs.writeFile("fixture-returns", "");
  await remove(db, actor, id);
  await fs.rm("fixture-returns", { force: true });
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  await db.close?.();
});
