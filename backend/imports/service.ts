import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";
import {
  percent,
  productInput,
  sellingLevels,
  validateProduct,
  normalizePart,
  type ProductInput,
} from "../pricing/engine";
import { saveProduct, getProduct, toInput } from "../products/service";
import { importCandidate } from "../pricing/transfer";
import { levelDifferences } from "../bulk/service";
import { lockActor } from "../auth/service";
import { normalizeImportedDecimal } from "../pricing/normalize";

const importFieldLabel = (path: PropertyKey[]) => {
  const field = String(path.at(-1) ?? "value");
  return (
    (
      {
        listPrice: "Public/list price",
        fixedPrice: "Fixed selling price",
        sellingPrice: "Selling price",
        minimum: "Minimum price",
        baseDiscount: "Discount",
        vat: "VAT",
        cost: "Cost",
        markup: "Markup",
      } as Record<string, string>
    )[field] ?? field
  );
};

function importValidationMessage(
  error: z.ZodError,
  proposed: Record<string, any>,
) {
  return error.issues
    .map((issue) => {
      const field = String(issue.path.at(-1) ?? "");
      const value = proposed[issue.path.join(".")] ?? proposed[field];
      const label = importFieldLabel(issue.path);
      if (typeof value === "string" && value.startsWith("-"))
        return `${label} ${value} is negative; enter zero or a positive amount`;
      if (["baseDiscount", "vat"].includes(field) && Number(value) > 100)
        return `${label} ${value} exceeds the allowed range of 0–100`;
      return `${label}: ${issue.message}${value === undefined ? "" : ` (received ${value})`}`;
    })
    .join("; ");
}

const guidedDiscountPresetSchema = z
  .object({
    finalDiscount: percent,
    wholesaleDiscount: percent,
    minimumDiscount: percent,
  })
  .strict();
const guidedImportSchema = z
  .object({
    mode: z.literal("PUBLIC_PRICE_DISCOUNT"),
    groupColumn: z.string().trim().max(200).optional(),
    defaultPreset: guidedDiscountPresetSchema,
    groupPresets: z.record(z.string(), guidedDiscountPresetSchema).default({}),
  })
  .strict();
const IMPORT_PAGE_SIZE_DEFAULT = 50;
const IMPORT_PAGE_SIZE_MAX = 200;
const IMPORT_REVIEW_MAX_CHANGES = 1000;
const importVersionSchema = z.coerce
  .number()
  .int("Version must be a whole number");
const importDefaultsSchema = z
  .union([z.record(z.string(), z.unknown()), z.null(), z.undefined()])
  .transform((value) => value ?? {});
const importMappingRequestSchema = z
  .object({
    mapping: z.record(z.string(), z.string()),
    defaults: importDefaultsSchema,
    version: importVersionSchema,
    mode: z
      .enum(["UPDATE_ONLY", "CREATE_UPDATE", "CREATE_NEW_ONLY"])
      .optional(),
    quickImport: z.boolean().optional(),
    background: z.boolean().optional(),
  })
  .strict();
const bulkReviewRequestSchema = z
  .object({
    version: importVersionSchema,
    action: z.enum(["SELECT_ALL", "SKIP_INVALID"]),
  })
  .strict();

const normalizeImportColumn = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const inferGroupColumn = (columns: string[]) =>
  columns.find((column) => normalizeImportColumn(column) === "activity") ??
  null;

const quickImportEnabled = (
  defaults: Record<string, unknown> | null | undefined,
) => defaults?.quickImport === true;

const nonEmptyCell = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const trimMappedValue = (value: unknown) =>
  nonEmptyCell(value) ? String(value).trim() : undefined;

export function extractMappedValues(
  raw: Record<string, unknown>,
  mapping: Record<string, string>,
) {
  const proposed: Record<string, any> = {};
  for (const [field, column] of Object.entries(mapping)) {
    const value =
      raw[column] ??
      Object.entries(raw).find(
        ([header]) => normalizeImportColumn(header) === normalizeImportColumn(column),
      )?.[1];
    if (nonEmptyCell(value))
      proposed[field] = normalizeImportedDecimal(field, value).value;
  }
  if (typeof proposed.minimumEnabled === "string")
    proposed.minimumEnabled = ["true", "1", "yes", "on"].includes(
      proposed.minimumEnabled.toLowerCase(),
    );
  if (typeof proposed.quantityPrecision === "string")
    proposed.quantityPrecision = Number(proposed.quantityPrecision);
  if (typeof proposed.aliases === "string")
    proposed.aliases = proposed.aliases.split("|").filter(Boolean);
  return proposed;
}

function hasQuickPrice(mapped: Record<string, unknown>) {
  const priceFields = [
    "cost",
    "listPrice",
    "END_CUSTOMER.sellingPrice",
    "WHOLESALE.sellingPrice",
    "RETAIL.sellingPrice",
    "END_CUSTOMER.listPrice",
    "WHOLESALE.listPrice",
    "RETAIL.listPrice",
  ];
  return priceFields.some((field) => nonEmptyCell(mapped[field]));
}

