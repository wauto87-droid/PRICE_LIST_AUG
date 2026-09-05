import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { AppError, assert } from "../core/errors";
import { audit, json } from "../core/audit";
import {
  type Actor,
  has,
  pricingPolicy,
  requirePermission,
  lockActor,
} from "../auth/service";
import {
  lineInput,
  customLineInput,
  decimal,
  percent,
  calculate,
  calculateCustom,
  normalizePart,
  totals,
} from "../pricing/engine";
const deliveryImportMeta = z
  .object({
    source: z.literal("DELIVERY_NOTE").default("DELIVERY_NOTE"),
    rowId: z.string().uuid().optional(),
    rowNumber: z.coerce.number().int().positive().optional(),
    docNo: z.string().max(200).default(""),
    docDate: z.string().max(100).default(""),
    sourcePartNumber: z.string().max(100).optional(),
    unresolved: z.boolean().default(false),
  })
  .passthrough();

const catalogLineInput = lineInput.extend({
  type: z.literal("CATALOG").optional(),
  importMeta: deliveryImportMeta.optional(),
});
const savedCustomLineInput = customLineInput.extend({
  importMeta: deliveryImportMeta.optional(),
});
const unresolvedImportedCustomLineInput = z
  .object({
    type: z.literal("CUSTOM"),
    partNumber: z.string().trim().max(100).default(""),
    description: z.string().trim().min(1).max(1000),
    unit: z.string().trim().min(1).max(20).default("pcs"),
    quantity: decimal,
    unitPriceExcl: z
      .union([z.literal(""), z.undefined(), z.literal("0"), decimal])
      .default("0"),
    discount: percent.default("0"),
    vat: percent.optional(),
    reusableItemId: z.string().uuid().optional(),
    watcherEventId: z.string().uuid().optional(),
    importMeta: deliveryImportMeta.extend({
      unresolved: z.literal(true),
    }),
  })
  .passthrough();
const quotationLineInput = z.union([
  catalogLineInput,
  savedCustomLineInput,
  unresolvedImportedCustomLineInput,
]);
const quoteAdjustmentInput = z
  .object({
    targetTotal: z.union([decimal, z.literal("")]).default(""),
  })
  .strict()
  .default({ targetTotal: "" });
import { getProduct, toInput } from "../products/service";
import { allocateNumber } from "./settings";
import { attachToSavedQuote } from "../reusable-custom/service";
import { syncQuotationEvents } from "../price-watcher/service";
export const quoteInput = z
  .object({
    customer: z
      .object({
        name: z.string().max(150).default(""),
        number: z.string().max(80).default(""),
        mobile: z.string().max(50).default(""),
        reference: z.string().max(200).default(""),
        notes: z.string().max(1000).default(""),
      })
      .strict(),
    lines: z.array(quotationLineInput).min(1).max(200),
    adjustment: quoteAdjustmentInput.optional().default({ targetTotal: "" }),
  })
  .strict();
// Pre-migration snapshots used the one original price, migrated to End Customer.
export const savedLineInput = (line: any) =>
  line.source === "CUSTOM" || line.input?.type === "CUSTOM"
    ? { ...line.input, type: "CUSTOM" }
    : {
        ...line.input,
        type: line.input?.type ?? "CATALOG",
        sellingLevel:
          line.input.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER",
      };
export const duplicateLineInput = (line: any) =>
  line.source === "CUSTOM" || line.input?.type === "CUSTOM"
    ? savedLineInput(line)
    : { ...savedLineInput(line), override: false, reason: "" };

const unresolvedImportedCustom = (line: any) =>
  line?.type === "CUSTOM" &&
  line?.importMeta?.source === "DELIVERY_NOTE" &&
  line?.importMeta?.unresolved &&
  !String(line?.unitPriceExcl ?? "").trim();

