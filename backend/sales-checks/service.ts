import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";

const permission = (actor: Actor) =>
  requirePermission(actor, "SALES_PRICE_CHECK");
const loose = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
const exact = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
const decimal = (value: unknown, label: string, positive = false) => {
  const text = String(value ?? "").trim();
  assert(/^\d+(?:\.\d+)?$/.test(text), 400, `${label} is not a valid decimal`);
  const number = new Decimal(text);
  assert(
    number.isFinite() && (!positive || number.gt(0)),
    400,
    `${label} must be ${positive ? "greater than zero" : "zero or positive"}`,
  );
  return number;
};

export async function upload(db: DB, actor: Actor, file: File) {
  permission(actor);
  const ext = path.extname(file.name).toLowerCase();
  assert(
    [".xls", ".xlsx", ".csv"].includes(ext),
    400,
    "Supported files: XLS, XLSX, CSV",
  );
  assert(
    file.size > 0 &&
      file.size <= Number(process.env.UPLOAD_MAX_MB || 20) * 1024 * 1024,
    413,
    "File exceeds upload limit",
  );
  const dir = path.resolve(
    process.env.UPLOAD_DIR || ".data/uploads",
    "sales-checks",
  );
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID(),
    target = path.join(dir, id + ext);
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), {
    flag: "wx",
    mode: 0o600,
  });
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO sales_price_reports(id,filename,file_path,status,owner_id) VALUES($1,$2,$3,'UPLOADED',$4)",
      [id, path.basename(file.name), target, actor.id],
    );
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'SALES_CHECK_EXTRACT',$2)",
      [randomUUID(), json({ reportId: id })],
    );
    await audit(
      tx,
      actor.id,
      "SALES_PRICE_CHECK_UPLOAD",
      "sales_price_reports",
      id,
    );
  });
  return { id };
}

export async function list(db: DB, actor: Actor) {
  permission(actor);
  return (
    await db.query(
      "SELECT id,filename,status,summary,error,version,created_at,updated_at FROM sales_price_reports ORDER BY created_at DESC LIMIT 100",
    )
  ).rows;
}

export async function get(
  db: DB,
  actor: Actor,
  id: string,
  page = 0,
  pageSize = 50,
  filter = "ALL",
  search = "",
) {
  permission(actor);
  const report = await one(
    db,
    "SELECT id,filename,status,mapping,columns,summary,error,version,created_at,updated_at FROM sales_price_reports WHERE id=$1",
    [id],
  );
  assert(report, 404, "Sales price check not found");
  const filterSql: Record<string, string> = {
    CHECKED: "product_id IS NOT NULL",
    NOT_MATCHED: "product_id IS NULL",
    MATCHED: "status='MATCHED'",
    UNMATCHED: "status='UNMATCHED'",
    AMBIGUOUS: "status='AMBIGUOUS'",
    INVALID: "status='INVALID'",
    DISCOUNT: "discount_percent>0",
    ZERO: "discount_percent=0",
    ABOVE_LIST: "discount_percent<0",
  };
  const condition = filterSql[filter] ?? "true";
  const args = [id, `%${search}%`, pageSize, page * pageSize];
  const rows = (
    await db.query(
      `SELECT * FROM sales_price_rows WHERE report_id=$1 AND (${condition}) AND ($2='' OR coalesce(source_part,'') ILIKE $2 OR coalesce(matched_part,'') ILIKE $2 OR coalesce(description,'') ILIKE $2) ORDER BY row_number LIMIT $3 OFFSET $4`,
      args,
    )
  ).rows;
  const count = await one(
    db,
    `SELECT count(*)::int AS total FROM sales_price_rows WHERE report_id=$1 AND (${condition}) AND ($2='' OR coalesce(source_part,'') ILIKE $2 OR coalesce(matched_part,'') ILIKE $2 OR coalesce(description,'') ILIKE $2)`,
    [id, `%${search}%`],
  );
  return {
    ...report,
    rows: rows.map((row: any) => ({
      ...row,
      item_check: row.product_id ? "Checked" : "Not matched item",
    })),
    resultCount: count?.total ?? 0,
    page,
    pageSize,
  };
}