async function stageImportRow(
  tx: DB,
  row: any,
  mapping: Record<string, string>,
  productDefaults: Record<string, unknown>,
  guidedImport: z.infer<typeof guidedImportSchema> | null,
  mode: "UPDATE_ONLY" | "CREATE_UPDATE" | "CREATE_NEW_ONLY",
  quickImport: boolean,
  applyPricingDefaultsToExisting = false,
  basicImport = false,
) {
  let proposed = extractMappedValues(row.raw, mapping);
  const errors: string[] = [];
  const duplicate = proposed.partNumber
    ? await one(
        tx,
        "SELECT id,version FROM products WHERE normalized_part=$1",
        [normalizePart(proposed.partNumber)],
      )
    : null;
  const current = duplicate
    ? toInput(await getProduct(tx, duplicate.id))
    : undefined;
  try {
    if (guidedImport)
      proposed = {
        ...proposed,
        ...applyGuidedDiscountDefaults(
          row.raw,
          proposed,
          current,
          guidedImport,
        ),
      };
    if (quickImport) {
      const partNumber = trimMappedValue(proposed.partNumber);
      if (!partNumber) errors.push("Part number is required for quick import");
      if (!hasQuickPrice(proposed))
        errors.push("Price is required for quick import");
      if (partNumber && !duplicate && mode === "UPDATE_ONLY")
        errors.push(
          "Unknown part number: Update Existing Only does not create products",
        );
      if (partNumber && !trimMappedValue(proposed.description))
        proposed.description = current?.description || partNumber;
    }
    const candidateDefaults =
      current && basicImport
        ? Object.fromEntries(
            Object.entries(productDefaults).filter(
              ([key]) =>
                !["method", "markup", "listPrice", "baseDiscount"].includes(
                  key,
                ),
            ),
          )
        : productDefaults;
    proposed = importCandidate(
      proposed,
      candidateDefaults,
      current,
      applyPricingDefaultsToExisting,
    );
    const parsed = validateProduct(productInput.parse(proposed));
    if (!quickImport && !duplicate && mode === "UPDATE_ONLY")
      errors.push(
        "Unknown part number: Update Existing Only does not create products",
      );
    if (duplicate && mode === "CREATE_NEW_ONLY")
      errors.push(
        "Part number already exists: Create New Only does not update products",
      );
    return {
      proposed: parsed,
      errors,
      duplicateId: duplicate?.id ?? null,
      expectedVersion: duplicate?.version ?? null,
    };
  } catch (e) {
    errors.push(
      e instanceof z.ZodError
        ? importValidationMessage(e, proposed)
        : (e as Error).message,
    );
    return {
      proposed,
      errors,
      duplicateId: duplicate?.id ?? null,
      expectedVersion: duplicate?.version ?? null,
    };
  }
}

function splitImportDefaults(defaults: Record<string, unknown>) {
  const {
    guidedImport,
    quickImport,
    supplierQuotePriceRole,
    importProfile,
    basicImport,
    ...productDefaults
  } = defaults;
  return {
    productDefaults,
    guidedImport:
      guidedImport === undefined
        ? null
        : guidedImportSchema.parse(guidedImport),
  };
}

const supplierQuotePriceTargets = [
  "cost",
  "listPrice",
  "WHOLESALE.sellingPrice",
  "RETAIL.sellingPrice",
  "END_CUSTOMER.sellingPrice",
];

function defaultLevelListPrice(existing: ProductInput) {
  const code = existing.defaultLevel ?? "END_CUSTOMER";
  return (
    sellingLevels(existing).find((level) => level.code === code)?.listPrice ??
    existing.listPrice
  );
}