function computeTotals(lines: any[], targetTotalInput = "") {
  const base = totals(
    lines.flatMap((line) => (line.price ? [line.price] : [])),
  );
  const unresolvedLines = lines.filter((line) => !line.price).length;
  const targetRaw = String(targetTotalInput ?? "").trim();
  if (!targetRaw)
    return {
      ...base,
      lineSubtotal: base.subtotal,
      lineVat: base.vat,
      lineTotal: base.total,
      quoteDiscount: "0.00",
      targetTotal: "",
      unresolvedLines,
    };
  if (unresolvedLines)
    throw new AppError(
      409,
      "Enter prices for imported delivery rows before using a round-off total",
    );
  const baseTotal = new Decimal(base.total);
  const target = new Decimal(targetRaw).toDecimalPlaces(2);
  assert(
    target.lte(baseTotal),
    400,
    "Round-off total cannot exceed the current quotation total",
  );
  const discount = baseTotal.sub(target).toDecimalPlaces(2);
  if (discount.isZero())
    return {
      ...base,
      lineSubtotal: base.subtotal,
      lineVat: base.vat,
      lineTotal: base.total,
      quoteDiscount: "0.00",
      targetTotal: target.toFixed(2),
      unresolvedLines,
    };
  const subtotal = new Decimal(base.subtotal)
    .mul(target.div(baseTotal))
    .toDecimalPlaces(2);
  const vat = target.sub(subtotal).toDecimalPlaces(2);
  return {
    subtotal: subtotal.toFixed(2),
    vat: vat.toFixed(2),
    total: target.toFixed(2),
    lineSubtotal: base.subtotal,
    lineVat: base.vat,
    lineTotal: base.total,
    quoteDiscount: discount.toFixed(2),
    targetTotal: target.toFixed(2),
    unresolvedLines,
  };
}

export const quoteHasUnresolvedLines = (q: any) =>
  Array.isArray(q?.lines) && q.lines.some((line: any) => !line?.price);

export function assertQuoteReadyForOutput(q: any) {
  assert(
    !quoteHasUnresolvedLines(q),
    409,
    "Enter prices for imported delivery rows before printing or issuing this quotation",
  );
}

