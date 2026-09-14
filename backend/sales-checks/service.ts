import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";
import { normalizePart } from "../pricing/engine";

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
  const text = String(value ?? "").replace(/[,\s]/g, "");
  assert(/^-?\d+(?:\.\d+)?$/.test(text), 400, `${label} is not a valid decimal`);
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
  minDiscount = "",
  sort = "ROW_ASC",
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
  const sortSql: Record<string, string> = {
    ROW_ASC: "row_number ASC",
    DISCOUNT_DESC: "discount_percent DESC NULLS LAST, row_number ASC",
    DISCOUNT_ASC: "discount_percent ASC NULLS LAST, row_number ASC",
    SALES_PRICE_DESC: "sales_price DESC NULLS LAST, row_number ASC",
    SALES_PRICE_ASC: "sales_price ASC NULLS LAST, row_number ASC",
    LIST_PRICE_DESC: "list_price DESC NULLS LAST, row_number ASC",
    LIST_PRICE_ASC: "list_price ASC NULLS LAST, row_number ASC",
  };
  const discount =
    minDiscount.trim() === "" ? null : decimal(minDiscount, "Minimum discount");
  const condition = filterSql[filter] ?? "true";
  const orderBy = sortSql[sort] ?? sortSql.ROW_ASC;
  const args = [
    id,
    `%${search}%`,
    discount?.toString() ?? null,
    pageSize,
    page * pageSize,
  ];
  const rows = (
    await db.query(
      `SELECT * FROM sales_price_rows WHERE report_id=$1 AND (${condition}) AND ($2='' OR coalesce(source_part,'') ILIKE $2 OR coalesce(matched_part,'') ILIKE $2 OR coalesce(description,'') ILIKE $2) AND ($3::numeric IS NULL OR (discount_percent IS NOT NULL AND discount_percent >= $3::numeric)) ORDER BY ${orderBy} LIMIT $4 OFFSET $5`,
      args,
    )
  ).rows;
  const count = await one(
    db,
    `SELECT count(*)::int AS total FROM sales_price_rows WHERE report_id=$1 AND (${condition}) AND ($2='' OR coalesce(source_part,'') ILIKE $2 OR coalesce(matched_part,'') ILIKE $2 OR coalesce(description,'') ILIKE $2) AND ($3::numeric IS NULL OR (discount_percent IS NOT NULL AND discount_percent >= $3::numeric))`,
    [id, `%${search}%`, discount?.toString() ?? null],
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
      saleDate: z.string().optional(),
      historicalListId: z.string().uuid().optional().or(z.literal("")),
    })
    .passthrough()
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
    const requiredCols = [data.partNumber, data.salesPrice];
    if (data.saleDate) requiredCols.push(data.saleDate);
    for (const column of requiredCols)
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
      saleDate: z.string().optional(),
      historicalListId: z.string().uuid().optional().or(z.literal("")),
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
    let historicalEntries: any[] = [];
    if (data.historicalListId) {
      historicalEntries = (
        await tx.query("SELECT * FROM historical_price_entries WHERE list_id=$1", [
          data.historicalListId,
        ])
      ).rows;
    }
    const historicalByLoose = new Map<string, any[]>();
    for (const entry of historicalEntries) {
      const key = loose(entry.part_number);
      historicalByLoose.set(key, [...(historicalByLoose.get(key) || []), entry]);
    }
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
          } else if (candidates.length > 1) {
            status = "AMBIGUOUS";
            error =
              "More than one catalog product matches this normalized part number";
          } else if (candidates.length === 1) {
            product = candidates[0];
            if (!product.active) {
              status = "INVALID";
              error = "Matched product is inactive";
            }
          } else if (!data.historicalListId) {
            status = "UNMATCHED";
            error = "No catalog product matched this part number";
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
            discount: Decimal | null = null,
            matchedPart = product?.part_number ?? null,
            description = product?.description ?? null;
          if (status === "MATCHED" && sale) {
            if (data.historicalListId) {
              const hCandidates = historicalByLoose.get(loose(source)) || (product ? historicalByLoose.get(loose(product.part_number)) : []) || [];
              let matchedEntry = null;
              let sDate: Date | null = null;
              if (data.saleDate && raw[data.saleDate]) {
                  sDate = new Date(raw[data.saleDate]);
              }
              for (const entry of hCandidates) {
                let inRange = true;
                if (sDate && !isNaN(sDate.getTime())) {
                    if (entry.valid_from && new Date(entry.valid_from) > sDate) inRange = false;
                    if (entry.valid_to && new Date(entry.valid_to) < sDate) inRange = false;
                }
                if (inRange) {
                    matchedEntry = entry;
                    break;
                }
              }
              if (matchedEntry) {
                 listPrice = new Decimal(matchedEntry.price);
                 if (!product) {
                     matchedPart = matchedEntry.part_number;
                     description = "Historical list item";
                 }
              }
            }

            if (!listPrice && product && product.id) {
               listPrice = new Decimal(product.list_price || 0);
            }

            if (!listPrice || !listPrice.gt(0)) {
              if (data.historicalListId) {
                 status = "UNMATCHED";
                 error = "No valid historical price found for this part number and date";
              } else {
                 status = "INVALID";
                 error = "Matched product has no positive public list price";
              }
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
            matched_part: matchedPart,
            description: description,
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

export async function mapRow(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  permission(actor);
  const data = z
    .object({
      rowId: z.string().uuid(),
      productId: z.string().uuid(),
      scope: z.enum(["ROW", "ALL_IDENTICAL"]).default("ROW"),
      remember: z.boolean().default(true),
    })
    .strict()
    .parse(input);

  return db.transaction(async (tx) => {
    const report = await one(
      tx,
      "SELECT * FROM sales_price_reports WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(report, 404, "Sales price check not found");
    assert(report.status === "READY", 409, "Report must be in READY state to map items");

    const targetRow = await one(
      tx,
      "SELECT * FROM sales_price_rows WHERE id=$1 AND report_id=$2 FOR UPDATE",
      [data.rowId, id],
    );
    assert(targetRow, 404, "Sales price check row not found");

    const product = await one(
      tx,
      `SELECT p.id, p.part_number, p.normalized_part, p.description, p.version, p.active,
              l.list_price::text AS list_price
       FROM products p
       JOIN product_pricing pp ON pp.product_id=p.id
       LEFT JOIN product_selling_levels l ON l.product_id=p.id AND l.code=pp.default_level
       WHERE p.id=$1`,
      [data.productId],
    );
    assert(product, 404, "Catalog product not found");
    assert(product.active, 400, "Selected product is inactive");

    let listPriceNum: Decimal | null = null;
    if (report.mapping?.historicalListId) {
      const hEntries = (
        await tx.query(
          "SELECT * FROM historical_price_entries WHERE list_id=$1 AND part_number ILIKE $2",
          [report.mapping.historicalListId, product.part_number],
        )
      ).rows;
      if (hEntries.length > 0) {
        listPriceNum = new Decimal(hEntries[0].price);
      }
    }

    if (!listPriceNum && product.list_price) {
      listPriceNum = new Decimal(product.list_price);
    }
    assert(
      listPriceNum && listPriceNum.gt(0),
      400,
      "Matched product has no positive public list price",
    );

    const targetRows =
      data.scope === "ALL_IDENTICAL" && targetRow.source_part
        ? (
            await tx.query(
              "SELECT * FROM sales_price_rows WHERE report_id=$1 AND source_part=$2 FOR UPDATE",
              [id, targetRow.source_part],
            )
          ).rows
        : [targetRow];

    for (const r of targetRows as any[]) {
      let sale: Decimal | null = null;
      try {
        if (r.sales_price) sale = new Decimal(r.sales_price);
      } catch {}

      let discount: Decimal | null = null;
      let listTotal: Decimal | null = null;
      let actualTotal: Decimal | null = null;
      if (sale && sale.isFinite()) {
        listTotal = listPriceNum.toDecimalPlaces(2);
        actualTotal = sale.toDecimalPlaces(2);
        discount = listPriceNum
          .sub(sale)
          .div(listPriceNum)
          .mul(100)
          .toDecimalPlaces(6);
      }

      await tx.query(
        `UPDATE sales_price_rows
         SET product_id=$2,
             product_version=$3,
             matched_part=$4,
             description=$5,
             list_price=$6,
             list_total=$7,
             actual_total=$8,
             discount_percent=$9,
             match_type='ALIAS',
             status='MATCHED',
             error=NULL
         WHERE id=$1`,
        [
          r.id,
          product.id,
          product.version,
          product.part_number,
          product.description,
          listPriceNum.toString(),
          listTotal?.toFixed(2) ?? null,
          actualTotal?.toFixed(2) ?? null,
          discount?.toString() ?? null,
        ],
      );
    }

    if (data.remember && targetRow.source_part) {
      const normalized = normalizePart(targetRow.source_part);
      const existing = await one(
        tx,
        "SELECT * FROM product_aliases WHERE normalized=$1 FOR UPDATE",
        [normalized],
      );
      if (!existing) {
        await tx.query(
          "INSERT INTO product_aliases(normalized,product_id,label,kind,created_by,updated_by) VALUES($1,$2,$3,'DELIVERY_NOTE',$4,$4)",
          [normalized, product.id, targetRow.source_part, actor.id],
        );
        await audit(
          tx,
          actor.id,
          "PRODUCT_ALIAS_ADD",
          "products",
          product.id,
          null,
          {
            alias: targetRow.source_part,
            kind: "DELIVERY_NOTE",
            partNumber: product.part_number,
            source: "SALES_PRICE_CHECK",
          },
        );
      } else if (existing.product_id !== product.id) {
        await tx.query(
          "UPDATE product_aliases SET product_id=$2,label=$3,updated_by=$4,updated_at=now(),version=version+1 WHERE normalized=$1",
          [normalized, product.id, targetRow.source_part, actor.id],
        );
        await audit(
          tx,
          actor.id,
          "PRODUCT_ALIAS_REASSIGN",
          "products",
          product.id,
          existing,
          {
            alias: targetRow.source_part,
            productId: product.id,
            source: "SALES_PRICE_CHECK",
          },
        );
      }
    }

    const summary = {
      totalRows: Number(
        (
          await one(
            tx,
            "SELECT count(*)::int AS c FROM sales_price_rows WHERE report_id=$1",
            [id],
          )
        )?.c || 0,
      ),
      matchedRows: Number(
        (
          await one(
            tx,
            "SELECT count(*)::int AS c FROM sales_price_rows WHERE report_id=$1 AND status='MATCHED'",
            [id],
          )
        )?.c || 0,
      ),
      unmatchedRows: Number(
        (
          await one(
            tx,
            "SELECT count(*)::int AS c FROM sales_price_rows WHERE report_id=$1 AND status='UNMATCHED'",
            [id],
          )
        )?.c || 0,
      ),
      ambiguousRows: Number(
        (
          await one(
            tx,
            "SELECT count(*)::int AS c FROM sales_price_rows WHERE report_id=$1 AND status='AMBIGUOUS'",
            [id],
          )
        )?.c || 0,
      ),
      invalidRows: Number(
        (
          await one(
            tx,
            "SELECT count(*)::int AS c FROM sales_price_rows WHERE report_id=$1 AND status='INVALID'",
            [id],
          )
        )?.c || 0,
      ),
    };

    await tx.query(
      "UPDATE sales_price_reports SET summary=$2,version=version+1,updated_at=now() WHERE id=$1",
      [id, json(summary)],
    );

    await audit(
      tx,
      actor.id,
      "SALES_PRICE_CHECK_MAP_ROW",
      "sales_price_reports",
      id,
      null,
      {
        rowId: data.rowId,
        productId: product.id,
        partNumber: product.part_number,
        sourcePart: targetRow.source_part,
        updatedCount: targetRows.length,
        scope: data.scope,
        remember: data.remember,
      },
    );

    return {
      ok: true,
      updatedCount: targetRows.length,
      matchedPart: product.part_number,
      summary,
    };
  });
}