function applyGuidedDiscountDefaults(
  raw: Record<string, unknown>,
  mapped: Record<string, unknown>,
  existing: ProductInput | undefined,
  guidedImport: z.infer<typeof guidedImportSchema>,
) {
  const listPriceRaw =
    mapped.listPrice ?? defaultLevelListPrice(existing as ProductInput);
  assert(
    listPriceRaw !== undefined &&
      listPriceRaw !== null &&
      String(listPriceRaw).trim() !== "",
    400,
    "Guided discount import requires a mapped Public price / listPrice value",
  );
  const listPrice = new Decimal(String(listPriceRaw).trim());
  const groupValue = guidedImport.groupColumn
    ? String(raw[guidedImport.groupColumn] ?? "").trim()
    : "";
  const preset =
    (groupValue && guidedImport.groupPresets[groupValue]) ||
    guidedImport.defaultPreset;

  const finalPrice = listPrice.mul(
    new Decimal(1).sub(new Decimal(preset.finalDiscount).div(100)),
  );
  const wholesalePrice = listPrice.mul(
    new Decimal(1).sub(new Decimal(preset.wholesaleDiscount).div(100)),
  );
  const maxAllowedMinimum = Decimal.min(finalPrice, wholesalePrice);

  let minimumDecimal = listPrice.mul(
    new Decimal(1).sub(new Decimal(preset.minimumDiscount).div(100)),
  );
  if (minimumDecimal.gt(maxAllowedMinimum)) {
    minimumDecimal = maxAllowedMinimum;
  }
  const minimumDiscount = new Decimal(preset.minimumDiscount);
  const minimum = minimumDecimal.toDecimalPlaces(2).toFixed(2);
  const minimumEnabled = minimumDiscount.gt(0);

  const result: Record<string, unknown> = {
    method: "LIST_DISCOUNT",
    listPrice: listPrice.toString(),
    baseDiscount: preset.finalDiscount,
    minimumEnabled,
    minimum: minimumEnabled ? minimum : "0",
    "WHOLESALE.active": true,
    "WHOLESALE.method": "LIST_DISCOUNT",
    "WHOLESALE.listPrice": listPrice.toString(),
    "WHOLESALE.baseDiscount": preset.wholesaleDiscount,
  };
  if (!existing) {
    result.defaultLevel = "END_CUSTOMER";
    result["END_CUSTOMER.active"] = true;
    result["END_CUSTOMER.method"] = "LIST_DISCOUNT";
    result["END_CUSTOMER.listPrice"] = listPrice.toString();
    result["END_CUSTOMER.baseDiscount"] = preset.finalDiscount;
  }
  return result;
}

async function confirmationState(
  db: DB,
  actor: Actor,
  id: string,
  stamp: string,
) {
  const job = await one(
    db,
    "SELECT version,mode FROM import_jobs WHERE id=$1",
    [id],
  );
  assert(job, 404, "Import not found");
  const config = await one(db, "SELECT version FROM settings WHERE id=1");
  const rows = (
    await db.query(
      "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number",
      [id],
    )
  ).rows;
  const items = [];
  for (const row of rows) {
    const current = row.duplicate_id
      ? await getProduct(db, row.duplicate_id)
      : null;
    let differences: any[] = [];
    try {
      differences = levelDifferences(
        current ? toInput(current) : undefined,
        productInput.parse(row.proposed),
      );
    } catch {}
    items.push({
      ...row,
      currentVersion: current?.version ?? null,
      differences,
    });
  }
  const fingerprint = createHash("sha256")
    .update(
      json({
        stamp,
        job,
        config,
        items,
        actor: actor.id,
        permissions: actor.permissions,
      }),
    )
    .digest("hex");
  return { token: stamp + "." + fingerprint, items };
}
export async function previewConfirmation(db: DB, actor: Actor, id: string) {
  requirePermission(actor, "IMPORT_CONFIRM");
  requirePermission(actor, "COST_VIEW");
  return previewConfirmationPage(
    db,
    actor,
    id,
    String(Date.now()),
    0,
    IMPORT_PAGE_SIZE_DEFAULT,
  );
}