export async function snapshot(
  db: DB,
  actor: Actor,
  lines: z.infer<typeof quotationLineInput>[],
  settings: any,
  options: { allowUnresolvedImportedCustom?: boolean } = {},
) {
  const result = [];
  await lockActor(db, actor);
  const catalogLines = lines.filter(
    (line): line is z.infer<typeof catalogLineInput> => line.type !== "CUSTOM",
  );
  await db.query(
    "SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [[...new Set(catalogLines.map((l) => l.productId))]],
  );
  for (const input of lines) {
    const watcherEventId = input.watcherEventId ?? randomUUID();
    if (input.type === "CUSTOM") {
      const capturedVat = input.vat ?? settings.vat;
      const importMeta = input.importMeta
        ? {
            ...input.importMeta,
            unresolved: unresolvedImportedCustom(input),
          }
        : undefined;
      if (unresolvedImportedCustom(input)) {
        assert(
          options.allowUnresolvedImportedCustom,
          409,
          `Imported delivery row ${input.importMeta?.rowNumber ?? ""}${input.importMeta?.docNo ? ` (${input.importMeta.docNo})` : ""} still needs a unit price before issuing`,
        );
        result.push({
          source: "CUSTOM",
          partNumber: input.partNumber || "CUSTOM",
          description: input.description,
          unit: input.unit,
          quantityPrecision: 6,
          input: { ...input, watcherEventId, vat: capturedVat, importMeta },
          price: null,
          unresolved: true,
          timestamp: new Date().toISOString(),
        });
        continue;
      }
      if (input.partNumber) {
        const normalized = normalizePart(input.partNumber);
        const existing = await one(
          db,
          `SELECT p.id,p.part_number FROM products p WHERE p.normalized_part=$1
           UNION ALL
           SELECT p.id,p.part_number FROM product_aliases a JOIN products p ON p.id=a.product_id WHERE a.normalized=$1
           LIMIT 1`,
          [normalized],
        );
        if (existing)
          throw new AppError(
            409,
            `Part reference matches catalog item ${existing.part_number}. Use the catalog item instead`,
            {
              code: "CATALOG_MATCH",
              productId: existing.id,
              partNumber: existing.part_number,
            },
          );
      }
      const price = calculateCustom(input, capturedVat);
      result.push({
        source: "CUSTOM",
        partNumber: input.partNumber || "CUSTOM",
        description: input.description,
        unit: input.unit,
        quantityPrecision: 6,
        importMeta,
        input: { ...input, watcherEventId, vat: capturedVat, importMeta },
        price,
        timestamp: new Date().toISOString(),
      });
      continue;
    }
    const row = await getProduct(db, input.productId);
    assert(row.active, 409, `Product is archived: ${row.part_number}`);
    const p = toInput(row),
      calculation = calculate(p, pricingPolicy(actor), input);
    result.push({
      source: "CATALOG",
      productId: row.id,
      partNumber: p.partNumber,
      description: p.description,
      unit: p.unit,
      quantityPrecision: p.quantityPrecision,
      productVersion: row.version,
      sellingLevel: calculation.sellingLevel,
      importMeta: input.importMeta,
      input: {
        ...input,
        watcherEventId,
        sellingLevel: calculation.sellingLevel,
        importMeta: input.importMeta,
      },
      price: calculation,
      internalPricing: {
        minimumEnabled: p.minimumEnabled,
        minimum: p.minimum,
        discountLimit: calculation.maxDiscount,
        discountLimitSource: calculation.discountLimitSource,
      },
      timestamp: new Date().toISOString(),
    });
  }
  return result;
}
function publicLine(line: any, actor: Actor) {
  if (!line.price) {
    const { internalPricing, ...safe } = line;
    return { ...safe, price: null };
  }
  const { maxDiscount, ...price } = line.price;
  const { internalPricing, ...safe } = line;
  return {
    ...safe,
    price: {
      ...price,
      ...(has(actor, "MIN_PRICE_VIEW") ? { maxDiscount } : {}),
    },
  };
}
export function publicQuote(q: any, actor: Actor) {
  return {
    ...q,
    internalReference: q.internal_reference,
    totals: {
      quoteDiscount: "0.00",
      targetTotal: "",
      unresolvedLines: 0,
      ...(q.totals ?? {}),
    },
    lines: q.lines.map((l: any) => publicLine(l, actor)),
  };
}
export async function getQuote(db: DB, actor: Actor, id: string, edit = false) {
  const q = await one(db, "SELECT * FROM quotations WHERE id=$1", [id]);
  assert(q && q.status !== "DELETED", 404, "Quotation not found");
  assert(
    q.owner_id === actor.id ||
      has(actor, edit ? "QUOTE_EDIT_ALL" : "QUOTE_VIEW_ALL"),
    403,
    "This quotation belongs to another user",
  );
  if (["DRAFT", "REJECTED"].includes(q.status)) {
    const productIds = [
      ...new Set(
        q.lines
          .filter((line: any) => line.source !== "CUSTOM" && line.productId)
          .map((line: any) => line.productId as string),
      ),
    ];
    if (productIds.length) {
      const levels = (
        await db.query(
          "SELECT product_id,code,method FROM product_selling_levels WHERE product_id=ANY($1::uuid[])",
          [productIds],
        )
      ).rows;
      const methods = new Map(
        levels.map((level) => [`${level.product_id}:${level.code}`, level.method]),
      );
      q.lines = q.lines.map((line: any) => {
        if (!line.price || line.source === "CUSTOM" || !line.productId) return line;
        const code =
          line.input?.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER";
        const method = methods.get(`${line.productId}:${code}`);
        return method
          ? {
              ...line,
              price: {
                ...line.price,
                adjustmentMode:
                  method === "COST_MARKUP" ? "MARKUP" : "DISCOUNT",
              },
            }
          : line;
      });
    }
  }
  return q;
}
export async function nextDraftNumber(db: DB, settings: any) {
  // PostgreSQL sequences do not roll back, so allocated numbers are never
  // reused after a failed or deleted draft.
  for (;;) {
    const row = await one(
      db,
      "SELECT nextval('draft_serial_seq')::text AS serial",
    );
    const number = `${settings.draftPrefix}-${row!.serial.padStart(4, "0")}`;
    if (!(await one(db, "SELECT id FROM quotations WHERE number=$1", [number])))
      return number;
  }
}
export async function nextInternalReference(db: DB) {
  // Sequence values are never reused, including after a failed transaction.
  const row = await one(
    db,
    "SELECT nextval('quotation_internal_reference_seq')::text AS serial",
  );
  return `QID-${row!.serial.padStart(6, "0")}`;
}
export async function saveDraft(
  db: DB,
  actor: Actor,
  input: unknown,
  settings: any,
  id?: string,
  version?: number,
  requestId?: string,
) {
  requirePermission(actor, id ? "QUOTE_EDIT" : "QUOTE_CREATE");
  const parsed = quoteInput.parse(input);
  const normalizedCustomer = { ...parsed.customer, number: parsed.customer.number.trim() };
  const data = {
    ...parsed,
    customer: parsed.customer.name.trim() || normalizedCustomer.number
      ? normalizedCustomer
      : { ...normalizedCustomer, number: "1" },
  };
  return db.transaction(async (tx) => {
    settings = (await one(
      tx,
      "SELECT data FROM settings WHERE id=1 FOR SHARE",
    ))!.data;
    if (!id && requestId) {
      z.string().uuid().parse(requestId);
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor.id]);
      const previous = await one(
        tx,
        "SELECT response FROM idempotency_keys WHERE user_id=$1 AND key=$2",
        [actor.id, requestId],
      );
      if (previous) {
        assert(
          previous.response.inputHash ===
            createHash("sha256").update(json(data)).digest("hex"),
          409,
          "This draft was already saved with different values. Reopen it from Quotations before editing",
        );
        return publicQuote(
          await getQuote(tx, actor, previous.response.quoteId),
          actor,
        );
      }
    }
    let oldLines: any[] = [];
    if (id) {
      await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [id]);
      const old = await getQuote(tx, actor, id, true);
      oldLines = old.lines;
      assert(["DRAFT", "REJECTED"].includes(old.status), 409, "Only draft or rejected quotations can be edited");
      assert(
        old.version === version,
        409,
        "Draft changed on another device. Reload before saving",
      );
    }
    if (data.customer.number && data.customer.number !== "1" && data.customer.name.trim()) {
      const savedCustomer = await one(tx, "SELECT id FROM customers WHERE btrim(number)=$1 ORDER BY id LIMIT 1", [data.customer.number]);
      if (savedCustomer)
        await tx.query("UPDATE customers SET name=$2,mobile=$3,reference=$4 WHERE id=$1", [savedCustomer.id, data.customer.name, data.customer.mobile, data.customer.reference]);
      else
        await tx.query("INSERT INTO customers(id,name,number,mobile,reference) VALUES($1,$2,$3,$4,$5)", [randomUUID(), data.customer.name, data.customer.number, data.customer.mobile, data.customer.reference]);
    }
    const lines = await attachToSavedQuote(
      tx,
      actor,
      await snapshot(tx, actor, data.lines, settings, {
        allowUnresolvedImportedCustom: true,
      }),
      oldLines,
    );
    const sum = computeTotals(lines, data.adjustment?.targetTotal);
    const quoteId = id ?? randomUUID();
    if (id)
      await tx.query(
        "UPDATE quotations SET customer=$2,lines=$3,totals=$4,status='DRAFT',version=version+1,updated_at=now() WHERE id=$1",
        [id, json(data.customer), json(lines), json(sum)],
      );
    else
      await tx.query(
        "INSERT INTO quotations(id,number,internal_reference,status,owner_id,customer,lines,totals) VALUES($1,$2,$3,'DRAFT',$4,$5,$6,$7)",
        [
          quoteId,
          await nextDraftNumber(tx, settings),
          await nextInternalReference(tx),
          actor.id,
          json(data.customer),
          json(lines),
          json(sum),
        ],
      );
    for (const line of lines)
      if (line.source === "CATALOG" && line.price.overridden)
        await audit(
          tx,
          actor.id,
          "MIN_PRICE_OVERRIDE",
          "quotations",
          quoteId,
          null,
          { productId: line.productId, price: line.price.finalExcl },
          line.input.type === "CUSTOM" ? null : line.input.reason,
        );
    await audit(
      tx,
      actor.id,
      id ? "DRAFT_EDIT" : "DRAFT_CREATE",
      "quotations",
      quoteId,
    );
    if (!id && requestId)
      await tx.query(
        "INSERT INTO idempotency_keys(user_id,key,response) VALUES($1,$2,$3)",
        [
          actor.id,
          requestId,
          json({
            quoteId,
            inputHash: createHash("sha256").update(json(data)).digest("hex"),
          }),
        ],
      );
    const saved = await getQuote(tx, actor, quoteId);
    await syncQuotationEvents(tx, saved);
    return publicQuote(saved, actor);
  });
}
const fingerprint = (q: any, lines: any[], actor: Actor, settings: any) =>
  createHash("sha256")
    .update(
      json({
        id: q.id,
        version: q.version,
        lines: lines.map(({ timestamp, ...l }) => l),
        targetTotal: q.totals?.targetTotal ?? "",
        permissions: actor.permissions,
        maxDiscount: actor.maxDiscount,
        settings,
      }),
    )
    .digest("hex");
