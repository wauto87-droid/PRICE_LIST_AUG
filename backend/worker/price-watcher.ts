import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { type DB } from "../core/db";
import { type Actor } from "../auth/service";
import { dashboard } from "../price-watcher/service";
import { escapeHtml } from "../pdf/template";

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
  const groups = [...first.groups];
  for (let page = 1; page < first.totalPages; page++)
    groups.push(
      ...(await dashboard(db, actor, { ...filters, page, pageSize: 100 }))
        .groups,
    );
  return { ...first, groups };
}
export async function exportPriceWatcherXlsx(
  db: DB,
  jobId: string,
  actor: Actor,
  filters: any,
) {
  const report: any = await data(db, actor, filters);
  await fs.mkdir(dir(), { recursive: true });
  const book = new ExcelJS.Workbook();
  book.creator = "AMT Electric";
  const summary = book.addWorksheet("Summary");
  summary.addRows([
    ["Price Watcher"],
    ["Warning", "Pricing activity is not confirmed sales or collected revenue"],
    ["Events", report.summary.events],
    ["Quotations", report.summary.quotations],
    ["Customers", report.summary.customers],
    ["Quantity", Number(report.summary.quantity)],
    ["Activity value excl. VAT", Number(report.summary.subtotal)],
    ["Weighted discount %", Number(report.summary.weighted_discount)],
    ["Quotation round-off", Number(report.summary.quote_round_off)],
  ]);
  const sheet = book.addWorksheet("Item Staff Analysis", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = [
    { header: "Part / Reference", key: "part_number", width: 24 },
    { header: "Description", key: "description", width: 42 },
    { header: "Source", key: "source", width: 12 },
    { header: "Staff", key: "staff_name", width: 22 },
    { header: "Events", key: "events", width: 10 },
    { header: "Quotations", key: "quotations", width: 12 },
    { header: "Customers", key: "customers", width: 11 },
    { header: "Quantity", key: "quantity", width: 13 },
    { header: "Weighted Avg", key: "weighted_average", width: 15 },
    { header: "Simple Avg", key: "simple_average", width: 14 },
    { header: "Median", key: "median", width: 12 },
    { header: "Minimum", key: "minimum", width: 12 },
    { header: "Maximum", key: "maximum", width: 12 },
    { header: "Latest", key: "latest", width: 12 },
    { header: "Weighted Discount %", key: "weighted_discount", width: 19 },
    { header: "Zero/100% Flags", key: "zero_price_events", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF17324D" },
  };
  for (const row of report.groups)
    sheet.addRow({
      ...row,
      ...Object.fromEntries(
        [
          "quantity",
          "weighted_average",
          "simple_average",
          "median",
          "minimum",
          "maximum",
          "latest",
          "weighted_discount",
        ].map((k) => [k, Number(row[k] || 0)]),
      ),
    });
  sheet.autoFilter = {
    from: "A1",
    to: `P${Math.max(1, report.groups.length + 1)}`,
  };
  await book.xlsx.writeFile(path.join(dir(), jobId + ".xlsx"));
}
export async function priceWatcherHtml(db: DB, actor: Actor, filters: any) {
  const r: any = await data(db, actor, filters);
  const rows = r.groups
    .map(
      (x: any) =>
        `<tr class="${x.zero_price_events > 0 ? "flag" : ""}"><td>${escapeHtml(x.part_number || "Custom")}</td><td>${escapeHtml(x.description)}</td><td>${escapeHtml(x.staff_name)}</td><td>${x.events}</td><td>${Number(x.quantity).toFixed(2)}</td><td>${Number(x.weighted_average).toFixed(2)}</td><td>${Number(x.median).toFixed(2)}</td><td>${Number(x.minimum).toFixed(2)} / ${Number(x.maximum).toFixed(2)}</td><td>${Number(x.weighted_discount).toFixed(2)}%</td></tr>`,
    )
    .join("");
  return `<!doctype html><style>body{font:10px Arial;color:#172033}h1{font-size:20px}.warn{padding:8px;background:#fff3cd}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3dc;padding:5px;text-align:left}th{background:#17324d;color:white}.flag{background:#ffe5e5}</style><h1>AMT Price Watcher</h1><p class="warn">Pricing activity analysis — lookup and quotation activity is not confirmed sales or collected revenue.</p><p>Events: ${r.summary.events} · Quantity: ${r.summary.quantity} · Value excl. VAT: SAR ${Number(r.summary.subtotal).toFixed(2)} · Weighted discount: ${Number(r.summary.weighted_discount).toFixed(2)}%</p><table><thead><tr><th>Item</th><th>Description</th><th>Staff</th><th>Events</th><th>Qty</th><th>Weighted avg.</th><th>Median</th><th>Min / Max</th><th>Discount</th></tr></thead><tbody>${rows}</tbody></table>`;
}
export const priceWatcherOutputDir = dir;
