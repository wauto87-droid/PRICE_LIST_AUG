import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, has, requirePermission } from "../auth/service";
import {
  customLineInput,
  lineInput,
  normalizePart,
  selectedLevel,
} from "../pricing/engine";
import { getProduct, toInput } from "../products/service";
import {
  normalizeImportedDecimal,
  formatDeliveryDocNo,
  formatDeliveryDate,
} from "../pricing/normalize";
import { saveDraft, getQuote, publicQuote } from "../quotations/service";

const quantityPattern = /^\d+(?:\.\d{1,6})?$/;
const moneyPattern = /^\d+(?:\.\d{1,6})?$/;

const mappingSchema = z
  .object({
    version: z.coerce.number().int(),
    date: z.string().min(1),
    docNo: z.string().min(1),
    customerName: z.string().min(1),
    partNumber: z.string().min(1),
    description: z.string().min(1),
    quantity: z.string().min(1),
    price: z.string().min(1).optional(),
  })
  .strict();

const rowUpdateItemSchema = z
  .object({
    quantity: z.string().optional(),
    description: z.string().optional(),
    unitPriceExcl: z.string().optional(),
    discount: z.string().optional(),
    sellingLevel: z.enum(["WHOLESALE", "RETAIL", "END_CUSTOMER"]).optional(),
  })
  .strict();

const reviewSchema = z
  .object({
    version: z.coerce.number().int(),
    rowIds: z.array(z.string().uuid()).min(1).max(500),
    action: z.enum(["ADD", "REMOVE", "RESTORE"]).optional(),
    completed: z.boolean().optional(),
    updates: rowUpdateItemSchema.optional(),
    rowUpdates: z.record(z.string().uuid(), rowUpdateItemSchema).optional(),
  })
  .strict();

const finalizeSchema = z
  .object({
    version: z.coerce.number().int(),
  })
  .strict();

const historyDateSchema = z
  .string()
  .refine((value) => !value || Boolean(isoDate(value)), "Enter a valid date");
