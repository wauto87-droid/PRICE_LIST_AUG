import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { type DB } from "../core/db";
import { type Actor } from "../auth/service";
import { dashboard } from "../price-watcher/service";
import { escapeHtml } from "../pdf/template";
import {
  activityColumns,
  groupColumns,
  staffColumns,
  watchValue,
  type WatchColumn,
} from "../../shared/price-watch";
const dir = () =>
  path.join(
    path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
    "price-watcher-exports",
  );
async function data(db: DB, actor: Actor, filters: any) {
  const first: any = await dashboard(db, actor, {
    ...filters,
    page: 0,
    pageSize: 100,
  });
  const key = first.view === "GROUPS" ? "groups" : "items";
  const rows = [...first[key]];
  for (let page = 1; page < first.totalPages; page++)
    rows.push(
      ...((await dashboard(db, actor, { ...filters, page, pageSize: 100 }))[
        key
      ] ?? []),
    );
  return {
    ...first,
    rows,
    columns: first.view === "GROUPS" ? groupColumns : activityColumns,
  };
}
export async function exportPriceWatcherXlsx(
  db: DB,
  jobId: string,
  actor: Actor,
  filters: any,
) {
  const report = await data(db, actor, filters);
  await fs.mkdir(dir(), { recursive: true });
  const book = new ExcelJS.Workbook();
  book.creator = "AMT Electric";
  const summary = book.addWorksheet("Summary");
  summary.addRows([
    ["Price Watcher"],
    ["Warning", "Pricing activity is not confirmed sales or collected revenue"],
    ["Summary interactions", report.summary.events],
    ["Activity rows", report.total],
    ["Quotations", report.summary.quotations],
    ["Quantity", Number(report.summary.quantity)],
    ["Activity value excl. VAT", Number(report.summary.subtotal)],
    ["Weighted discount %", Number(report.summary.weighted_discount)],
    ["Quotation round-off", Number(report.summary.quote_round_off)],
    ["Time zone", "Asia/Riyadh"],
    ["Filters", JSON.stringify(filters)],
    [
      "Coverage",
      "Summary totals count lifecycle interactions; activity rows include calculation snapshots. Earlier overwritten lookups cannot be reconstructed.",
    ],
  ]);
  function sheet(name: string, columns: WatchColumn[], rows: any[]) {
    const s = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    s.columns = columns.map((c) => ({
      header: c.en,
      key: c.key,
      width: c.key === "description" ? 42 : 24,
    }));
    s.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    s.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF17324D" },
    };
    for (const r of rows)
      s.addRow(
        Object.fromEntries(
          columns.map((c) => [
            c.key,
            c.kind === "number" || c.kind === "percent"
              ? Number(r[c.key] ?? 0)
              : watchValue(r[c.key], c.kind),
          ]),
        ),
      );
    for (const c of columns)
      if (c.kind === "number" || c.kind === "percent")
        s.getColumn(c.key).numFmt = "#,##0.00";
    s.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: columns.length },
    };
  }
  sheet(
    report.view === "GROUPS" ? "Item Staff Analysis" : "Individual Activity",
    report.columns,
    report.rows,
  );
  sheet("Staff overview", staffColumns, report.staff);
  await book.xlsx.writeFile(path.join(dir(), jobId + ".xlsx"));
}
export async function priceWatcherHtml(db: DB, actor: Actor, filters: any) {
  const r = await data(db, actor, filters);
  const table = (columns: WatchColumn[], rows: any[]) =>
    "<table><thead><tr>" +
    columns.map((c) => "<th>" + escapeHtml(c.en) + "</th>").join("") +
    "</tr></thead><tbody>" +
    rows
      .map(
        (row) =>
          "<tr>" +
          columns
            .map(
              (c) =>
                "<td>" + escapeHtml(watchValue(row[c.key], c.kind)) + "</td>",
            )
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table>";
  return (
    '<!doctype html><meta charset="utf-8"><style>@page{size:A3 landscape}body{font:10px Arial;color:#172033}h1{font-size:20px}.warn{padding:8px;background:#fff3cd}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #ccd3dc;padding:4px;text-align:left;overflow-wrap:anywhere}th{background:#17324d;color:white}</style><h1>AMT Price Watcher</h1><p class="warn">Pricing activity analysis — lookup and quotation activity is not confirmed sales or collected revenue.</p><p>Time zone: Asia/Riyadh. Summary totals count lifecycle interactions; activity rows include calculation snapshots. Earlier overwritten lookups cannot be reconstructed.</p><p>Summary interactions: ' +
    r.summary.events +
    " · Activity rows: " +
    r.total +
    " · Quantity: " +
    r.summary.quantity +
    " · Activity value excl. VAT: SAR " +
    Number(r.summary.subtotal).toFixed(2) +
    " · Weighted discount: " +
    Number(r.summary.weighted_discount).toFixed(2) +
    "%</p><p>Filters: " +
    escapeHtml(JSON.stringify(filters)) +
    "</p><h2>" +
    (r.view === "GROUPS"
      ? "Item and staff comparison"
      : "Individual activity") +
    "</h2>" +
    table(r.columns, r.rows) +
    "<h2>Staff overview</h2>" +
    table(staffColumns, r.staff)
  );
}
export const priceWatcherOutputDir = dir;
