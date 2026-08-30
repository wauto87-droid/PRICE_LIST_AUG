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
    [id, actor.id, json(["Part Number", "Qty"]), json({ totalRows: 8 })],
  );
  const source = [
    { p: "ABC", q: "2" },
    { p: "ABC", q: "3.5" },
    { p: "ABC", q: "-1" },
    { p: "abc", q: "4" },
    { p: " ABC ", q: "5" },
    { p: "A.BC", q: "6" },
    { p: "", q: "2" },
    { p: "ABC", q: "0" },
  ];
  for (let i = 0; i < source.length; i++)
    await db.query(
      "INSERT INTO quantity_report_rows(id,report_id,row_number,raw) VALUES($1,$2,$3,$4)",
      [
        randomUUID(),
        id,
        i + 1,
        json({ "Part Number": source[i].p, Qty: source[i].q }),
      ],
    );
  await analyze(db, actor, id, {
    version: 1,
    partNumber: "Part Number",
    quantity: "Qty",
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
  await fs.rm(process.env.UPLOAD_DIR, { recursive: true, force: true });
  await db.close?.();
});