const historySchema = z
  .object({
    scope: z.enum(["converted", "admin"]),
    query: z.string().max(100).default(""),
    status: z
      .enum([
        "ALL",
        "UPLOADED",
        "PROCESSING",
        "AWAITING_MAPPING",
        "AWAITING_REVIEW",
        "COMPLETED",
        "FAILED",
      ])
      .default("ALL"),
    datePreset: z
      .enum(["all", "today", "last7", "last30", "month", "custom"])
      .default("all"),
    from: historyDateSchema.default(""),
    to: historyDateSchema.default(""),
    sort: z
      .enum([
        "newest",
        "oldest",
        "filename_asc",
        "filename_desc",
        "customer_asc",
        "customer_desc",
        "quotation_asc",
        "quotation_desc",
      ])
      .default("newest"),
    page: z.coerce.number().int().min(0).default(0),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

function isoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : "";
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function riyadhToday(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function historyDateBounds(
  preset: "all" | "today" | "last7" | "last30" | "month" | "custom",
  from = "",
  to = "",
  now = new Date(),
) {
  let start = isoDate(from);
  let end = isoDate(to);
  if (!start && !end && preset !== "all" && preset !== "custom") {
    const today = riyadhToday(now);
    start =
      preset === "last7"
        ? shiftDate(today, -6)
        : preset === "last30"
          ? shiftDate(today, -29)
          : preset === "month"
            ? `${today.slice(0, 8)}01`
            : today;
    end = today;
  }
  return {
    from: start ? `${start}T00:00:00+03:00` : null,
    toExclusive: end ? `${shiftDate(end, 1)}T00:00:00+03:00` : null,
  };
}

function permission(actor: Actor) {
  assert(
    has(actor, "QUOTE_CREATE") || has(actor, "QUOTE_EDIT"),
    403,
    "You do not have permission to create quotations from delivery notes",
  );
}

function friendlyIssue(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues
      .map((issue) => {
        const field = String(issue.path.at(-1) ?? "value");
        if (field === "unitPriceExcl")
          return "Enter unit price as a number like 12.5 or 100, without commas";
        if (field === "quantity")
          return "Enter quantity as a positive number";
        if (field === "description") return "Description is required";
        return issue.message;
      })
      .join("; ");
  return (error as Error).message;
}

function uniqueNonBlank(values: string[]) {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toUpperCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()];
}

function uniqueCustomerNames(values: string[]) {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed
      .toUpperCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()];
}

async function productMatch(db: DB, partNumber: string) {
  const normalized = normalizePart(partNumber);
  return one(
    db,
    `SELECT p.id
     FROM products p
     WHERE p.normalized_part=$1
     UNION ALL
     SELECT a.product_id AS id
     FROM product_aliases a
     WHERE a.normalized=$1
     LIMIT 1`,
    [normalized],
  );
}

function normalizeMappedValue(field: string, value: unknown) {
  return String(normalizeImportedDecimal(field, value).value ?? "").trim();
}

async function stageRow(
  db: DB,
  raw: Record<string, unknown>,
  mapping: z.infer<typeof mappingSchema>,
) {
  const customerName = String(raw[mapping.customerName] ?? "").trim();
  const docNo = formatDeliveryDocNo(raw[mapping.docNo]);
  const docDate = formatDeliveryDate(raw[mapping.date]);
  const partNumber = String(raw[mapping.partNumber] ?? "").trim();
  const description = String(raw[mapping.description] ?? "").trim();
  const quantity = normalizeMappedValue("quantity", raw[mapping.quantity]);
  const sourcePrice = mapping.price
    ? normalizeMappedValue("listPrice", raw[mapping.price])
    : "";
  const issues: string[] = [];
  const zeroBalance =
    mapping.quantity.toLowerCase().replace(/[^a-z0-9]/g, "") === "balance" &&
    quantityPattern.test(quantity) &&
    quantity === "0";
  if (!customerName) issues.push("Customer name is blank");
  if (!zeroBalance && !partNumber) issues.push("Part number is blank");
  if (!zeroBalance && !description) issues.push("Description is blank");
  if (!quantityPattern.test(quantity))
    issues.push("Quantity must be a positive number");
  const action: "ADD" | "REMOVE" = zeroBalance ? "REMOVE" : "ADD";
  let resolution: "MATCHED_CATALOG" | "UNMATCHED_CUSTOM" | "BLOCKED" =
    "BLOCKED";
  let productId: string | null = null;
  let lineInput: Record<string, unknown> = {};
  const importMeta = {
    source: "DELIVERY_NOTE" as const,
    docNo,
    docDate,
    sourcePartNumber: partNumber,
    unresolved: false,
  };
  if (!issues.length && action === "ADD" && partNumber) {
    const matched = await productMatch(db, partNumber);
    if (matched) {
      const row = await getProduct(db, matched.id);
      const input = toInput(row);
      resolution = "MATCHED_CATALOG";
      productId = matched.id;
      lineInput = {
        productId: matched.id,
        quantity,
        discount: "0",
        override: false,
        reason: "",
        sellingLevel: selectedLevel(input).code,
        importMeta,
      };
    } else {
      resolution = "UNMATCHED_CUSTOM";
      const hasValidPrice = moneyPattern.test(sourcePrice);
      lineInput = {
        type: "CUSTOM",
        partNumber,
        description,
        unit: "pcs",
        quantity,
        unitPriceExcl: hasValidPrice ? sourcePrice : "0",
        discount: "0",
        importMeta: {
          ...importMeta,
          unresolved: !hasValidPrice,
        },
      };
    }
  }
  const completed =
    action === "REMOVE" ||
    (issues.length === 0 &&
      (resolution === "MATCHED_CATALOG" ||
        (resolution === "UNMATCHED_CUSTOM" && moneyPattern.test(sourcePrice))));
  return {
    customerName,
    docNo,
    docDate,
    partNumber,
    description,
    quantity,
    sourcePrice,
    productId,
    resolution,
    action,
    lineInput,
    issues,
    completed,
  };
}

async function loadJob(tx: DB, actor: Actor, id: string, forUpdate = false) {
  const sql = `SELECT * FROM delivery_quote_jobs WHERE id=$1${forUpdate ? " FOR UPDATE" : ""}`;
  const job = await one(tx, sql, [id]);
  assert(job, 404, "Delivery-note quotation import not found");
  assert(
    job.owner_id === actor.id || has(actor, "QUOTE_VIEW_ALL"),
    403,
    "This delivery-note quotation import belongs to another user",
  );
  return job;
}

function headerState(rows: any[]) {
  const customers = uniqueCustomerNames(rows.map((row) => row.customerName));
  const docNos = uniqueNonBlank(rows.map((row) => formatDeliveryDocNo(row.docNo)));
  const dates = uniqueNonBlank(rows.map((row) => formatDeliveryDate(row.docDate)));
  return {
    customerName: customers[0] ?? "",
    customerCount: customers.length,
    customers,
    docNos,
    dates,
    blockedReason:
      customers.length > 1
        ? "Delivery note file contains more than one customer name. Split the file or fix the customer column before finalizing."
        : "",
  };
}

function normalizeDeliveryHeader(header: any) {
  const source = header && typeof header === "object" ? header : {};
  return {
    ...source,
    customerName: String(source.customerName ?? "").trim(),
    docNos: uniqueNonBlank(
      (Array.isArray(source.docNos) ? source.docNos : []).map(
        formatDeliveryDocNo,
      ),
    ),
    dates: uniqueNonBlank(
      (Array.isArray(source.dates) ? source.dates : []).map(
        formatDeliveryDate,
      ),
    ),
  };
}

function headerFromRows(rows: any[], mapping: any) {
  return normalizeDeliveryHeader(
    headerState(
      rows.map((row) => {
        const importMeta = row.line_input?.importMeta ?? {};
        return {
          customerName: String(row.raw?.[mapping?.customerName] ?? "").trim(),
          docNo: importMeta.docNo ?? row.raw?.[mapping?.docNo],
          docDate: importMeta.docDate ?? row.raw?.[mapping?.date],
        };
      }),
    ),
  );
}

function summarizeReview(rows: any[], header: any) {
  return {
    totalRows: rows.length,
    includedRows: rows.filter((row) => row.action === "ADD").length,
    removedRows: rows.filter((row) => row.action === "REMOVE").length,
    completedRows: rows.filter(
      (row) => row.action === "ADD" && row.completed,
    ).length,
    blockedRows: rows.filter((row) => (row.issues ?? []).length > 0).length,
    matchedRows: rows.filter((row) => row.resolution === "MATCHED_CATALOG")
      .length,
    customRows: rows.filter((row) => row.resolution === "UNMATCHED_CUSTOM")
      .length,
    customerName: header.customerName,
    docNos: header.docNos,
    dates: header.dates,
    blockedReason: header.blockedReason,
  };
}

function toQuoteCustomer(header: any) {
  const normalized = normalizeDeliveryHeader(header);
  const reference = normalized.docNos.length
    ? `Delivery notes: ${normalized.docNos.join(", ")}`
    : "";
  const notesParts = [];
  if (normalized.dates.length)
    notesParts.push(`Delivery dates: ${normalized.dates.join(", ")}`);
  if (normalized.docNos.length)
    notesParts.push(
      `Imported from delivery notes: ${normalized.docNos.join(", ")}`,
    );
  return {
    name: normalized.customerName,
    number: "",
    mobile: "",
    reference,
    notes: notesParts.join("\n"),
  };
}

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
    "delivery-quote-imports",
  );
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const target = path.join(dir, id + ext);
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), {
    flag: "wx",
    mode: 0o600,
  });
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id) VALUES($1,$2,$3,'UPLOADED',$4)",
      [id, path.basename(file.name), target, actor.id],
    );
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'DELIVERY_QUOTE_EXTRACT',$2)",
      [randomUUID(), json({ importId: id })],
    );
    await audit(
      tx,
      actor.id,
      "DELIVERY_QUOTE_UPLOAD",
      "delivery_quote_jobs",
      id,
    );
  });
  return { id };
}

