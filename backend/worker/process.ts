import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { type DB, one } from "../core/db";
import { json } from "../core/audit";
import { quotationHtml, escapeHtml } from "../pdf/template";
import { finalizeQuotationPdf } from "../pdf/cache";
import { settings } from "../admin/service";
import { exportCatalog } from "./export";
import { exportSalesCheckXlsx, salesCheckHtml } from "./sales-check";
import { processAnalysis } from "../sales-checks/service";
import { processAnalysis as processQuantityAnalysis } from "../quantity-finder/service";
import { exportQuantityXlsx, quantityHtml } from "./quantity-finder";
import { exportPriceWatcherXlsx, priceWatcherHtml } from "./price-watcher";
import { processJob as processProductEnrichment } from "../product-enrichment/service";
import { processValidation as processImportValidation } from "../imports/service";
const exec = promisify(execFile);
const IMPORT_MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS || 50000);

function importFailureMessage(error: Error) {
  const message = error.message || "Extraction failed";
  if (
    message.includes(`Maximum ${IMPORT_MAX_ROWS.toLocaleString("en-US")} rows`)
  )
    return `Import failed: the file has more than ${IMPORT_MAX_ROWS.toLocaleString("en-US")} rows. Split it into smaller files and upload again.`;
  if (message.includes("Expanded workbook exceeds 100 MB"))
    return "Import failed: the Excel workbook expands beyond the 100 MB safety limit.";
  if (message.includes("Too many or duplicate column headings"))
    return "Import failed: the first sheet has too many columns or duplicate column names.";
  if (message.includes("Unsupported format"))
    return "Import failed: only XLSX, XLS, CSV, and PDF files are supported.";
  return "Extraction failed. Check file format, size, page count, and worker availability.";
}