export async function analyze(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  permission(actor);
  const data = z
    .object({
      version: z.coerce.number().int(),
      partNumber: z.string().min(1),
      salesPrice: z.string().min(1),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const report = await one(
      tx,
      "SELECT * FROM sales_price_reports WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      report && ["AWAITING_MAPPING", "READY"].includes(report.status),
      409,
      "Report is not ready for mapping",
    );
    assert(report.version === data.version, 409, "Report changed. Reload");
    for (const column of [data.partNumber, data.salesPrice])
      assert(
        report.columns.includes(column),
        400,
        `Column not found: ${column}`,
      );
    const products = (
      await tx.query(
        `SELECT p.id,p.part_number,p.normalized_part,p.description,p.version,p.active,l.list_price::text AS list_price FROM products p JOIN product_pricing pp ON pp.product_id=p.id LEFT JOIN product_selling_levels l ON l.product_id=p.id AND l.code=pp.default_level`,
      )
    ).rows;
    const aliases = (
      await tx.query("SELECT a.product_id,a.normalized FROM product_aliases a")
    ).rows;
    const byExact = new Map(products.map((p: any) => [p.normalized_part, p]));
    const byId = new Map(products.map((p: any) => [p.id, p]));
    const byAlias = new Map<string, any[]>();
    for (const a of aliases as any[])
      byAlias.set(
        a.normalized,
        [...(byAlias.get(a.normalized) || []), byId.get(a.product_id)].filter(
          Boolean,
        ),
      );
    const byLoose = new Map<string, any[]>();
    for (const p of products as any[])
      byLoose.set(loose(p.part_number), [
        ...(byLoose.get(loose(p.part_number)) || []),
        p,
      ]);
    for (const a of aliases as any[]) {
      const p = byId.get(a.product_id),
        key = loose(a.normalized);
      if (p)
        byLoose.set(key, [
          ...new Map(
            [...(byLoose.get(key) || []), p].map((x: any) => [x.id, x]),
          ).values(),
        ]);
    }
    const rows = (
      await tx.query(
        "SELECT * FROM sales_price_rows WHERE report_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    const summary: any = {
      totalRows: rows.length,
      matchedRows: 0,
      unmatchedRows: 0,
      ambiguousRows: 0,
      invalidRows: 0,
    };
    for (const row of rows as any[]) {
      const raw = row.raw,
        source = String(raw[data.partNumber] ?? "").trim();
      let candidates: any[] = [],
        matchType = "";
      const direct = byExact.get(exact(source));
      if (direct) {
        candidates = [direct];
        matchType = "EXACT";
      } else if ((byAlias.get(exact(source)) || []).length) {
        candidates = byAlias.get(exact(source))!;
        matchType = "ALIAS";
      } else {
        candidates = byLoose.get(loose(source)) || [];
        matchType = "LOOSE";
      }
      candidates = [...new Map(candidates.map((p: any) => [p.id, p])).values()];
      let status = "MATCHED",
        error: string | null = null,
        product: any = null,
        sale: Decimal | null = null;
      if (!source) {
        status = "INVALID";
        error = "Part number is blank";
      } else if (!candidates.length) {
        status = "UNMATCHED";
        error = "No catalog product matched this part number";
      } else if (candidates.length > 1) {
        status = "AMBIGUOUS";
        error =
          "More than one catalog product matches this normalized part number";
      } else {
        product = candidates[0];
        if (!product.active) {
          status = "INVALID";
          error = "Matched product is inactive";
        }
      }
      try {
        sale = decimal(raw[data.salesPrice], "Sales price");
      } catch (e) {
        status = "INVALID";
        error = (e as Error).message;
      }
      let listPrice: Decimal | null = null,
        listTotal: Decimal | null = null,
        actualTotal: Decimal | null = null,
        discount: Decimal | null = null;
      if (status === "MATCHED" && product && sale) {
        listPrice = new Decimal(product.list_price || 0);
        if (!listPrice.gt(0)) {
          status = "INVALID";
          error = "Matched product has no positive public list price";
        } else {
          listTotal = listPrice.toDecimalPlaces(2);
          actualTotal = sale.toDecimalPlaces(2);
          discount = listPrice
            .sub(sale)
            .div(listPrice)
            .mul(100)
            .toDecimalPlaces(6);
        }
      }
      summary[
        status === "MATCHED"
          ? "matchedRows"
          : status === "UNMATCHED"
            ? "unmatchedRows"
            : status === "AMBIGUOUS"
              ? "ambiguousRows"
              : "invalidRows"
      ]++;
      await tx.query(
        "UPDATE sales_price_rows SET source_part=$2,quantity=NULL,sales_price=$3,product_id=$4,product_version=$5,matched_part=$6,description=$7,list_price=$8,list_total=$9,actual_total=$10,discount_percent=$11,match_type=$12,status=$13,error=$14 WHERE id=$1",
        [
          row.id,
          source,
          sale?.toString() ?? null,
          product?.id ?? null,
          product?.version ?? null,
          product?.part_number ?? null,
          product?.description ?? null,
          listPrice?.toString() ?? null,
          listTotal?.toFixed(2) ?? null,
          actualTotal?.toFixed(2) ?? null,
          discount?.toString() ?? null,
          matchType || null,
          status,
          error,
        ],
      );
    }
    await tx.query(
      "UPDATE sales_price_reports SET status='READY',mapping=$2,summary=$3,version=version+1,error=NULL,updated_at=now() WHERE id=$1",
      [id, json(data), json(summary)],
    );
    await audit(
      tx,
      actor.id,
      "SALES_PRICE_CHECK_ANALYZE",
      "sales_price_reports",
      id,
      null,
      summary,
    );
    return summary;
  });
}

export async function queueExport(
  db: DB,
  actor: Actor,
  id: string,
  format: "XLSX" | "PDF",
) {
  permission(actor);
  const report = await one(
    db,
    "SELECT status FROM sales_price_reports WHERE id=$1",
    [id],
  );
  assert(report?.status === "READY", 409, "Report is not ready for export");
  const job = randomUUID();
  await db.query("INSERT INTO jobs(id,kind,payload) VALUES($1,$2,$3)", [
    job,
    `SALES_CHECK_${format}`,
    json({ reportId: id, ownerId: actor.id }),
  ]);
  await audit(
    db,
    actor.id,
    `SALES_PRICE_CHECK_${format}_EXPORT`,
    `sales_price_reports`,
    id,
  );
  return { id: job, status: "PENDING", format };
}

export async function remove(db: DB, actor: Actor, id: string) {
  permission(actor);
  const report = await one(
    db,
    "SELECT file_path FROM sales_price_reports WHERE id=$1",
    [id],
  );
  assert(report, 404, "Sales price check not found");
  const exports = (
    await db.query(
      "SELECT id,kind FROM jobs WHERE kind IN ('SALES_CHECK_XLSX','SALES_CHECK_PDF') AND payload->>'reportId'=$1",
      [id],
    )
  ).rows;
  await db.transaction(async (tx) => {
    await tx.query(
      "DELETE FROM jobs WHERE kind IN ('SALES_CHECK_EXTRACT','SALES_CHECK_XLSX','SALES_CHECK_PDF') AND payload->>'reportId'=$1",
      [id],
    );
    await tx.query("DELETE FROM sales_price_reports WHERE id=$1", [id]);
    await audit(
      tx,
      actor.id,
      "SALES_PRICE_CHECK_DELETE",
      "sales_price_reports",
      id,
    );
  });
  await fs.rm(report.file_path, { force: true });
  for (const item of exports as any[])
    await fs.rm(
      path.join(
        path.resolve(process.env.UPLOAD_DIR || ".data/uploads"),
        "sales-check-exports",
        item.id + (item.kind.endsWith("PDF") ? ".pdf" : ".xlsx"),
      ),
      { force: true },
    );
  return { ok: true };
}