export async function list(db: DB, actor: Actor) {
  permission(actor);
  return (
    await db.query(
      `SELECT id,filename,status,summary,error,quote_id,version,created_at,updated_at
       FROM delivery_quote_jobs
       WHERE owner_id=$1 OR $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [actor.id, has(actor, "QUOTE_VIEW_ALL")],
    )
  ).rows;
}

export async function history(db: DB, actor: Actor, input: unknown) {
  permission(actor);
  const value = historySchema.parse(input);
  assert(
    !value.from || !value.to || value.from <= value.to,
    400,
    "From date must be on or before To date",
  );
  if (value.scope === "admin")
    assert(
      has(actor, "QUOTE_VIEW_ALL"),
      403,
      "You do not have permission to view all delivery-note source files",
    );

  const args: any[] = [];
  const bind = (item: unknown) => {
    args.push(item);
    return `$${args.length}`;
  };
  const conditions = [
    value.scope === "converted" ? "j.quote_id IS NOT NULL" : "true",
  ];
  if (!has(actor, "QUOTE_VIEW_ALL"))
    conditions.push(`j.owner_id=${bind(actor.id)}`);
  if (value.scope === "admin" && value.status !== "ALL")
    conditions.push(`j.status=${bind(value.status)}`);

  const search = value.query.trim();
  if (search) {
    const literal = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = bind(`%${literal}%`);
    conditions.push(`(
      j.filename ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(q.number,'') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(j.header->>'customerName',j.summary->>'customerName',q.customer->>'name','') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(j.header->'docNos',j.summary->'docNos','[]'::jsonb)::text ILIKE ${pattern} ESCAPE '\\'
    )`);
  }

  const bounds = historyDateBounds(
    value.datePreset,
    value.from,
    value.to,
  );
  const dateField = value.scope === "converted" ? "j.updated_at" : "j.created_at";
  if (bounds.from) conditions.push(`${dateField}>=${bind(bounds.from)}::timestamptz`);
  if (bounds.toExclusive)
    conditions.push(`${dateField}<${bind(bounds.toExclusive)}::timestamptz`);

  const customer =
    "LOWER(COALESCE(j.header->>'customerName',j.summary->>'customerName',q.customer->>'name',''))";
  const quotation = "LOWER(COALESCE(q.number,''))";
  const sorts: Record<string, string> = {
    newest: `${dateField} DESC, j.created_at DESC, j.id`,
    oldest: `${dateField}, j.created_at, j.id`,
    filename_asc: "LOWER(j.filename), j.created_at DESC, j.id",
    filename_desc: "LOWER(j.filename) DESC, j.created_at DESC, j.id",
    customer_asc: `${customer}, j.created_at DESC, j.id`,
    customer_desc: `${customer} DESC, j.created_at DESC, j.id`,
    quotation_asc: `${quotation}, j.created_at DESC, j.id`,
    quotation_desc: `${quotation} DESC, j.created_at DESC, j.id`,
  };
  const where = conditions.join(" AND ");
  const count = await one<{ total: number }>(
    db,
    `SELECT count(*)::int AS total
     FROM delivery_quote_jobs j
     LEFT JOIN quotations q ON q.id=j.quote_id
     WHERE ${where}`,
    args,
  );
  const total = count?.total ?? 0;
  const pageSize = value.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(value.page, totalPages - 1);
  const limit = bind(pageSize);
  const offset = bind(page * pageSize);
  const items = (
    await db.query(
      `SELECT j.id,j.filename,j.status,j.summary,j.error,j.quote_id,j.version,
              j.created_at,j.updated_at,q.number AS quotation_number,
              COALESCE(j.header->>'customerName',j.summary->>'customerName',q.customer->>'name','') AS customer_name,
              COALESCE(j.header->'docNos',j.summary->'docNos','[]'::jsonb) AS delivery_references
       FROM delivery_quote_jobs j
       LEFT JOIN quotations q ON q.id=j.quote_id
       WHERE ${where}
       ORDER BY ${sorts[value.sort]}
       LIMIT ${limit} OFFSET ${offset}`,
      args,
    )
  ).rows;
  return { items, page, pageSize, total, totalPages };
}

export async function get(
  db: DB,
  actor: Actor,
  id: string,
  page = 0,
  pageSize = 50,
  filter = "all",
) {
  permission(actor);
  const job = await loadJob(db, actor, id);
  const conditions: Record<string, string> = {
    all: "true",
    included: "action='ADD'",
    removed: "action='REMOVE'",
    problems: "jsonb_array_length(issues) > 0",
  };
  const where = conditions[filter] ?? conditions.all;
  const offset = page * pageSize;
  const rows = (
    await db.query(
      `SELECT * FROM delivery_quote_rows
       WHERE job_id=$1 AND ${where}
       ORDER BY row_number
       LIMIT $2 OFFSET $3`,
      [id, pageSize, offset],
    )
  ).rows;
  const count = await one(
    db,
    `SELECT count(*)::int AS total
     FROM delivery_quote_rows
     WHERE job_id=$1 AND ${where}`,
    [id],
  );
  return {
    ...job,
    rows,
    page,
    pageSize,
    resultCount: count?.total ?? 0,
    filter,
  };
}

export async function mapRows(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  permission(actor);
  const mapping = mappingSchema.parse(input);
  return db.transaction(async (tx) => {
    const job = await loadJob(tx, actor, id, true);
    assert(
      ["AWAITING_MAPPING", "AWAITING_REVIEW"].includes(job.status),
      409,
      "Delivery-note file is not ready for mapping",
    );
    assert(job.version === mapping.version, 409, "Import changed. Reload");
    const rows = (
      await tx.query<{ id: string; row_number: number; raw: any }>(
        "SELECT id,row_number,raw FROM delivery_quote_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    const staged: Awaited<ReturnType<typeof stageRow>>[] = [];
    for (const row of rows) {
      const next = await stageRow(tx, row.raw, mapping);
      staged.push(next);
      await tx.query(
        `UPDATE delivery_quote_rows
         SET resolution=$2,action=$3,completed=$4,issues=$5,line_input=$6,source_price=$7,product_id=$8
         WHERE id=$1`,
        [
          row.id,
          next.resolution,
          next.action,
          next.completed,
          json(next.issues),
          json(next.lineInput),
          next.sourcePrice || null,
          next.productId,
        ],
      );
    }
    const header = headerState(staged);
    const summaryRows = rows.map((row, index) => ({
      ...row,
      ...staged[index],
    }));
    const summary = summarizeReview(
      summaryRows,
      header,
    );
    await tx.query(
      `UPDATE delivery_quote_jobs
       SET status='AWAITING_REVIEW',mapping=$2,header=$3,summary=$4,error=NULL,version=version+1,updated_at=now()
       WHERE id=$1`,
      [id, json(mapping), json(header), json(summary)],
    );
    return { ok: true, blocked: !!header.blockedReason };
  });
}

export async function reviewRows(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  permission(actor);
  const data = reviewSchema.parse(input);
  return db.transaction(async (tx) => {
    const job = await loadJob(tx, actor, id, true);
    assert(
      job.status === "AWAITING_REVIEW",
      409,
      "Delivery-note import is not awaiting review",
    );
    assert(job.version === data.version, 409, "Import changed. Reload");
    const mapping = mappingSchema.parse(job.mapping);
    const rows = (
      await tx.query(
        "SELECT * FROM delivery_quote_rows WHERE job_id=$1 AND id=ANY($2::uuid[]) ORDER BY row_number",
        [id, data.rowIds],
      )
    ).rows;
    assert(rows.length === data.rowIds.length, 404, "One or more rows were not found");
    for (const row of rows) {
      let nextInput = { ...(row.line_input ?? {}) };
      const rowUpdate =
        (data.rowUpdates && data.rowUpdates[row.id]) || data.updates;
      if (rowUpdate) {
        if (rowUpdate.quantity !== undefined) {
          nextInput.quantity = String(rowUpdate.quantity).trim();
        }
        if (rowUpdate.description !== undefined) {
          nextInput.description = String(rowUpdate.description).trim();
        }
        if (rowUpdate.discount !== undefined) {
          nextInput.discount = String(rowUpdate.discount).trim();
        }
        if (rowUpdate.sellingLevel !== undefined) {
          nextInput.sellingLevel = rowUpdate.sellingLevel;
        }
        if (rowUpdate.unitPriceExcl !== undefined) {
          const rawPrice = String(rowUpdate.unitPriceExcl).trim();
          nextInput.unitPriceExcl = rawPrice === "" ? "0" : rawPrice;
        }
      }
      let issues: string[] = [];
      let completed = row.completed;
      try {
        if (row.resolution === "MATCHED_CATALOG") {
          const parsed = lineInput.passthrough().parse(nextInput);
          nextInput = { ...nextInput, ...parsed };
          issues = [];
        } else if (row.resolution === "UNMATCHED_CUSTOM") {
          if (
            nextInput.unitPriceExcl === undefined ||
            nextInput.unitPriceExcl === null ||
            String(nextInput.unitPriceExcl).trim() === ""
          ) {
            nextInput.unitPriceExcl = "0";
          } else {
            nextInput.unitPriceExcl = String(nextInput.unitPriceExcl).trim();
          }
          const parsed = customLineInput.passthrough().parse(nextInput);
          nextInput = { ...nextInput, ...parsed };
          issues = [];
        }
      } catch (error) {
        issues = [friendlyIssue(error)];
      }
      if (data.action === "REMOVE") completed = false;
      else if (
        data.completed !== undefined ||
        data.action === "RESTORE" ||
        data.action === "ADD"
      )
        completed = issues.length === 0;
      else if (issues.length) completed = false;
      await tx.query(
        `UPDATE delivery_quote_rows
         SET action=$2,completed=$3,issues=$4,line_input=$5
         WHERE id=$1`,
        [
          row.id,
          data.action === "REMOVE"
            ? "REMOVE"
            : data.action === "RESTORE"
              ? "ADD"
              : row.action,
          completed,
          json(issues),
          json(nextInput),
        ],
      );
    }
    const refreshed = (
      await tx.query(
        "SELECT * FROM delivery_quote_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    const summary = summarizeReview(refreshed, job.header ?? {});
    await tx.query(
      "UPDATE delivery_quote_jobs SET summary=$2,version=version+1,updated_at=now() WHERE id=$1",
      [id, json(summary)],
    );
    return { ok: true };
  });
}

export async function finalize(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  permission(actor);
  const data = finalizeSchema.parse(input);
  return db.transaction(async (tx) => {
    const job = await loadJob(tx, actor, id, true);
    assert(
      job.status === "AWAITING_REVIEW" || job.status === "COMPLETED",
      409,
      "Delivery-note import cannot be finalized now",
    );
    if (job.status === "COMPLETED") {
      assert(job.quote_id, 409, "Saved quotation is missing");
      return publicQuote(await getQuote(tx, actor, job.quote_id), actor);
    }
    assert(job.version === data.version, 409, "Import changed. Reload");
    const rows = (
      await tx.query(
        "SELECT * FROM delivery_quote_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    const included = rows.filter((row) => row.action === "ADD");
    assert(included.length > 0, 400, "Select at least one row for the quotation");
    const header = job.mapping
      ? headerFromRows(included, job.mapping)
      : normalizeDeliveryHeader(job.header);
    assert(!header.blockedReason, 409, String(header.blockedReason));
    const quote = await saveDraft(
      tx,
      actor,
      {
        customer: toQuoteCustomer(header),
        lines: included.map((row) => {
          const baseInput = row.line_input || {};
          const rawDocNo =
            baseInput.importMeta?.docNo ??
            row.doc_no ??
            row.docNo ??
            row.raw?.[job.mapping?.docNo];
          const rawDocDate =
            baseInput.importMeta?.docDate ??
            row.doc_date ??
            row.docDate ??
            row.raw?.[job.mapping?.date];
          const docNo = formatDeliveryDocNo(rawDocNo);
          const docDate = formatDeliveryDate(rawDocDate);
          const importMeta = {
            source: "DELIVERY_NOTE" as const,
            ...(baseInput.importMeta ?? {}),
            rowId: row.id,
            rowNumber: row.row_number,
            docNo,
            docDate,
            unresolved: false,
          };
          if (row.resolution === "MATCHED_CATALOG" || baseInput.productId) {
            return {
              type: "CATALOG" as const,
              productId: baseInput.productId || row.product_id,
              sellingLevel: baseInput.sellingLevel ?? "END_CUSTOMER",
              quantity: String(baseInput.quantity ?? "1").trim(),
              discount: String(baseInput.discount ?? "0").trim(),
              override: Boolean(baseInput.override),
              reason: String(baseInput.reason ?? "").trim(),
              importMeta,
            };
          }
          return {
            type: "CUSTOM" as const,
            partNumber: String(baseInput.partNumber || row.raw?.[job.mapping?.partNumber] || "").trim(),
            description: String(baseInput.description || row.raw?.[job.mapping?.description] || "").trim(),
            unit: String(baseInput.unit || "pcs").trim() || "pcs",
            quantity: String(baseInput.quantity ?? "1").trim(),
            unitPriceExcl: String(baseInput.unitPriceExcl ?? "0").trim() || "0",
            discount: String(baseInput.discount ?? "0").trim(),
            vat: baseInput.vat !== undefined ? String(baseInput.vat).trim() : undefined,
            reusableItemId: baseInput.reusableItemId,
            importMeta,
          };
        }),
      },
      {},
    );
    await tx.query(
      `UPDATE delivery_quote_jobs
       SET status='COMPLETED',quote_id=$2,version=version+1,updated_at=now()
       WHERE id=$1`,
      [id, quote.id],
    );
    await audit(
      tx,
      actor.id,
      "DELIVERY_QUOTE_FINALIZE",
      "delivery_quote_jobs",
      id,
      null,
      { quoteId: quote.id },
    );
    return quote;
  });
}

export async function remove(db: DB, actor: Actor, id: string) {
  permission(actor);
  const job = await loadJob(db, actor, id);
  await db.transaction(async (tx) => {
    await tx.query(
      "DELETE FROM jobs WHERE kind='DELIVERY_QUOTE_EXTRACT' AND payload->>'importId'=$1",
      [id],
    );
    await tx.query("DELETE FROM delivery_quote_jobs WHERE id=$1", [id]);
    await audit(tx, actor.id, "DELIVERY_QUOTE_DELETE", "delivery_quote_jobs", id);
  });
  await fs.rm(job.file_path, { force: true });
  return { ok: true };
}
