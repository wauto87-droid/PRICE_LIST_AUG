import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { type DB, one } from "../core/db";
import { json } from "../core/audit";
import { quotationHtml, escapeHtml } from "../pdf/template";
import { settings } from "../admin/service";
import { exportCatalog } from "./export";
const exec = promisify(execFile);

function importFailureMessage(error: Error) {
  const message = error.message || "Extraction failed";
  if (message.includes("Maximum 10,000 rows"))
    return "Import failed: the file has more than 10,000 rows. Split it into smaller files and upload again.";
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
      "SELECT * FROM jobs WHERE kind IN ('IMPORT_EXTRACT','QUOTE_PDF','CATALOG_EXPORT') AND (status='PENDING' OR (status='RUNNING' AND locked_at<now()-interval '15 minutes')) AND attempts<3 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
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
    if (job.kind === "CATALOG_EXPORT")
      await db.transaction(async (tx) => {
        await tx.query(
          "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        );
        await exportCatalog(tx, job.id, job.payload.includeCosts);
      });
    else if (job.kind === "IMPORT_EXTRACT") {
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
        ],
        { timeout: 300000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      );
      const extracted = JSON.parse(stdout);
      if (!Array.isArray(extracted.rows) || extracted.rows.length > 10000)
        throw new Error("Maximum 10,000 rows per import");
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
            }),
          ],
        );
      });
    } else if (job.kind === "QUOTE_PDF") {
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
        [
          job.payload.importId,
          importFailureMessage(failure),
        ],
      );
  }
  return true;
}
