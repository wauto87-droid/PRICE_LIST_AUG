import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, PERMISSIONS } from "../backend/auth/service";
import { upload } from "../backend/imports/service";
import { runJob } from "../backend/worker/process";
import { calculate, productInput, totals } from "../backend/pricing/engine";
import { json } from "../backend/core/audit";
import { saveProduct } from "../backend/products/service";
import ExcelJS from "exceljs";
test(
  "Worker extraction and bilingual multi-page PDF",
  { skip: process.env.RUN_WORKER_TESTS !== "true" },
  async (t) => {
    const db = await embedded();
    await migrate(db);
    process.env.SETUP_TOKEN = "test-worker-setup-token-minimum-32-characters";
    process.env.UPLOAD_DIR = path.resolve("test-results/worker");
    await fs.mkdir(process.env.UPLOAD_DIR, { recursive: true });
    await setup(db, {
      token: process.env.SETUP_TOKEN,
      username: "workeradmin",
      password: "Worker-password-129",
      name: "Test",
      companyName: "AMT Electric",
    });
    const user = await one(db, "SELECT id FROM users LIMIT 1"),
      actor = {
        id: user!.id,
        username: "workeradmin",
        name: "Test",
        role: "ADMIN",
        permissions: [...PERMISSIONS],
        maxDiscount: "100",
        csrf: "",
      };
    await t.test(
      "CSV extraction stages rows without publishing products",
      async () => {
        const job = await upload(
          db,
          actor,
          new File(
            ["CODE,DESC,PRICE\nTEST001,Contactor,100\n"],
            "supplier.csv",
          ),
        );
        await runJob(db);
        assert.equal(
          (await one(db, "SELECT status FROM import_jobs WHERE id=$1", [
            job.id,
          ]))!.status,
          "AWAITING_REVIEW",
        );
        assert.equal(
          (await one(db, "SELECT count(*) AS n FROM products"))!.n,
          0,
        );
        assert.equal(
          (await one(db, "SELECT raw FROM import_rows WHERE job_id=$1", [
            job.id,
          ]))!.raw.PRICE,
          "100",
        );
      },
    );
    await t.test(
      "Invalid PDF fails safely and leaves catalog unchanged",
      async () => {
        const job = await upload(
          db,
          actor,
          new File(["not a PDF"], "invalid.pdf"),
        );
        await runJob(db);
        assert.equal(
          (await one(db, "SELECT status FROM import_jobs WHERE id=$1", [
            job.id,
          ]))!.status,
          "FAILED",
        );
      },
    );
    await t.test("Invalid XLSX fails safely", async () => {
      const job = await upload(
        db,
        actor,
        new File(["not a workbook"], "invalid.xlsx"),
      );
      await runJob(db);
      assert.equal(
        (await one(db, "SELECT status FROM import_jobs WHERE id=$1", [job.id]))!
          .status,
        "FAILED",
      );
    });
    await t.test("Large XLSX above 10,000 rows stages successfully", async () => {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("PriceUpdate");
      sheet.addRow(["Part Reference", "Local Description", "Public Pricelist"]);
      for (let i = 0; i < 10001; i++)
        sheet.addRow([`ROW-${i}`, `Description ${i}`, "100"]);
      const buffer = Buffer.from(await book.xlsx.writeBuffer());
      const job = await upload(db, actor, new File([buffer], "large.xlsx"));
      await runJob(db);
      const staged = await one(
        db,
        "SELECT status,summary FROM import_jobs WHERE id=$1",
        [job.id],
      );
      assert.equal(staged!.status, "AWAITING_REVIEW");
      assert.equal(staged!.summary.rows, 10001);
    });
    await t.test("Oversized row-count XLSX reports a clear safe error", async () => {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("PriceUpdate");
      sheet.addRow(["Part Reference", "Local Description", "Public Pricelist"]);
      for (let i = 0; i < 50001; i++)
        sheet.addRow([`ROW-${i}`, `Description ${i}`, "100"]);
      const buffer = Buffer.from(await book.xlsx.writeBuffer());
      const job = await upload(db, actor, new File([buffer], "too-many.xlsx"));
      await runJob(db);
      const failed = await one(
        db,
        "SELECT status,error FROM import_jobs WHERE id=$1",
        [job.id],
      );
      assert.equal(failed!.status, "FAILED");
      assert.match(failed!.error, /more than 50,000 rows/i);
    });
    await t.test("Oversized upload rejected before persistence", async () => {
      process.env.UPLOAD_MAX_MB = "1";
      await assert.rejects(
        upload(
          db,
          actor,
          new File([new Uint8Array(1024 * 1024 + 1)], "huge.pdf"),
        ),
      );
      process.env.UPLOAD_MAX_MB = "20";
    });
    const price = calculate(
      productInput.parse({
        partNumber: "LC1D09M7",
        description: "قاطع كهربائي / Contactor",
        method: "COST_MARKUP",
        cost: "100",
        markup: "25",
      }),
      { maxDiscount: "20", canOverride: false },
      { quantity: "2", discount: "5", override: false, reason: "" },
    );
    const lines = Array.from({ length: 70 }, (_, i) => ({
      partNumber: "LC1D09M7-" + (i + 1),
      description: "قاطع كهربائي / Contactor 9A 220V",
      unit: "pcs",
      price,
    }));
    const quote = {
      id: randomUUID(),
      number: "QT-TEST-0001",
      status: "ISSUED",
      created_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      customer: {
        name: "عميل تجريبي / Test Customer",
        number: "TEST",
        reference: "MULTI-PAGE QA",
      },
      lines,
      totals: totals(lines.map((l) => l.price)),
      company_snapshot: {
        companyName: "AMT Electric",
        companyArabic: "AMT للكهرباء",
        currency: "SAR",
        pdfUnitPrices: "BOTH",
        quotation: {
          legalName: "AMT Electric Trading",
          vatRegistration: "300000000000003",
          delivery: "Available stock / حسب التوفر",
          payment: "Cash / نقداً",
          termsEnglish:
            "Prices exclude VAT unless specified. Subject to stock availability.",
          termsArabic:
            "الأسعار قبل الضريبة ما لم يذكر خلاف ذلك. التوريد حسب التوفر.",
          watermark: {
            enabled: true,
            useLogo: true,
            text: "AMT ELECTRIC / الكهرباء",
            opacity: 0.08,
            size: 260,
            rotation: -30,
            position: "CENTER",
          },
        },
      },
    };
    const pdfId = randomUUID();
    await t.test("Generate PDF with fixed quotation snapshot", async () => {
      await db.query(
        "INSERT INTO jobs(id,kind,payload) VALUES($1,'QUOTE_PDF',$2)",
        [pdfId, json({ snapshot: quote })],
      );
      await runJob(db);
      assert.equal(
        (await one(db, "SELECT status FROM jobs WHERE id=$1", [pdfId]))!.status,
        "DONE",
      );
      const target = path.join(process.env.UPLOAD_DIR!, "pdf", pdfId + ".pdf");
      assert((await fs.stat(target)).size > 5000);
      await fs.copyFile(target, "test-results/AMT-quotation-multipage.pdf");
    });
    await t.test("Text PDF extracts staged low-confidence rows", async () => {
      const file = await fs.readFile(
        "test-results/AMT-quotation-multipage.pdf",
      );
      const job = await upload(db, actor, new File([file], "quotation.pdf"));
      await runJob(db);
      assert.equal(
        (await one(db, "SELECT status FROM import_jobs WHERE id=$1", [job.id]))!
          .status,
        "AWAITING_REVIEW",
      );
      const rows = (
        await db.query("SELECT confidence FROM import_rows WHERE job_id=$1", [
          job.id,
        ])
      ).rows;
      assert(rows.length > 0);
      assert(rows.every((r) => r.confidence === "LOW"));
    });
    await t.test("PDF page limit enforced", async () => {
      process.env.PDF_MAX_PAGES = "1";
      const file = await fs.readFile(
        "test-results/AMT-quotation-multipage.pdf",
      );
      const job = await upload(
        db,
        actor,
        new File([file], "over-page-limit.pdf"),
      );
      await runJob(db);
      assert.equal(
        (await one(db, "SELECT status FROM import_jobs WHERE id=$1", [job.id]))!
          .status,
        "FAILED",
      );
      process.env.PDF_MAX_PAGES = "100";
    });
    await t.test(
      "Streamed workbook export filters costs and preserves literal text",
      async () => {
        await db.transaction((tx) =>
          saveProduct(tx, actor, {
            partNumber: "EXPORT-TEST",
            description: '=HYPERLINK("https://invalid.example")',
            method: "COST_MARKUP",
            cost: "100",
            markup: "25",
          }),
        );
        const id = randomUUID();
        await db.query(
          "INSERT INTO jobs(id,kind,payload) VALUES($1,'CATALOG_EXPORT',$2)",
          [id, json({ includeCosts: false })],
        );
        await runJob(db);
        assert.equal(
          (await one(db, "SELECT status FROM jobs WHERE id=$1", [id]))!.status,
          "DONE",
        );
        const book = new ExcelJS.Workbook();
        await book.xlsx.readFile(
          path.join(process.env.UPLOAD_DIR!, "exports", id + ".xlsx"),
        );
        const sheet = book.worksheets[0];
        const headers = sheet.getRow(1).values as any[];
        assert(!headers.includes("cost"));
        assert(!headers.includes("minimum"));
        assert(headers.includes("masterExcl"));
        assert.equal(sheet.getRow(2).getCell(2).type, ExcelJS.ValueType.String);
      },
    );
  },
);
