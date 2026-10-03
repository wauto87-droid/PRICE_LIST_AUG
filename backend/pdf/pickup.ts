import { z } from "zod";
import { DB, one } from "../core/db";
import { check } from "../integrations/core";
import { hash } from "../integrations/job-protocol";
import { quotationHtml, escapeHtml as e } from "./template";
import fs from "node:fs/promises";
import path from "node:path";

const line = z.object({
  lineId: z.string(),
  name: z.string().max(10000),
  partNumber: z.string().max(500),
  specifications: z.string().max(10000).default(""),
  unit: z.string().min(1),
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .refine((v) => Number(v) > 0),
  collected: z.string(),
  outstanding: z.string(),
  accountingCode: z.string(),
  supplier: z.string().max(500),
  staff: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      taskId: z.string(),
      due: z.string(),
      nextAction: z.string(),
      done: z.boolean(),
      blocker: z.string(),
    }),
  ),
  cost: z.string().optional(),
  currency: z.string().optional(),
  taxBasis: z.string().optional(),
});
export const pickupInput = z.object({
  documentId: z.string().uuid(),
  workflow: z.string().min(1),
  number: z.string(),
  customer: z.string().default(""),
  staff: z.string().default(""),
  supplier: z.string().default(""),
  internal: z.boolean(),
  order: z.object({
    id: z.string().uuid(),
    number: z.string().regex(/^CO-\d+$/),
    mode: z.enum(["ORDER_CONFIRMED", "EARLY_AUTHORIZED"]),
    poNumber: z.string(),
    revision: z.number().int().positive(),
    createdAt: z.string(),
    lines: z.array(line).min(1).max(200),
  }),
});
export function pickupHtml(
  input: z.infer<typeof pickupInput>,
  settings: any,
  logo: string,
) {
  const fake = {
    number: input.order.number,
    status: "ISSUED",
    created_at: input.order.createdAt,
    customer: {},
    lines: [],
    totals: { subtotal: "0", vat: "0", total: "0" },
  };
  const shell = quotationHtml(fake, settings, logo);
  const header = shell
    .slice(0, shell.indexOf("<section>"))
    .replace("QUOTATION / عرض سعر", "PICKUP LIST / قائمة الاستلام")
    .replace(/<small class="validity">[\s\S]*?<\/small>/, "");
  const kind = input.internal
    ? "Internal staff copy / نسخة داخلية"
    : "Supplier copy / نسخة المورد";
  const details = `<section><div><strong>${e(kind)}</strong><br>Workflow / المتابعة: ${e(input.workflow)}<br>Quotation / عرض السعر: ${e(input.number)}<br>PO / أمر العميل: ${e(input.order.poNumber || "Not supplied")}<br>${input.internal ? `Customer / العميل: ${e(input.customer)}` : ""}</div><div>${input.order.mode === "EARLY_AUTHORIZED" ? "EARLY COLLECTION AUTHORIZED — CUSTOMER ORDER NOT CONFIRMED / استلام مبكر مصرح — طلب العميل غير مؤكد" : "Customer order confirmed / طلب العميل مؤكد"}</div></section>`;
  const rows = input.order.lines
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${e(l.supplier || "Supplier pending")}<small>${e(l.staff.map((s) => s.name).join(", "))}</small></td><td>${e(l.partNumber)}<small>${e(l.accountingCode)}</small></td><td>${e(l.name)}<small>${e(l.specifications)}</small></td><td>${e(l.quantity)} ${e(l.unit)}<small>Remaining: ${e(l.outstanding)}</small></td>${input.internal ? `<td>${l.cost ? `${e(l.currency)} ${e(l.cost)}/${e(l.unit)}<small>${e(l.taxBasis)}</small>` : "Cost pending"}</td>` : ""}<td>${e(l.staff.map((s) => s.nextAction).join("; "))}<small>${e(l.staff.map((s) => (s.due ? new Date(s.due).toLocaleString("en-GB", { timeZone: settings.workflowTimezone || "Asia/Riyadh" }) : "Date not confirmed")).join("; "))}</small></td></tr>`,
    )
    .join("");
  return (
    header.replace(
      "</style>",
      "td:first-child,th:first-child{white-space:nowrap;min-width:20px}section>div{min-width:0;overflow-wrap:anywhere}</style>",
    ) +
    details +
    `<table><thead><tr><th>#</th><th>Shop / Staff</th><th>Part / Code</th><th>Product / Specifications</th><th>Quantity</th>${input.internal ? "<th>Cost price / سعر التكلفة</th>" : ""}<th>Instructions</th></tr></thead><tbody>${rows}</tbody></table><footer>${e(settings.quotation?.footer || "")}<br>Pickup instructions only — not proof of collection, customer acceptance or accounting posting. / تعليمات استلام فقط — ليست إثبات استلام أو فاتورة</footer></main></body></html>`
  );
}
export async function pickupPdf(db: DB, raw: unknown) {
  const input = pickupInput.parse(raw);
  check(input.internal || !!input.supplier, "Select one supplier");
  // Supplier-safe snapshots never store internal costs or customer contacts.
  if (!input.internal) {
    input.customer = "";
    for (const l of input.order.lines) {
      delete l.cost;
      delete l.currency;
      delete l.taxBasis;
    }
  }
  await db.query(
    `CREATE TABLE IF NOT EXISTS sw_pickup_sheets(id text PRIMARY KEY,document_id text NOT NULL,order_id text NOT NULL,number text NOT NULL,revision integer NOT NULL,hash text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(number,revision))`,
  );
  const settings = (await one(db, "SELECT data FROM settings WHERE id=1"))!
    .data;
  const key = hash([
    input.order.id,
    input.staff,
    input.supplier,
    input.internal,
  ]);
  const frozen = {
    ...input,
    branding: settings.brandingAssets || {},
    companyName: settings.companyName,
    companyArabic: settings.companyArabic,
    quotation: settings.quotation || {},
    workflowTimezone: settings.workflowTimezone || "Asia/Riyadh",
    pdfUnitPrices: settings.pdfUnitPrices,
  };
  const fingerprint = hash(frozen);
  const saved = await db.transaction(async (tx) => {
    await tx.query("SELECT id FROM sw_job_documents WHERE id=$1 FOR UPDATE", [
      input.documentId,
    ]);
    check(
      await one(tx, "SELECT id FROM sw_job_documents WHERE id=$1", [
        input.documentId,
      ]),
      "Linked document missing",
      404,
    );
    const latest = await one(
      tx,
      "SELECT * FROM sw_pickup_sheets WHERE id LIKE $1 ORDER BY revision DESC LIMIT 1",
      [key + ":%"],
    );
    if (latest?.hash === fingerprint) return latest;
    const count = await one(
      tx,
      "SELECT count(DISTINCT number) n FROM sw_pickup_sheets WHERE order_id=$1",
      [input.order.id],
    );
    const number =
      latest?.number ||
      `${input.order.number}-P${String(Number(count?.n || 0) + 1).padStart(2, "0")}`;
    const revision = (latest?.revision || 0) + 1;
    const record = {
      id: `${key}:${revision}`,
      number,
      revision,
      hash: fingerprint,
      snapshot: frozen,
    };
    await tx.query(
      "INSERT INTO sw_pickup_sheets(id,document_id,order_id,number,revision,hash,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [
        record.id,
        input.documentId,
        input.order.id,
        number,
        revision,
        fingerprint,
        JSON.stringify(frozen),
      ],
    );
    return record;
  });
  const directory = path.resolve(
    process.env.UPLOAD_DIR || ".data/uploads",
    "pickup-pdfs",
  );
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, saved.id + ".pdf");
  let pdf: Buffer;
  try {
    pdf = await fs.readFile(file);
  } catch (error) {
    if ((error as any).code !== "ENOENT") throw error;
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      args: ["--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      const snap = saved.snapshot as any;
      const logo =
        snap.branding?.logo ||
        "data:image/svg+xml;base64," +
          Buffer.from(
            await fs.readFile(path.join(process.cwd(), "public/logo.svg")),
          ).toString("base64");
      const html = pickupHtml(
        snap,
        { ...snap, brandingAssets: snap.branding },
        logo,
      ).replace(
        "</header>",
        `<small>${e(saved.number)} · Revision ${saved.revision}</small></header>`,
      );
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      pdf = await page.pdf({ format: "A4", printBackground: true });
      await fs.writeFile(file, pdf, { mode: 0o600 });
    } finally {
      await browser.close();
    }
  }
  return {
    pdf: pdf.toString("base64"),
    filename: `${saved.number}-R${saved.revision}.pdf`,
    number: saved.number,
    revision: saved.revision,
  };
}
