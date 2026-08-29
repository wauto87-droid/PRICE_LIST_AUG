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
      "SELECT id,filename,status,summary,progress,error,version,created_at,updated_at FROM sales_price_reports ORDER BY created_at DESC LIMIT 100",
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
    "SELECT id,filename,status,mapping,columns,summary,progress,error,version,created_at,updated_at FROM sales_price_reports WHERE id=$1",
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
      report && ["AWAITING_MAPPING", "READY", "FAILED"].includes(report.status),
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
    const active = await one(
      tx,
      "SELECT id FROM jobs WHERE kind='SALES_CHECK_ANALYZE' AND payload->>'reportId'=$1 AND status IN ('PENDING','RUNNING')",
      [id],
    );
    assert(!active, 409, "This report is already being checked");
    const jobId = randomUUID();
    const totalRows = Number(
      (
        await one(
          tx,
          "SELECT count(*)::int AS total FROM sales_price_rows WHERE report_id=$1",
          [id],
        )
      )?.total || 0,
    );
    const progress = {
      phase: "PREPARING",
      processedRows: 0,
      totalRows,
      percentage: 0,
      startedAt: new Date().toISOString(),
      remainingSeconds: null,
    };
    await tx.query(
      "UPDATE sales_price_reports SET status='PROCESSING',mapping=$2,progress=$3,error=NULL,updated_at=now() WHERE id=$1",
      [id, json(data), json(progress)],
    );
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'SALES_CHECK_ANALYZE',$2)",
      [
        jobId,
        json({
          reportId: id,
          actorId: actor.id,
          version: data.version,
          mapping: data,
        }),
      ],
    );
    return { id: jobId, reportId: id, status: "PENDING", progress };
  });
}

export async function processAnalysis(
  db: DB,
  reportId: string,
  actorId: string,
) {
  const report = await one(
    db,
    "SELECT * FROM sales_price_reports WHERE id=$1",
    [reportId],
  );
  assert(
    report?.status === "PROCESSING",
    409,
    "Report is not ready for processing",
  );
  const data = z
    .object({
      version: z.coerce.number().int(),
      partNumber: z.string().min(1),
      salesPrice: z.string().min(1),
    })
    .passthrough()
    .parse(report.mapping);
  const tx = db;
  try {
    await tx.query(
      "UPDATE sales_price_reports SET progress=progress||$2::jsonb,updated_at=now() WHERE id=$1",
      [reportId, json({ phase: "PREPARING" })],
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
        [reportId],
      )
    ).rows;
    const summary: any = {
      totalRows: rows.length,
      matchedRows: 0,
      unmatchedRows: 0,
      ambiguousRows: 0,
      invalidRows: 0,
    };
    const batchSize = Math.max(
      100,
      Number(process.env.SALES_CHECK_BATCH_SIZE || 500),
    );
    const started = Date.now();
    await tx.query(
      "UPDATE sales_price_reports SET progress=progress||$2::jsonb,updated_at=now() WHERE id=$1",
      [reportId, json({ phase: "CHECKING" })],
    );
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize) as any[];
      await db.transaction(async (batchTx) => {
        const updates: any[] = [];
        for (const row of batch) {
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
          candidates = [
            ...new Map(candidates.map((p: any) => [p.id, p])).values(),
          ];
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
          updates.push({
            id: row.id,
            source_part: source,
            sales_price: sale?.toString() ?? null,
            product_id: product?.id ?? null,
            product_version: product?.version ?? null,
            matched_part: product?.part_number ?? null,
            description: product?.description ?? null,
            list_price: listPrice?.toString() ?? null,
            list_total: listTotal?.toFixed(2) ?? null,
            actual_total: actualTotal?.toFixed(2) ?? null,
            discount_percent: discount?.toString() ?? null,
            match_type: matchType || null,
            status,
            error,
          });
        }
        await batchTx.query(
          `UPDATE sales_price_rows r SET source_part=x.source_part,quantity=NULL,sales_price=x.sales_price,product_id=x.product_id,product_version=x.product_version,matched_part=x.matched_part,description=x.description,list_price=x.list_price,list_total=x.list_total,actual_total=x.actual_total,discount_percent=x.discount_percent,match_type=x.match_type,status=x.status,error=x.error FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,source_part text,sales_price numeric,product_id uuid,product_version integer,matched_part text,description text,list_price numeric,list_total numeric,actual_total numeric,discount_percent numeric,match_type text,status text,error text) WHERE r.id=x.id`,
          [json(updates)],
        );
      });
      const processedRows = Math.min(offset + batch.length, rows.length);
      const elapsedSeconds = Math.max((Date.now() - started) / 1000, 0.001);
      const remainingSeconds = processedRows
        ? Math.max(
            0,
            Math.round(
              ((rows.length - processedRows) * elapsedSeconds) / processedRows,
            ),
          )
        : null;
      await tx.query(
        "UPDATE sales_price_reports SET progress=progress||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          reportId,
          json({
            phase: "CHECKING",
            processedRows,
            totalRows: rows.length,
            percentage: rows.length
              ? Math.min(98, Math.round((processedRows / rows.length) * 98))
              : 98,
            remainingSeconds,
          }),
        ],
      );
    }
    await tx.query(
      "UPDATE sales_price_reports SET progress=progress||$2::jsonb,updated_at=now() WHERE id=$1",
      [
        reportId,
        json({
          phase: "FINALIZING",
          processedRows: rows.length,
          totalRows: rows.length,
          percentage: 99,
          remainingSeconds: null,
        }),
      ],
    );
    await tx.query(
      "UPDATE sales_price_reports SET status='READY',mapping=$2,summary=$3,progress=$4,version=version+1,error=NULL,updated_at=now() WHERE id=$1",
      [
        reportId,
        json(data),
        json(summary),
        json({
          phase: "COMPLETE",
          processedRows: rows.length,
          totalRows: rows.length,
          percentage: 100,
          startedAt:
            report.progress?.startedAt || new Date(started).toISOString(),
          remainingSeconds: 0,
        }),
      ],
    );
    await audit(
      tx,
      actorId,
      "SALES_PRICE_CHECK_ANALYZE",
      "sales_price_reports",
      reportId,
      null,
      summary,
    );
    return summary;
  } catch (error) {
    await db.query(
      "UPDATE sales_price_reports SET status='FAILED',error=$2,progress=progress||$3::jsonb,updated_at=now() WHERE id=$1",
      [
        reportId,
        (error as Error).message,
        json({ phase: "FAILED", remainingSeconds: null }),
      ],
    );
    throw error;
  }
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
      "DELETE FROM jobs WHERE kind IN ('SALES_CHECK_EXTRACT','SALES_CHECK_ANALYZE','SALES_CHECK_XLSX','SALES_CHECK_PDF') AND payload->>'reportId'=$1",
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