export async function runJob(db: DB) {
  const job = await db.transaction(async (tx) => {
    const row = await one(
      tx,
      "SELECT * FROM jobs WHERE kind IN ('IMPORT_EXTRACT','IMPORT_VALIDATE','DELIVERY_QUOTE_EXTRACT','QUOTE_PDF','CATALOG_EXPORT','SALES_CHECK_EXTRACT','SALES_CHECK_ANALYZE','SALES_CHECK_XLSX','SALES_CHECK_PDF','QUANTITY_EXTRACT','QUANTITY_ANALYZE','QUANTITY_XLSX','QUANTITY_PDF','PRICE_WATCHER_XLSX','PRICE_WATCHER_PDF','PRODUCT_AI_ENRICH') AND (status='PENDING' OR (status='RUNNING' AND locked_at<now()-interval '15 minutes')) AND attempts<3 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (!row) return null;
    await tx.query(
      "UPDATE jobs SET status='RUNNING',locked_at=now(),attempts=attempts+1 WHERE id=$1",
      [row.id],
    );
    return row;
  });
  if (!job) return false;
  try {
    if (job.kind === "IMPORT_VALIDATE")
      await processImportValidation(db, job.payload.importId, job.id);
    else if (job.kind === "CATALOG_EXPORT")
      await db.transaction(async (tx) => {
        await tx.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        await exportCatalog(tx, job.id, job.payload.includeCosts);
      });
    else if (
      job.kind === "IMPORT_EXTRACT" ||
      job.kind === "DELIVERY_QUOTE_EXTRACT" ||
      job.kind === "SALES_CHECK_EXTRACT" ||
      job.kind === "QUANTITY_EXTRACT"
    ) {
      if (job.kind === "QUANTITY_EXTRACT") {
        const report = await one(
          db,
          "SELECT * FROM quantity_reports WHERE id=$1",
          [job.payload.reportId],
        );
        if (!report) throw new Error("Quantity report missing");
        await db.query(
          "UPDATE quantity_reports SET status='PROCESSING',progress=$2,updated_at=now() WHERE id=$1",
          [
            report.id,
            json({
              phase: "READING",
              processedRows: 0,
              totalRows: 0,
              percentage: null,
              remainingSeconds: null,
            }),
          ],
        );
        const { stdout } = await exec(
          process.env.PYTHON_BIN || "python3",
          [
            path.join(process.cwd(), "scripts", "extract.py"),
            report.file_path,
            "1",
            String(IMPORT_MAX_ROWS),
          ],
          { timeout: 300000, maxBuffer: 128 * 1024 * 1024, windowsHide: true },
        );
        const extracted = JSON.parse(stdout);
        if (
          !Array.isArray(extracted.rows) ||
          extracted.rows.length > IMPORT_MAX_ROWS
        )
          throw new Error(`Maximum ${IMPORT_MAX_ROWS} rows`);
        await db.transaction(async (tx) => {
          await tx.query(
            "DELETE FROM quantity_report_rows WHERE report_id=$1",
            [report.id],
          );
          for (let i = 0; i < extracted.rows.length; i++)
            await tx.query(
              "INSERT INTO quantity_report_rows(id,report_id,row_number,raw) VALUES($1,$2,$3,$4)",
              [randomUUID(), report.id, i + 1, json(extracted.rows[i])],
            );
          await tx.query(
            "UPDATE quantity_reports SET status='AWAITING_MAPPING',columns=$2,summary=$3,progress=$4,version=version+1,updated_at=now() WHERE id=$1",
            [
              report.id,
              json(extracted.columns || []),
              json({
                totalRows: extracted.rows.length,
                warnings: extracted.warnings || [],
              }),
              json({
                phase: "COMPLETE",
                processedRows: extracted.rows.length,
                totalRows: extracted.rows.length,
                percentage: 100,
                remainingSeconds: 0,
              }),
            ],
          );
        });
      } else if (job.kind === "SALES_CHECK_EXTRACT") {
        const report = await one(
          db,
          "SELECT * FROM sales_price_reports WHERE id=$1",
          [job.payload.reportId],
        );
        if (!report) throw new Error("Sales price report missing");
        await db.query(
          "UPDATE sales_price_reports SET status='PROCESSING',progress=$2,updated_at=now() WHERE id=$1",
          [
            report.id,
            json({
              phase: "READING",
              processedRows: 0,
              totalRows: 0,
              percentage: null,
              startedAt: new Date().toISOString(),
              remainingSeconds: null,
            }),
          ],
        );
        const { stdout } = await exec(
          process.env.PYTHON_BIN || "python3",
          [
            path.join(process.cwd(), "scripts", "extract.py"),
            report.file_path,
            "1",
            String(IMPORT_MAX_ROWS),
          ],
          { timeout: 300000, maxBuffer: 128 * 1024 * 1024, windowsHide: true },
        );
        const extracted = JSON.parse(stdout);
        if (
          !Array.isArray(extracted.rows) ||
          extracted.rows.length > IMPORT_MAX_ROWS
        )
          throw new Error(`Maximum ${IMPORT_MAX_ROWS} rows`);
        await db.transaction(async (tx) => {
          await tx.query("DELETE FROM sales_price_rows WHERE report_id=$1", [
            report.id,
          ]);
          for (let i = 0; i < extracted.rows.length; i++)
            await tx.query(
              "INSERT INTO sales_price_rows(id,report_id,row_number,raw) VALUES($1,$2,$3,$4)",
              [randomUUID(), report.id, i + 1, json(extracted.rows[i])],
            );
          await tx.query(
            "UPDATE sales_price_reports SET status='AWAITING_MAPPING',columns=$2,summary=$3,progress=$4,version=version+1,updated_at=now() WHERE id=$1",
            [
              report.id,
              json(extracted.columns || []),
              json({
                totalRows: extracted.rows.length,
                warnings: extracted.warnings || [],
              }),
              json({
                phase: "COMPLETE",
                processedRows: extracted.rows.length,
                totalRows: extracted.rows.length,
                percentage: 100,
                remainingSeconds: 0,
              }),
            ],
          );
        });
      } else if (job.kind === "IMPORT_EXTRACT") {
        const imp = await one(db, "SELECT * FROM import_jobs WHERE id=$1", [
          job.payload.importId,
        ]);
        if (!imp) throw new Error("Import job missing");
        if (!["UPLOADED", "PROCESSING"].includes(imp.status))
          throw new Error("Import cannot be re-extracted in this state");
        await db.query(
          "UPDATE import_jobs SET status='PROCESSING',updated_at=now() WHERE id=$1",
          [imp.id],
        );
        const { stdout } = await exec(
          process.env.PYTHON_BIN || "python3",
          [
            path.join(process.cwd(), "scripts", "extract.py"),
            imp.file_path,
            String(process.env.PDF_MAX_PAGES || 100),
            String(IMPORT_MAX_ROWS),
          ],
          { timeout: 300000, maxBuffer: 128 * 1024 * 1024, windowsHide: true },
        );
        const extracted = JSON.parse(stdout);
        if (
          !Array.isArray(extracted.rows) ||
          extracted.rows.length > IMPORT_MAX_ROWS
        )
          throw new Error(
            `Maximum ${IMPORT_MAX_ROWS.toLocaleString("en-US")} rows per import`,
          );
        await db.transaction(async (tx) => {
          await tx.query("DELETE FROM import_rows WHERE job_id=$1", [imp.id]);
          for (let i = 0; i < extracted.rows.length; i++)
            await tx.query(
              "INSERT INTO import_rows(id,job_id,row_number,raw,confidence) VALUES($1,$2,$3,$4,$5)",
              [
                randomUUID(),
                imp.id,
                i + 1,
                json(extracted.rows[i]),
                imp.kind === "PDF" ? "LOW" : "HIGH",
              ],
            );
          await tx.query(
            "UPDATE import_jobs SET status='AWAITING_REVIEW',summary=$2,version=version+1,updated_at=now() WHERE id=$1",
            [
              imp.id,
              json({
                rows: extracted.rows.length,
                columns: extracted.columns,
                warnings: extracted.warnings ?? [],
                profile: extracted.profile ?? null,
              }),
            ],
          );
        });
      } else {
        const imp = await one(
          db,
          "SELECT * FROM delivery_quote_jobs WHERE id=$1",
          [job.payload.importId],
        );
        if (!imp) throw new Error("Delivery-note quotation import missing");
        if (!["UPLOADED", "PROCESSING"].includes(imp.status))
          throw new Error(
            "Delivery-note quotation import cannot be re-extracted in this state",
          );
        await db.query(
          "UPDATE delivery_quote_jobs SET status='PROCESSING',updated_at=now() WHERE id=$1",
          [imp.id],
        );
        const { stdout } = await exec(
          process.env.PYTHON_BIN || "python3",
          [
            path.join(process.cwd(), "scripts", "extract.py"),
            imp.file_path,
            "1",
            String(IMPORT_MAX_ROWS),
          ],
          { timeout: 300000, maxBuffer: 128 * 1024 * 1024, windowsHide: true },
        );
        const extracted = JSON.parse(stdout);
        if (
          !Array.isArray(extracted.rows) ||
          extracted.rows.length > IMPORT_MAX_ROWS
        )
          throw new Error(
            `Maximum ${IMPORT_MAX_ROWS.toLocaleString("en-US")} rows per import`,
          );
        await db.transaction(async (tx) => {
          await tx.query("DELETE FROM delivery_quote_rows WHERE job_id=$1", [
            imp.id,
          ]);
          const chunkSize = 250;
          for (let i = 0; i < extracted.rows.length; i += chunkSize) {
            const chunk = extracted.rows.slice(i, i + chunkSize);
            const ids = chunk.map(() => randomUUID());
            const rowNums = chunk.map((_: unknown, idx: number) => i + idx + 1);
            const rawJsons = chunk.map((r: any) => json(r));
            await tx.query(
              `INSERT INTO delivery_quote_rows(id, job_id, row_number, raw)
               SELECT unnest($1::uuid[]), $2, unnest($3::int[]), unnest($4::jsonb[])`,
              [ids, imp.id, rowNums, rawJsons],
            );
          }
          await tx.query(
            "UPDATE delivery_quote_jobs SET status='AWAITING_MAPPING',summary=$2,version=version+1,updated_at=now() WHERE id=$1",
            [
              imp.id,
              json({
                rows: extracted.rows.length,
                columns: extracted.columns,
                warnings: extracted.warnings ?? [],
              }),
            ],
          );
        });
      }
    } else if (job.kind === "SALES_CHECK_ANALYZE")
      await processAnalysis(db, job.payload.reportId, job.payload.actorId);
    else if (job.kind === "QUANTITY_ANALYZE")
      await processQuantityAnalysis(
        db,
        job.payload.reportId,
        job.payload.actorId,
      );
    else if (job.kind === "SALES_CHECK_XLSX")
      await exportSalesCheckXlsx(db, job.id, job.payload.reportId);
    else if (job.kind === "QUANTITY_XLSX")
      await exportQuantityXlsx(db, job.id, job.payload.reportId);
    else if (job.kind === "PRICE_WATCHER_XLSX")
      await exportPriceWatcherXlsx(
        db,
        job.id,
        job.payload.actor,
        job.payload.filters,
      );
    else if (job.kind === "PRODUCT_AI_ENRICH")
      await processProductEnrichment(db, job.payload.enrichmentJobId);
    else if (
      job.kind === "SALES_CHECK_PDF" ||
      job.kind === "QUANTITY_PDF" ||
      job.kind === "QUOTE_PDF" ||
      job.kind === "PRICE_WATCHER_PDF"
    ) {
      if (job.kind === "PRICE_WATCHER_PDF") {
        const { chromium } = await import("playwright"),
          browser = await chromium.launch({
            headless: true,
            executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
            args: ["--disable-dev-shm-usage"],
          });
        try {
          const page = await browser.newPage();
          await page.setContent(
            await priceWatcherHtml(db, job.payload.actor, job.payload.filters),
          );
          const target = path.join(
            path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
            "price-watcher-exports",
          );
          await fs.mkdir(target, { recursive: true });
          await page.pdf({
            path: path.join(target, job.id + ".pdf"),
            format: "A3",
            landscape: true,
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: "<span></span>",
            footerTemplate:
              '<div style="font:9px Arial;color:#777;width:100%;text-align:center">Price Watcher | <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
            margin: {
              top: "12mm",
              bottom: "14mm",
              left: "10mm",
              right: "10mm",
            },
          });
        } finally {
          await browser.close();
        }
      } else if (job.kind === "SALES_CHECK_PDF") {
        const { chromium } = await import("playwright"),
          browser = await chromium.launch({
            headless: true,
            executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
            args: ["--disable-dev-shm-usage"],
          });
        try {
          const page = await browser.newPage();
          await page.setContent(await salesCheckHtml(db, job.payload.reportId));
          const target = path.join(
            path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
            "sales-check-exports",
          );
          await fs.mkdir(target, { recursive: true });
          await page.pdf({
            path: path.join(target, job.id + ".pdf"),
            format: "A4",
            landscape: true,
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: "<span></span>",
            footerTemplate:
              '<div style="font:9px Arial;color:#777;width:100%;text-align:center">Sales Price Check | <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
            margin: {
              top: "12mm",
              bottom: "14mm",
              left: "10mm",
              right: "10mm",
            },
          });
        } finally {
          await browser.close();
        }
      } else if (job.kind === "QUANTITY_PDF") {
        const { chromium } = await import("playwright"),
          browser = await chromium.launch({
            headless: true,
            executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
            args: ["--disable-dev-shm-usage"],
          });
        try {
          const page = await browser.newPage();
          await page.setContent(await quantityHtml(db, job.payload.reportId));
          const target = path.join(
            path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
            "quantity-finder-exports",
          );
          await fs.mkdir(target, { recursive: true });
          await page.pdf({
            path: path.join(target, job.id + ".pdf"),
            format: "A4",
            landscape: true,
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: "<span></span>",
            footerTemplate:
              '<div style="font:9px Arial;color:#777;width:100%;text-align:center">Quantity Finder | <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
            margin: {
              top: "12mm",
              bottom: "14mm",
              left: "10mm",
              right: "10mm",
            },
          });
        } finally {
          await browser.close();
        }
      } else {
        const q = job.payload.snapshot;
        if (!q) throw new Error("PDF snapshot missing");
        const logo =
          "data:image/svg+xml;base64," +
          (
            await fs.readFile(path.join(process.cwd(), "public", "logo.svg"))
          ).toString("base64");
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({
          headless: true,
          executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
          args: ["--disable-dev-shm-usage"],
        });
        try {
          const page = await browser.newPage();
          await page.route("**/*", (route) =>
            route.request().url().startsWith("data:")
              ? route.continue()
              : route.abort(),
          );
          await page.setContent(quotationHtml(q, await settings(db), logo));
          await page.evaluate(() => document.fonts.ready);
          const target = path.join(
            path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
            "pdf",
          );
          await fs.mkdir(target, { recursive: true });
          await page.pdf({
            path: path.join(target, job.id + ".pdf"),
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: "<span></span>",
            footerTemplate: `<div style="font:9px Arial;color:#888;width:100%;text-align:center">${escapeHtml(q.number)} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
          });
        } finally {
          await browser.close();
        }
      }
    }
    if (job.kind === "QUOTE_PDF") await finalizeQuotationPdf(db, job);
    else
      await db.query("UPDATE jobs SET status='DONE',error=NULL WHERE id=$1", [
        job.id,
      ]);
  } catch (e) {
    const failure = e as Error;
    console.error("Worker job failed", job.id, failure.message);
    await db.query("UPDATE jobs SET status='FAILED',error=$2 WHERE id=$1", [
      job.id,
      "Processing failed. Check the worker logs and source file.",
    ]);
    if (job.kind === "IMPORT_EXTRACT")
      await db.query(
        "UPDATE import_jobs SET status='FAILED',error=$2,updated_at=now() WHERE id=$1",
        [job.payload.importId, importFailureMessage(failure)],
      );
    if (job.kind === "IMPORT_VALIDATE")
      await db.query(
        "UPDATE import_jobs SET status='FAILED',error=$2,summary=summary||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          job.payload.importId,
          (e as Error).message,
          json({ progress: { phase: "FAILED" } }),
        ],
      );
    if (job.kind === "DELIVERY_QUOTE_EXTRACT")
      await db.query(
        "UPDATE delivery_quote_jobs SET status='FAILED',error=$2,updated_at=now() WHERE id=$1",
        [job.payload.importId, importFailureMessage(failure)],
      );
    if (
      job.kind === "SALES_CHECK_EXTRACT" ||
      job.kind === "SALES_CHECK_ANALYZE"
    )
      await db.query(
        "UPDATE sales_price_reports SET status='FAILED',error=$2,progress=progress||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          job.payload.reportId,
          job.kind === "SALES_CHECK_ANALYZE"
            ? failure.message
            : importFailureMessage(failure),
          json({ phase: "FAILED", remainingSeconds: null }),
        ],
      );
    if (job.kind === "QUANTITY_EXTRACT" || job.kind === "QUANTITY_ANALYZE")
      await db.query(
        "UPDATE quantity_reports SET status='FAILED',error=$2,progress=progress||$3::jsonb,updated_at=now() WHERE id=$1",
        [
          job.payload.reportId,
          job.kind === "QUANTITY_ANALYZE"
            ? failure.message
            : importFailureMessage(failure),
          json({ phase: "FAILED", remainingSeconds: null }),
        ],
      );
    if (job.kind === "PRODUCT_AI_ENRICH")
      await db.query(
        "UPDATE product_enrichment_jobs SET status='FAILED',error='AI research failed. Check configuration and worker logs.',updated_at=now() WHERE id=$1 AND status IN ('PENDING','RUNNING')",
        [job.payload.enrichmentJobId],
      );
  }
  return true;
}
