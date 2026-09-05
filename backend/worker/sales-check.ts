import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { type DB, one } from "../core/db";
import { escapeHtml } from "../pdf/template";
import { salesCheckMatchLabel, salesCheckReasonLabel, salesCheckStatusLabel } from "../../shared/sales-check-labels";

const uploadRoot = () =>
  path.resolve(process.env.UPLOAD_DIR || ".data/uploads");
const columns = [
  ["Source Row", "row_number"],
  ["Source Part", "source_part"],
  ["Matched Part", "matched_part"],
  ["Description", "description"],
  ["Sales Price (Excl. VAT)", "sales_price"],
  ["App List Price (Excl. VAT)", "list_price"],
  ["Discount %", "discount_percent"],
  ["Item Check", "item_check"],
  ["Match", "match_type"],
  ["Status", "status"],
  ["Reason", "error"],
] as const;

async function reportData(db: DB, reportId: string) {
  const report = await one(
    db,
    "SELECT r.*,u.name AS uploader FROM sales_price_reports r LEFT JOIN users u ON u.id=r.owner_id WHERE r.id=$1",
    [reportId],
  );
  if (!report) throw new Error("Sales price report missing");
  const rows = (
    await db.query(
      "SELECT * FROM sales_price_rows WHERE report_id=$1 ORDER BY row_number",
      [reportId],
    )
  ).rows;
  return { report, rows };
}

export async function exportSalesCheckXlsx(
  db: DB,
  jobId: string,
  reportId: string,
) {
  const { report, rows } = await reportData(db, reportId),
    dir = path.join(uploadRoot(), "sales-check-exports");
  await fs.mkdir(dir, { recursive: true });
  const book = new ExcelJS.Workbook();
  book.creator = "AMT Electric";
  const sheet = book.addWorksheet("Sales Price Check", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map(([header, key]) => ({
    header,
    key,
    width: key === "description" ? 44 : key === "error" ? 38 : 20,
  }));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF17324D" },
  };
  header.alignment = { vertical: "middle" };
  header.height = 24;
  for (const row of rows as any[]) {
    const values: Record<string, any> = Object.fromEntries(
      columns.map(([, key]) => [key, row[key] ?? ""]),
    );
    values.item_check = row.product_id ? "Checked" : "Not matched item";
    values.match_type = salesCheckMatchLabel(row.match_type);
    values.status = salesCheckStatusLabel(row.status);
    values.error = salesCheckReasonLabel(row.error);
    for (const key of ["sales_price", "list_price", "discount_percent"])
      if (values[key] !== "") values[key] = Number(values[key]);
    const added = sheet.addRow(values);
    for (const c of ["E", "F"]) added.getCell(c).numFmt = "#,##0.00";
    added.getCell("G").numFmt = "0.00";
    if (row.status !== "MATCHED")
      added.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: row.status === "UNMATCHED" ? "FFFFE5E5" : "FFFFF4CC" },
      };
  }
  sheet.autoFilter = { from: "A1", to: `K${Math.max(1, rows.length + 1)}` };
  const source = book.addWorksheet("Source Data", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  source.columns = [
    { header: "Source Row", key: "row", width: 14 },
    { header: "Original Source Data", key: "raw", width: 100 },
  ];
  source.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  source.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF17324D" },
  };
  for (const row of rows as any[])
    source.addRow({ row: row.row_number, raw: JSON.stringify(row.raw) });
  const summary = book.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 22 }];
  summary.addRows([
    ["Sales Price Check", report.filename],
    ["Uploaded by", report.uploader ?? ""],
    ["Created", report.created_at],
    ["Total rows", report.summary.totalRows],
    ["Matched", report.summary.matchedRows],
    ["Unmatched", report.summary.unmatchedRows],
    ["Ambiguous", report.summary.ambiguousRows],
    ["Invalid", report.summary.invalidRows],
  ]);
  summary.getCell("B3").numFmt = "yyyy-mm-dd hh:mm";
  summary.getRow(1).font = { bold: true };
  await book.xlsx.writeFile(path.join(dir, jobId + ".xlsx"));
}

export async function salesCheckHtml(db: DB, reportId: string) {
  const { report, rows } = await reportData(db, reportId),
    s = report.summary;
  const headers = [
    "#",
    "Source part",
    "Matched part",
    "Description",
    "Sales",
    "List",
    "Discount %",
    "Item Check",
    "Status / reason",
  ];
  const display = (value: unknown) =>
    value === null || value === undefined || value === ""
      ? ""
      : Number(value).toFixed(2);
  const body = rows
    .map(
      (r: any) =>
        `<tr class="${r.status === "UNMATCHED" ? "bad" : r.status !== "MATCHED" ? "warn" : ""}"><td>${r.row_number}</td><td>${escapeHtml(r.source_part || "")}</td><td>${escapeHtml(r.matched_part || "")}</td><td>${escapeHtml(r.description || "")}</td><td class="num">${display(r.sales_price)}</td><td class="num">${display(r.list_price)}</td><td class="num">${display(r.discount_percent)}</td><td>${r.product_id ? "Checked" : "Not matched item"}</td><td>${escapeHtml(salesCheckStatusLabel(r.status))}${r.error ? ` - ${escapeHtml(salesCheckReasonLabel(r.error))}` : ""}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:14mm 10mm}body{font:10px Arial;color:#172638}h1{font-size:20px;margin:0 0 4px}.meta{color:#68788a;margin-bottom:12px}.stats{display:flex;gap:8px;margin:10px 0}.stat{border:1px solid #d7dee7;border-radius:6px;padding:7px 10px;min-width:90px}.stat b{display:block;font-size:15px}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#17324d;color:white;padding:6px 4px}td{border-bottom:1px solid #dfe5ec;padding:5px 4px;word-break:break-word}tr.bad{background:#fff0f0}tr.warn{background:#fff8dc}.num{text-align:right}</style></head><body><h1>Sales Price Check</h1><div class="meta">${escapeHtml(report.filename)} | ${escapeHtml(report.uploader || "")} | ${escapeHtml(new Date(report.created_at).toLocaleString("en-GB"))}</div><div class="stats"><div class="stat">Rows<b>${s.totalRows}</b></div><div class="stat">Matched<b>${s.matchedRows}</b></div><div class="stat">Unmatched<b>${s.unmatchedRows}</b></div><div class="stat">Ambiguous<b>${s.ambiguousRows}</b></div><div class="stat">Invalid<b>${s.invalidRows}</b></div></div><table><thead><tr>${headers.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}