export async function getImportPage(
  db: DB,
  actor: Actor,
  id: string,
  page = 0,
  pageSize = IMPORT_PAGE_SIZE_DEFAULT,
  groupColumn?: string | null,
  rowView: "all" | "repair" = "all",
) {
  requirePermission(actor, "COST_VIEW");
  const job = await one(
    db,
    "SELECT id,filename,kind,status,mode,mapping,defaults,summary,error,version FROM import_jobs WHERE id=$1",
    [id],
  );
  assert(job, 404, "Import not found");
  const totals = await one(
    db,
    `SELECT
        count(*)::int AS total_rows,
        count(*) FILTER (WHERE NOT verified)::int AS unverified_rows,
        count(*) FILTER (WHERE coalesce(jsonb_array_length(errors), 0) > 0)::int AS problem_rows,
        count(*) FILTER (WHERE coalesce(jsonb_array_length(errors), 0) = 0)::int AS valid_rows,
        count(*) FILTER (WHERE decision='UPDATE')::int AS selected_rows,
        count(*) FILTER (WHERE decision='SKIP')::int AS skipped_rows,
        count(*) FILTER (
          WHERE verified AND decision='UPDATE' AND coalesce(jsonb_array_length(errors), 0) = 0
        )::int AS ready_rows
      FROM import_rows
      WHERE job_id=$1`,
    [id],
  );
  const totalRows = totals?.total_rows ?? 0;
  const filteredRows =
    rowView === "repair" ? (totals?.problem_rows ?? 0) : totalRows;
  const safePageSize = Math.min(Math.max(pageSize, 1), IMPORT_PAGE_SIZE_MAX);
  const totalPages = Math.max(1, Math.ceil(filteredRows / safePageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * safePageSize;
  const filterClause =
    rowView === "repair"
      ? " AND coalesce(jsonb_array_length(errors), 0) > 0"
      : "";
  const rows = (
    await db.query(
      `SELECT * FROM import_rows
       WHERE job_id=$1${filterClause}
       ORDER BY row_number
       LIMIT $2 OFFSET $3`,
      [id, safePageSize, offset],
    )
  ).rows;
  for (const row of rows)
    if (row.duplicate_id)
      row.current = toInput(await getProduct(db, row.duplicate_id));
  const columns = Array.isArray(job.summary?.columns)
    ? job.summary.columns
    : [];
  const storedGroupColumn =
    typeof job.defaults?.guidedImport?.groupColumn === "string"
      ? job.defaults.guidedImport.groupColumn.trim()
      : "";
  const resolvedGroupColumn =
    (groupColumn ?? "").trim() ||
    storedGroupColumn ||
    inferGroupColumn(columns) ||
    "";
  let groupValues: string[] = [];
  if (resolvedGroupColumn) {
    groupValues = (
      await db.query(
        `SELECT DISTINCT nullif(btrim(raw->>$2), '') AS value
         FROM import_rows
         WHERE job_id=$1 AND nullif(btrim(raw->>$2), '') IS NOT NULL
         ORDER BY value`,
        [id, resolvedGroupColumn],
      )
    ).rows.map((row) => row.value);
  }
  return {
    ...job,
    capabilities: {
      canEdit: !["IMPORTED", "ROLLED_BACK"].includes(job.status),
      canCreateCorrection:
        ["IMPORTED", "ROLLED_BACK"].includes(job.status) && totalRows > 0,
      correctionUnavailableReason:
        totalRows > 0 ? "" : "Original extracted rows are no longer available",
    },
    summary: { ...(job.summary || {}), rows: totalRows },
    rows,
    rowView,
    page: safePage,
    pageSize: safePageSize,
    totalRows,
    filteredRows,
    totalPages,
    hasMore: safePage + 1 < totalPages,
    groupColumn: resolvedGroupColumn || null,
    groupValues,
    rowViewCounts: {
      allRows: totalRows,
      repairRows: totals?.problem_rows ?? 0,
    },
    reviewStats: {
      unverifiedRows: totals?.unverified_rows ?? 0,
      problemRows: totals?.problem_rows ?? 0,
      readyRows: totals?.ready_rows ?? 0,
    },
    quickStats: quickImportEnabled(job.defaults)
      ? {
          validRows: totals?.valid_rows ?? 0,
          invalidRows: totals?.problem_rows ?? 0,
          selectedRows: totals?.selected_rows ?? 0,
          skippedRows: totals?.skipped_rows ?? 0,
        }
      : null,
  };
}

export async function previewConfirmationPage(
  db: DB,
  actor: Actor,
  id: string,
  stamp: string,
  page = 0,
  pageSize = IMPORT_PAGE_SIZE_DEFAULT,
) {
  const { token, items } = await confirmationState(db, actor, id, stamp);
  const safePageSize = Math.min(Math.max(pageSize, 1), IMPORT_PAGE_SIZE_MAX);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * safePageSize;
  return {
    token,
    items: items.slice(start, start + safePageSize),
    totalItems,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}
export async function upload(db: DB, actor: Actor, file: File) {
  const ext = path.extname(file.name).toLowerCase();
  assert(
    [".xlsx", ".xls", ".csv", ".pdf"].includes(ext),
    400,
    "Supported files: XLSX, XLS, CSV, PDF",
  );
  const kind = ext === ".pdf" ? "PDF" : "EXCEL";
  requirePermission(actor, kind === "PDF" ? "IMPORT_PDF" : "IMPORT_EXCEL");
  assert(
    file.size > 0 &&
      file.size <= Number(process.env.UPLOAD_MAX_MB || 20) * 1024 * 1024,
    413,
    "File exceeds upload limit",
  );
  const dir = path.resolve(process.env.UPLOAD_DIR || ".data/uploads");
  await fs.mkdir(dir, { recursive: true });
  const id = randomUUID();
  const target = path.join(dir, id + ext);
  await fs.writeFile(target, Buffer.from(await file.arrayBuffer()), {
    flag: "wx",
    mode: 0o600,
  });
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id) VALUES($1,$2,$3,$4,'UPLOADED',$5)",
      [id, path.basename(file.name), target, kind, actor.id],
    );
    await tx.query(
      "INSERT INTO jobs(id,kind,payload) VALUES($1,'IMPORT_EXTRACT',$2)",
      [randomUUID(), json({ importId: id })],
    );
    await audit(tx, actor.id, kind + "_UPLOAD", "import_jobs", id);
  });
  return { id };
}
export async function mapRows(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  requirePermission(actor, "IMPORT_CONFIRM");
  const parsed = importMappingRequestSchema.parse(input);
  const mapping = Object.fromEntries(
    Object.entries(parsed.mapping).flatMap(([field, column]) => {
      const normalizedField = field.trim();
      const exactColumn = column;
      return normalizedField && exactColumn.trim()
        ? [[normalizedField, exactColumn]]
        : [];
    }),
  );
  assert(
    Object.keys(mapping).length > 0,
    400,
    "Map at least one column before validating",
  );
  assert(
    mapping.partNumber,
    400,
    "Map the part number column before validating the import",
  );
  const data = {
    ...parsed,
    mapping,
  };
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(job, 404, "Import not found");
    assert(
      ["AWAITING_REVIEW", "FAILED"].includes(job.status),
      409,
      "Import is not ready for mapping",
    );
    if (job.status === "FAILED") {
      const available = await one(
        tx,
        "SELECT count(*)::int AS count FROM import_rows WHERE job_id=$1",
        [id],
      );
      assert(
        Number(available?.count || 0) > 0,
        409,
        "Extracted rows are unavailable; upload the file again",
      );
    }
    assert(job.version === data.version, 409, "Import changed. Reload");
    const mode = data.mode ?? job.mode;
    const quickImport = data.quickImport ?? quickImportEnabled(job.defaults);
    const applyPricingDefaultsToExisting =
      data.defaults?.importProfile === "BASIC" ||
      (job.summary?.profile === "SUPPLIER_QUOTE" &&
        data.mapping.cost === "Unit price");
    if (job.summary?.profile === "SUPPLIER_QUOTE") {
      const quotePriceMappings = supplierQuotePriceTargets.filter(
        (field) => data.mapping[field] === "Unit price",
      );
      assert(
        quotePriceMappings.length === 1,
        400,
        "Choose exactly one destination for the supplier quote Unit price before validating the import",
      );
    }
    if (["CREATE_UPDATE", "CREATE_NEW_ONLY"].includes(mode))
      requirePermission(actor, "PRODUCT_CREATE");
    const { productDefaults, guidedImport } = splitImportDefaults(
      data.defaults,
    );
    if (data.background) {
      const validationDefaults = { ...data.defaults, quickImport };
      await tx.query(
        `UPDATE import_jobs
         SET mapping=$2,defaults=$3,mode=$4,status='VALIDATING',error=NULL,
             summary=summary||$5::jsonb,version=version+1,updated_at=now()
         WHERE id=$1`,
        [
          id,
          json(data.mapping),
          json(validationDefaults),
          mode,
          json({
            profile:
              data.defaults?.importProfile || job.summary?.profile || null,
            progress: {
              phase: "QUEUED",
              processedRows: 0,
              totalRows: Number(job.summary?.rows || 0),
              percentage: 0,
              remainingSeconds: null,
            },
          }),
        ],
      );
      await tx.query(
        "DELETE FROM jobs WHERE kind='IMPORT_VALIDATE' AND payload->>'importId'=$1 AND status IN ('PENDING','RUNNING')",
        [id],
      );
      const validationId = randomUUID();
      await tx.query(
        "INSERT INTO jobs(id,kind,payload) VALUES($1,'IMPORT_VALIDATE',$2)",
        [validationId, json({ importId: id })],
      );
      await audit(tx, actor.id, "IMPORT_VALIDATION_QUEUED", "import_jobs", id);
      return { ok: true, queued: true, id: validationId, status: "VALIDATING" };
    }
    const rows = (
      await tx.query(
        "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    for (const row of rows) {
      const staged = await stageImportRow(
        tx,
        row,
        data.mapping,
        productDefaults,
        guidedImport,
        mode,
        quickImport,
        applyPricingDefaultsToExisting,
        data.defaults?.importProfile === "BASIC",
      );
      await tx.query(
        "UPDATE import_rows SET proposed=$2,errors=$3,duplicate_id=$4,expected_version=$5,decision='REVIEW',verified=false WHERE id=$1",
        [
          row.id,
          json(staged.proposed),
          json(staged.errors),
          staged.duplicateId,
          staged.expectedVersion,
        ],
      );
    }
    await tx.query(
      "UPDATE import_jobs SET mapping=$2,defaults=$3,mode=$4,version=version+1,updated_at=now() WHERE id=$1",
      [id, json(data.mapping), json({ ...data.defaults, quickImport }), mode],
    );
    return { ok: true };
  });
}