export async function reviewIssue(
  db: DB,
  actor: Actor,
  id: string,
  settings: any,
) {
  requirePermission(actor, "QUOTE_ISSUE");
  return db.transaction(async (tx) => {
    settings = (await one(
      tx,
      "SELECT data FROM settings WHERE id=1 FOR SHARE",
    ))!.data;
    const q = await getQuote(tx, actor, id, true);
    const activeRules = Number((await one(tx, "SELECT count(*) n FROM approval_rules WHERE active"))?.n ?? 0);
    assert(q.status === "APPROVED" || (q.status === "DRAFT" && activeRules === 0), 409, activeRules ? "Quotation approval is required before issue" : "Only drafts can be issued");
    const lines = await snapshot(
      tx,
      actor,
      q.lines.map(savedLineInput),
      settings,
      {},
    );
    return {
      token: fingerprint(q, lines, actor, settings),
      version: q.version,
      before: publicQuote(q, actor),
      after: lines.map((l) => publicLine(l, actor)),
      totals: computeTotals(lines, q.totals?.targetTotal),
    };
  });
}
export async function issue(
  db: DB,
  actor: Actor,
  id: string,
  token: string,
  settings: any,
) {
  requirePermission(actor, "QUOTE_ISSUE");
  return db.transaction(async (tx) => {
    settings = (await one(
      tx,
      "SELECT data FROM settings WHERE id=1 FOR SHARE",
    ))!.data;
    await tx.query("SELECT id FROM quotations WHERE id=$1 FOR UPDATE", [id]);
    const q = await getQuote(tx, actor, id, true);
    const activeRules = Number((await one(tx, "SELECT count(*) n FROM approval_rules WHERE active"))?.n ?? 0);
    assert(q.status === "APPROVED" || (q.status === "DRAFT" && activeRules === 0), 409, activeRules ? "Quotation approval is required before issue" : "Only drafts can be issued");
    const lines = await snapshot(
      tx,
      actor,
      q.lines.map(savedLineInput),
      settings,
      {},
    );
    assert(
      fingerprint(q, lines, actor, settings) === token,
      409,
      "Pricing or permissions changed. Review again before issuing",
    );
    const customer = {
      ...q.customer,
      name: q.customer.name || (!q.customer.number || q.customer.number.trim() === "1" ? "Walk-in Customer" : ""),
    };
    const allocated = await allocateNumber(tx, id, actor, settings);
    const logo =
      settings.quotation?.logo ||
      "data:image/svg+xml;base64," +
        (
          await fs.readFile(path.join(process.cwd(), "public", "logo.svg"))
        ).toString("base64");
    await tx.query(
      "UPDATE quotations SET status='ISSUED',number=$2,lines=$3,totals=$4,company_snapshot=$5,customer=$6,serial=$7,issued_at=now(),updated_at=now(),version=version+1 WHERE id=$1",
      [
        id,
        allocated.number,
        json(lines),
        json(computeTotals(lines, q.totals?.targetTotal)),
        json({ ...settings, brandingAssets: { logo } }),
        json(customer),
        allocated.serial,
      ],
    );
    for (const line of lines)
      if (line.source === "CATALOG" && line.price?.overridden)
        await audit(
          tx,
          actor.id,
          "MIN_PRICE_OVERRIDE",
          "quotations",
          id,
          null,
          { productId: line.productId, price: line.price.finalExcl },
          line.input.type === "CUSTOM" ? null : line.input.reason,
        );
    await audit(tx, actor.id, "QUOTATION_ISSUE", "quotations", id);
    const issued = await getQuote(tx, actor, id);
    await syncQuotationEvents(tx, issued);
    return publicQuote(issued, actor);
  });
}
