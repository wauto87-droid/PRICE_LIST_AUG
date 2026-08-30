import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { type DB, one } from "../core/db";
import { escapeHtml } from "../pdf/template";

const outputDir = () =>
  path.join(
    path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
    "quantity-finder-exports",
  );

async function data(db: DB, reportId: string) {
  const report = await one(
    db,
    "SELECT r.*,u.name uploader FROM quantity_reports r LEFT JOIN users u ON u.id=r.owner_id WHERE r.id=$1",
    [reportId],
  );
  if (!report) throw new Error("Quantity report missing");
  const groups = (
    await db.query(
      "SELECT * FROM quantity_report_groups WHERE report_id=$1 ORDER BY first_row,source_part",
      [reportId],
    )
  ).rows;
  const invalid = (
    await db.query(
      "SELECT * FROM quantity_report_rows WHERE report_id=$1 AND status='INVALID' ORDER BY row_number",
      [reportId],
    )
  ).rows;
  return { report, groups, invalid };
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF17324D" },
  };
}

export async function exportQuantityXlsx(
  db: DB,
  jobId: string,
  reportId: string,
) {
  const { report, groups, invalid } = await data(db, reportId);
  await fs.mkdir(outputDir(), { recursive: true });
  const book = new ExcelJS.Workbook();
  book.creator = "AMT Electric";
  const summary = book.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 28 }];
  summary.addRows([
    ["Quantity Finder", report.filename],
    ["Uploaded by", report.uploader || ""],
    ["Created", report.created_at],
    ["Source rows", report.summary.totalRows || 0],
    ["Valid rows", report.summary.validRows || 0],
    ["Invalid rows", report.summary.invalidRows || 0],
    ["Exact part groups", report.summary.groupCount || 0],
    ["Sold quantity", Number(report.summary.soldQuantity || 0)],
    ["Returned quantity", Number(report.summary.returnedQuantity || 0)],
    ["Net quantity", Number(report.summary.netQuantity || 0)],
  ]);
  summary.getRow(1).font = { bold: true };
  for (const n of [8, 9, 10]) summary.getCell(`B${n}`).numFmt = "0.######";
  const grouped = book.addWorksheet("Grouped Results", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  grouped.columns = [
    {
      header: "Part Number (exact source text)",
      key: "source_part",
      width: 38,
    },
    { header: "Sold Quantity", key: "sold_quantity", width: 18 },
    { header: "Returned Quantity", key: "returned_quantity", width: 20 },
    { header: "Net Quantity", key: "net_quantity", width: 18 },
    { header: "Occurrences", key: "occurrences", width: 14 },
    { header: "First Source Row", key: "first_row", width: 18 },
  ];
  styleHeader(grouped.getRow(1));
  for (const group of groups as any[]) {
    const row = grouped.addRow({
      ...group,
      sold_quantity: Number(group.sold_quantity),
      returned_quantity: Number(group.returned_quantity),
      net_quantity: Number(group.net_quantity),
    });
    for (const cell of [2, 3, 4]) row.getCell(cell).numFmt = "0.######";
  }
  grouped.autoFilter = { from: "A1", to: `F${Math.max(1, groups.length + 1)}` };
  const bad = book.addWorksheet("Invalid Rows", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  bad.columns = [
    { header: "Source Row", key: "row_number", width: 14 },
    { header: "Part Number", key: "source_part", width: 36 },
    { header: "Raw Quantity", key: "raw_quantity", width: 20 },
    { header: "Reason", key: "error", width: 48 },
    { header: "Original Row", key: "raw", width: 80 },
  ];
  styleHeader(bad.getRow(1));
  for (const row of invalid as any[])
    bad.addRow({
      ...row,
      raw_quantity: report.mapping?.quantity
        ? (row.raw?.[report.mapping.quantity] ?? "")
        : "",
      raw: JSON.stringify(row.raw),
    });
  bad.autoFilter = { from: "A1", to: `E${Math.max(1, invalid.length + 1)}` };
  await book.xlsx.writeFile(path.join(outputDir(), `${jobId}.xlsx`));
}

export async function quantityHtml(db: DB, reportId: string) {
  const { report, groups, invalid } = await data(db, reportId),
    s = report.summary;
  const number = (value: unknown) => escapeHtml(String(value ?? "0"));
  const groupRows = (groups as any[])
    .map(
      (g) =>
        `<tr><td>${escapeHtml(g.source_part)}</td><td class="n">${number(g.sold_quantity)}</td><td class="n">${number(g.returned_quantity)}</td><td class="n">${number(g.net_quantity)}</td><td class="n">${g.occurrences}</td></tr>`,
    )
    .join("");
  const invalidRows = (invalid as any[])
    .map(
      (r) =>
        `<tr><td>${r.row_number}</td><td>${escapeHtml(r.source_part || "")}</td><td>${escapeHtml(report.mapping?.quantity ? String(r.raw?.[report.mapping.quantity] ?? "") : "")}</td><td>${escapeHtml(r.error || "")}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:14mm 10mm}body{font:10px Arial;color:#172638}h1{font-size:20px;margin:0}.meta{color:#68788a;margin:4px 0 12px}.stats{display:flex;gap:7px;margin:10px 0}.stat{border:1px solid #d7dee7;padding:6px 9px;border-radius:5px}.stat b{display:block;font-size:14px}h2{font-size:14px;margin-top:16px;page-break-after:avoid}table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{background:#17324d;color:white;padding:6px;text-align:left}td{border-bottom:1px solid #dfe5ec;padding:5px;word-break:break-word}.n{text-align:right}</style></head><body><h1>Quantity Finder / تجميع الكميات</h1><div class="meta">${escapeHtml(report.filename)} | ${escapeHtml(report.uploader || "")} | ${escapeHtml(new Date(report.created_at).toLocaleString("en-GB"))}</div><div class="stats"><div class="stat">Rows<b>${s.totalRows || 0}</b></div><div class="stat">Groups<b>${s.groupCount || 0}</b></div><div class="stat">Sold<b>${number(s.soldQuantity)}</b></div><div class="stat">Returned<b>${number(s.returnedQuantity)}</b></div><div class="stat">Net<b>${number(s.netQuantity)}</b></div><div class="stat">Invalid<b>${s.invalidRows || 0}</b></div></div><h2>Grouped results</h2><table><thead><tr><th>Part Number (exact)</th><th>Sold</th><th>Returned</th><th>Net</th><th>Occurrences</th></tr></thead><tbody>${groupRows}</tbody></table>${invalid.length ? `<h2>Invalid rows</h2><table><thead><tr><th>Row</th><th>Part Number</th><th>Raw Quantity</th><th>Reason</th></tr></thead><tbody>${invalidRows}</tbody></table>` : ""}</body></html>`;
}