export async function processValidation(
  db: DB,
  id: string,
  workerJobId: string,
) {
  const job = await one(db, "SELECT * FROM import_jobs WHERE id=$1", [id]);
  assert(
    job && ["VALIDATING", "FAILED"].includes(job.status),
    409,
    "Import is not awaiting validation",
  );
  await db.query(
    "UPDATE import_jobs SET status='VALIDATING',error=NULL,updated_at=now() WHERE id=$1",
    [id],
  );
  const { productDefaults, guidedImport } = splitImportDefaults(
    job.defaults || {},
  );
  const quickImport = quickImportEnabled(job.defaults);
  const applyPricingDefaultsToExisting =
    job.defaults?.importProfile === "BASIC" ||
    (job.summary?.profile === "SUPPLIER_QUOTE" &&
      job.mapping?.cost === "Unit price");
  const count = await one(
    db,
    "SELECT count(*)::int AS total FROM import_rows WHERE job_id=$1",
    [id],
  );
  const total = Number(count?.total || 0);
  const started = Date.now();
  const batchSize = 200;
  let processed = 0;
  while (processed < total) {
    const rows = (
      await db.query(
        "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number LIMIT $2 OFFSET $3",
        [id, batchSize, processed],
      )
    ).rows;
    if (!rows.length) break;
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const staged = await stageImportRow(
          tx,
          row,
          job.mapping || {},
          productDefaults,
          guidedImport,
          job.mode,
          quickImport,
          applyPricingDefaultsToExisting,
          job.defaults?.importProfile === "BASIC",
        );
        await tx.query(
          "UPDATE import_rows SET proposed=$2,errors=$3,duplicate_id=$4,expected_version=$5,decision='REVIEW',verified=false WHERE id=$1",
          [
            row.id,
            json(staged.proposed),
            json(staged.errors),
            staged.duplicateId,
            staged.expectedVersion,
          ],
        );
      }
    });
    processed += rows.length;
    const elapsedSeconds = Math.max((Date.now() - started) / 1000, 0.1);
    const remainingSeconds = processed
      ? Math.max(
          0,
          Math.round(((total - processed) * elapsedSeconds) / processed),
        )
      : null;
    const progress = {
      phase: processed >= total ? "FINALIZING" : "VALIDATING",
      processedRows: processed,
      totalRows: total,
      percentage: total
        ? Math.min(99, Math.floor((processed / total) * 100))
        : 100,
      remainingSeconds,
      startedAt: new Date(started).toISOString(),
    };
    await db.query(
      "UPDATE import_jobs SET summary=summary||$2::jsonb,updated_at=now() WHERE id=$1",
      [id, json({ progress })],
    );
    await db.query("UPDATE jobs SET locked_at=now() WHERE id=$1", [
      workerJobId,
    ]);
  }
  const stats = await one(
    db,
    `SELECT count(*) FILTER(WHERE coalesce(jsonb_array_length(errors),0)=0)::int AS valid,
            count(*) FILTER(WHERE coalesce(jsonb_array_length(errors),0)>0)::int AS invalid
     FROM import_rows WHERE job_id=$1`,
    [id],
  );
  await db.query(
    `UPDATE import_jobs SET status='AWAITING_REVIEW',error=NULL,
       summary=summary||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1`,
    [
      id,
      json({
        validation: {
          validRows: Number(stats?.valid || 0),
          invalidRows: Number(stats?.invalid || 0),
        },
        progress: {
          phase: "COMPLETE",
          processedRows: total,
          totalRows: total,
          percentage: 100,
          remainingSeconds: 0,
          startedAt: new Date(started).toISOString(),
        },
      }),
    ],
  );
}
export async function bulkReview(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  requirePermission(actor, "IMPORT_CONFIRM");
  const data = bulkReviewRequestSchema.parse(input);
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      job && job.status === "AWAITING_REVIEW",
      409,
      "Import is not awaiting review",
    );
    assert(job.version === data.version, 409, "Import changed. Reload");
    if (data.action === "SELECT_ALL") {
      await tx.query(
        `UPDATE import_rows
         SET decision = CASE
               WHEN coalesce(jsonb_array_length(errors), 0) = 0 THEN 'UPDATE'
               ELSE 'SKIP'
             END,
             verified = CASE
               WHEN coalesce(jsonb_array_length(errors), 0) = 0 THEN true
               ELSE false
             END
         WHERE job_id = $1`,
        [id],
      );
    } else if (data.action === "SKIP_INVALID") {
      await tx.query(
        `UPDATE import_rows
         SET decision = 'SKIP', verified = false
         WHERE job_id = $1 AND coalesce(jsonb_array_length(errors), 0) > 0`,
        [id],
      );
    }
    await tx.query(
      "UPDATE import_jobs SET version=version+1,updated_at=now() WHERE id=$1",
      [id],
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
  requirePermission(actor, "IMPORT_CONFIRM");
  const data = z
    .object({
      rows: z
        .array(
          z.object({
            id: z.string().uuid(),
            decision: z.enum(["KEEP", "UPDATE", "SKIP", "REVIEW"]),
            verified: z.boolean(),
            proposed: productInput.optional(),
          }),
        )
        .max(IMPORT_REVIEW_MAX_CHANGES),
    })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      job && job.status === "AWAITING_REVIEW",
      409,
      "Import is not awaiting review",
    );
    for (const change of data.rows) {
      const row = await one(
        tx,
        "SELECT * FROM import_rows WHERE id=$1 AND job_id=$2",
        [change.id, id],
      );
      assert(row, 404, "Import row not found");
      const proposed = change.proposed
        ? validateProduct(change.proposed)
        : row.proposed;
      let duplicate = row.duplicate_id,
        version = row.expected_version;
      if (change.proposed) {
        const match = await one(
          tx,
          "SELECT id,version FROM products WHERE normalized_part=$1",
          [normalizePart(change.proposed.partNumber)],
        );
        duplicate = match?.id ?? null;
        version = match?.version ?? null;
      }
      await tx.query(
        "UPDATE import_rows SET proposed=$2,errors=$3,decision=$4,verified=$5,duplicate_id=$6,expected_version=$7 WHERE id=$1",
        [
          row.id,
          json(proposed),
          json(change.proposed ? [] : row.errors),
          change.decision,
          change.verified,
          duplicate,
          version,
        ],
      );
    }
    await tx.query(
      "UPDATE import_jobs SET version=version+1,updated_at=now() WHERE id=$1",
      [id],
    );
    return { ok: true };
  });
}
export async function confirmImport(
  db: DB,
  actor: Actor,
  id: string,
  version: number,
  token?: string,
) {
  requirePermission(actor, "IMPORT_CONFIRM");
  requirePermission(actor, "PRODUCT_EDIT");
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(job, 404, "Import not found");
    if (job.status === "IMPORTED") return { ok: true, alreadyImported: true };
    assert(
      job.status === "AWAITING_REVIEW" && job.version === version,
      409,
      "Import changed or is not awaiting review",
    );
    await tx.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
    await lockActor(tx, actor);
    if (token !== undefined) {
      const stamp = token.split(".")[0],
        age = Date.now() - Number(stamp);
      assert(
        Number.isFinite(age) && age >= 0 && age < 30 * 60 * 1000,
        409,
        "Import preview expired. Preview again",
      );
      const current = await confirmationState(tx, actor, id, stamp);
      assert(
        current.token === token,
        409,
        "Import, product, settings or permissions changed. Preview again",
      );
    }
    const rows = (
      await tx.query(
        "SELECT * FROM import_rows WHERE job_id=$1 ORDER BY row_number",
        [id],
      )
    ).rows;
    assert(rows.length > 0, 400, "Import has no rows");
    const seen = new Set<string>();
    const summary = { new: 0, updated: 0, skipped: 0 };
    await tx.query("UPDATE import_jobs SET status='CONFIRMED' WHERE id=$1", [
      id,
    ]);
    for (const row of rows) {
      assert(
        row.decision !== "REVIEW",
        400,
        `Row ${row.row_number} requires a decision`,
      );
      if (["KEEP", "SKIP"].includes(row.decision)) {
        summary.skipped++;
        continue;
      }
      assert(row.verified, 400, `Row ${row.row_number} must be verified`);
      assert(!row.errors.length, 400, `Row ${row.row_number} contains errors`);
      const p = validateProduct(productInput.parse(row.proposed));
      const normalized = normalizePart(p.partNumber);
      assert(
        !seen.has(normalized),
        409,
        `Duplicate within this file: ${p.partNumber}. Skip one row`,
      );
      seen.add(normalized);
      const current = await one(
        tx,
        "SELECT id,version FROM products WHERE normalized_part=$1",
        [normalized],
      );
      assert(
        (current?.id ?? null) === row.duplicate_id &&
          (current?.version ?? null) === row.expected_version,
        409,
        `Product changed since review: ${p.partNumber}`,
      );
      if (!current) {
        assert(
          job.mode === "CREATE_UPDATE",
          400,
          "Unknown part number: select Create & Update and review again",
        );
        requirePermission(actor, "PRODUCT_CREATE");
      }
      await saveProduct(
        tx,
        actor,
        p,
        current?.id,
        current?.version,
        "IMPORT",
        id,
      );
      current ? summary.updated++ : summary.new++;
    }
    await tx.query(
      "UPDATE import_jobs SET status='IMPORTED',summary=$2,version=version+1,updated_at=now() WHERE id=$1",
      [id, json(summary)],
    );
    await audit(
      tx,
      actor.id,
      job.kind + "_IMPORT",
      "import_jobs",
      id,
      null,
      summary,
    );
    return summary;
  });
}
export async function autoVerifyAndConfirmImport(
  db: DB,
  actor: Actor,
  id: string,
  version: number,
) {
  requirePermission(actor, "IMPORT_CONFIRM");
  requirePermission(actor, "PRODUCT_EDIT");
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(job, 404, "Import not found");
    if (job.status === "IMPORTED") return { ok: true, alreadyImported: true };
    assert(
      job.status === "AWAITING_REVIEW" && job.version === version,
      409,
      "Import changed or is not awaiting review",
    );
    if (job.mode === "CREATE_UPDATE")
      requirePermission(actor, "PRODUCT_CREATE");
    const quickImport = quickImportEnabled(job.defaults);

    await tx.query(
      `UPDATE import_rows 
       SET decision = 'UPDATE', verified = true 
       WHERE job_id = $1 AND (errors IS NULL OR coalesce(jsonb_array_length(errors), 0) = 0)`,
      [id],
    );
    await tx.query(
      `UPDATE import_rows 
       SET decision = 'SKIP', verified = false 
       WHERE job_id = $1 AND errors IS NOT NULL AND coalesce(jsonb_array_length(errors), 0) > 0`,
      [id],
    );

    await tx.query(
      "UPDATE import_jobs SET version = version + 1 WHERE id = $1",
      [id],
    );
    if (quickImport) return confirmImport(tx, actor, id, version + 1);
    return confirmImport(tx, actor, id, version + 1);
  });
}
export async function rollback(db: DB, actor: Actor, id: string) {
  requirePermission(actor, "IMPORT_CONFIRM");
  requirePermission(actor, "PRODUCT_EDIT");
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      job?.status === "IMPORTED",
      409,
      "Only completed imports can be rolled back",
    );
    await rollbackImportedJob(tx, actor, job);
    await tx.query(
      "UPDATE import_jobs SET status='ROLLED_BACK',version=version+1 WHERE id=$1",
      [id],
    );
    await audit(tx, actor.id, "IMPORT_ROLLBACK", "import_jobs", id);
    return { ok: true };
  });
}

