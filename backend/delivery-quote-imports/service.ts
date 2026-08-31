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
import { normalizeImportedDecimal } from "../pricing/normalize";
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

const reviewSchema = z
  .object({
    version: z.coerce.number().int(),
    rowIds: z.array(z.string().uuid()).min(1).max(500),
    action: z.enum(["ADD", "REMOVE", "RESTORE"]).optional(),
    completed: z.boolean().optional(),
    updates: z
      .object({
        quantity: z.string().optional(),
        description: z.string().optional(),
        unitPriceExcl: z.string().optional(),
        discount: z.string().optional(),
        sellingLevel: z.enum(["WHOLESALE", "RETAIL", "END_CUSTOMER"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const finalizeSchema = z
  .object({
    version: z.coerce.number().int(),
  })
  .strict();

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
  const docNo = String(raw[mapping.docNo] ?? "").trim();
  const docDate = String(raw[mapping.date] ?? "").trim();
  const partNumber = String(raw[mapping.partNumber] ?? "").trim();
  const description = String(raw[mapping.description] ?? "").trim();
  const quantity = normalizeMappedValue("quantity", raw[mapping.quantity]);
  const sourcePrice = mapping.price
    ? normalizeMappedValue("listPrice", raw[mapping.price])
    : "";
  const issues: string[] = [];
  if (!customerName) issues.push("Customer name is blank");
  if (!partNumber) issues.push("Part number is blank");
  if (!description) issues.push("Description is blank");
  if (!quantityPattern.test(quantity) || quantity === "0")
    issues.push("Quantity must be a positive number");
  let resolution: "MATCHED_CATALOG" | "UNMATCHED_CUSTOM" | "BLOCKED" =
    "BLOCKED";
  let productId: string | null = null;
  let lineInput: Record<string, unknown> = {};
  if (!issues.length && partNumber) {
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
      };
    } else {
      resolution = "UNMATCHED_CUSTOM";
      lineInput = {
        type: "CUSTOM",
        partNumber,
        description,
        unit: "pcs",
        quantity,
        unitPriceExcl: moneyPattern.test(sourcePrice) ? sourcePrice : "",
        discount: "0",
      };
      if (!moneyPattern.test(sourcePrice))
        issues.push("Enter a unit price before completing this custom row");
    }
  }
  const completed =
    issues.length === 0 &&
    (resolution === "MATCHED_CATALOG" || resolution === "UNMATCHED_CUSTOM");
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
  const customers = uniqueNonBlank(rows.map((row) => row.customerName));
  const docNos = uniqueNonBlank(rows.map((row) => row.docNo));
  const dates = uniqueNonBlank(rows.map((row) => row.docDate));
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
  const reference = header.docNos.length
    ? `Delivery notes: ${header.docNos.join(", ")}`
    : "";
  const notesParts = [];
  if (header.dates.length) notesParts.push(`Delivery dates: ${header.dates.join(", ")}`);
  if (header.docNos.length) notesParts.push(`Imported from delivery notes: ${header.docNos.join(", ")}`);
  return {
    name: header.customerName,
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
      await tx.query(
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
         SET resolution=$2,action='ADD',completed=$3,issues=$4,line_input=$5,source_price=$6,product_id=$7
         WHERE id=$1`,
        [
          row.id,
          next.resolution,
          next.completed,
          json(next.issues),
          json(next.lineInput),
          next.sourcePrice || null,
          next.productId,
        ],
      );
    }
    const header = headerState(staged);
    const summary = summarizeReview(
      rows.map((row, index) => ({
        ...row,
        ...staged[index],
        action: "ADD",
      })),
      header,
    );
    await tx.query(
      `UPDATE delivery_quote_jobs
       SET status='AWAITING_REVIEW',mapping=$2,header=$3,summary=$4,error=NULL,version=version+1,updated_at=now()
       WHERE id=$1`,
      [id, json(mapping), json(header), json(summary)],
    );
    return { ok: true };
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
      if (data.updates) nextInput = { ...nextInput, ...data.updates };
      let issues = Array.isArray(row.issues) ? [...row.issues] : [];
      let completed = row.completed;
      try {
        if (row.resolution === "MATCHED_CATALOG") {
          const parsed = lineInput.parse(nextInput);
          nextInput = parsed;
          issues = [];
        } else if (row.resolution === "UNMATCHED_CUSTOM") {
          const parsed = customLineInput.parse(nextInput);
          nextInput = parsed;
          issues = [];
        }
      } catch (error) {
        issues = [friendlyIssue(error)];
      }
      if (data.action === "REMOVE") completed = false;
      else if (data.completed !== undefined || data.action === "RESTORE" || data.action === "ADD")
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
    const header = job.header ?? {};
    assert(!header.blockedReason, 409, String(header.blockedReason));
    const rows = (
      await tx.query(
        "SELECT * FROM delivery_quote_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    const included = rows.filter((row) => row.action === "ADD");
    assert(included.length > 0, 400, "Select at least one row for the quotation");
    const incomplete = included.filter(
      (row) => !row.completed || (Array.isArray(row.issues) && row.issues.length),
    );
    assert(
      incomplete.length === 0,
      409,
      "Some included rows still need price or corrections. Complete or remove them before creating the quotation",
    );
    const quote = await saveDraft(
      tx,
      actor,
      {
        customer: toQuoteCustomer(header),
        lines: included.map((row) => row.line_input),
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