async function rollbackImportedJob(tx: DB, actor: Actor, job: any) {
  const changes = (
    await tx.query(
      "SELECT * FROM price_history WHERE import_id=$1 ORDER BY created_at DESC",
      [job.id],
    )
  ).rows;
  for (const change of changes) {
    const current = await getProduct(tx, change.product_id);
    assert(
      current.version === change.resulting_version,
      409,
      `Rollback blocked: ${current.part_number} was edited after import. Review it manually`,
    );
  }
  for (const change of changes) {
    const current = await getProduct(tx, change.product_id);
    await saveProduct(
      tx,
      actor,
      change.before_value ?? { ...toInput(current), active: false },
      change.product_id,
      current.version,
      "ROLLBACK",
    );
  }
}

export async function reopen(db: DB, actor: Actor, id: string, input: unknown) {
  requirePermission(actor, "IMPORT_CONFIRM");
  requirePermission(actor, "PRODUCT_EDIT");
  const data = z.object({ version: importVersionSchema }).strict().parse(input);
  return db.transaction(async (tx) => {
    const job = await one(
      tx,
      "SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(job, 404, "Import not found");
    assert(
      ["IMPORTED", "ROLLED_BACK"].includes(job.status),
      409,
      "Only completed or rolled-back imports can be reopened",
    );
    assert(job.version === data.version, 409, "Import changed. Reload");
    if (job.status === "IMPORTED") await rollbackImportedJob(tx, actor, job);
    await tx.query(
      "UPDATE import_jobs SET status='AWAITING_REVIEW',version=version+1,updated_at=now() WHERE id=$1",
      [id],
    );
    await audit(
      tx,
      actor.id,
      "IMPORT_REOPEN",
      "import_jobs",
      id,
      { status: job.status },
      { status: "AWAITING_REVIEW" },
    );
    return { ok: true };
  });
}

export async function deleteImport(db: DB, actor: Actor, id: string) {
  requirePermission(actor, "IMPORT_CONFIRM");
  const uploadRoot = path.resolve(process.env.UPLOAD_DIR || ".data/uploads");
  let filePath = "";
  return db
    .transaction(async (tx) => {
      const job = await one(
        tx,
        "SELECT id,filename,file_path,status,version FROM import_jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      assert(job, 404, "Import not found");
      assert(
        !["PROCESSING", "CONFIRMED"].includes(job.status),
        409,
        "This import is busy. Wait for it to finish before deleting it",
      );
      filePath = path.resolve(job.file_path || "");
      const relative = path.relative(uploadRoot, filePath);
      assert(
        !!filePath &&
          !path.isAbsolute(relative) &&
          relative !== "" &&
          !relative.startsWith(".."),
        409,
        "Import file path is outside the upload directory",
      );
      await tx.query(
        "DELETE FROM jobs WHERE kind='IMPORT_EXTRACT' AND payload->>'importId'=$1",
        [id],
      );
      await tx.query("DELETE FROM import_rows WHERE job_id=$1", [id]);
      await tx.query("DELETE FROM import_jobs WHERE id=$1", [id]);
      await audit(tx, actor.id, "IMPORT_DELETE", "import_jobs", id, job, null);
      return { ok: true, filename: job.filename, status: job.status };
    })
    .then(async (result) => {
      await fs.rm(filePath, { force: true });
      return result;
    });
}
