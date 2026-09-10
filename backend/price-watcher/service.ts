import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { type Actor, pricingPolicy, requirePermission } from "../auth/service";
import { audit, json } from "../core/audit";
import {
  calculate,
  calculateCustom,
  customLineInput,
  lineInput,
  normalizePart,
} from "../pricing/engine";
import { getProduct, toInput } from "../products/service";
import {
  activityColumns,
  groupColumns,
  staffColumns,
} from "../../shared/price-watch";

const lookupSchema = z
  .object({
    interactionId: z.string().uuid(),
    calculationId: z.string().uuid().optional(),
    line: lineInput,
  })
  .strict();
const cartSchema = z
  .object({
    interactionId: z.string().uuid().optional(),
    line: z.union([lineInput, customLineInput]),
  })
  .strict();
const filtersSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    actorId: z.string().uuid().optional(),
    query: z.string().trim().max(100).default(""),
    customer: z.string().trim().max(100).default(""),
    stage: z.enum(["ALL", "LOOKUP", "CART", "DRAFT", "ISSUED"]).default("ALL"),
    source: z.enum(["ALL", "CATALOG", "CUSTOM"]).default("ALL"),
    sellingLevel: z
      .enum(["ALL", "WHOLESALE", "RETAIL", "END_CUSTOMER", "CUSTOM"])
      .default("ALL"),
    minDiscount: z.coerce.number().min(0).max(100).optional(),
    maxDiscount: z.coerce.number().min(0).max(100).optional(),
    itemKey: z.string().max(300).optional(),
    page: z.coerce.number().int().min(0).default(0),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    view: z.enum(["ACTIVITY", "GROUPS"]).default("ACTIVITY"),
    sort: z.string().default(""),
    direction: z.enum(["asc", "desc"]).default("desc"),
    staffSort: z.string().default("subtotal"),
    staffDirection: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

const stageRank: Record<string, number> = {
  LOOKUP: 1,
  CART: 2,
  DRAFT: 3,
  ISSUED: 4,
};

function normalizedCustom(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

function customKey(line: any) {
  if (line.reusableItemId) return `REUSABLE:${line.reusableItemId}`;
  if (line.partNumber) return `CUSTOM-REF:${normalizedCustom(line.partNumber)}`;
  return `CUSTOM-DESC:${normalizedCustom(line.description)}`;
}

async function upsertEvent(
  db: DB,
  input: {
    id: string;
    actorId: string;
    stage: "LOOKUP" | "CART" | "DRAFT" | "ISSUED";
    source: "CATALOG" | "CUSTOM";
    productId?: string;
    reusableItemId?: string;
    itemKey: string;
    partNumber: string;
    description: string;
    unit: string;
    sellingLevel: string;
    price: any;
    quotationId?: string;
    quotationLineIndex?: number;
    customerName?: string;
    quoteRoundOff?: string;
  },
) {
  const existing = await one(
    db,
    "SELECT actor_id FROM price_watch_events WHERE id=$1",
    [input.id],
  );
  assert(
    !existing || existing.actor_id === input.actorId,
    409,
    "Price interaction belongs to another user",
  );
  await db.query(
    `INSERT INTO price_watch_events(
       id,actor_id,stage,source,product_id,reusable_item_id,item_key,part_number,description,unit,
       selling_level,quantity,master_excl,final_excl,final_incl,requested_discount,effective_discount,requested_markup,effective_markup,adjustment_mode,
       vat_rate,subtotal,total,minimum_reached,discount_limited,quotation_id,quotation_line_index,
       customer_name,quote_round_off
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     ON CONFLICT(id) DO UPDATE SET
       stage=CASE WHEN
         CASE EXCLUDED.stage WHEN 'ISSUED' THEN 4 WHEN 'DRAFT' THEN 3 WHEN 'CART' THEN 2 ELSE 1 END >=
         CASE price_watch_events.stage WHEN 'ISSUED' THEN 4 WHEN 'DRAFT' THEN 3 WHEN 'CART' THEN 2 ELSE 1 END
         THEN EXCLUDED.stage ELSE price_watch_events.stage END,
       source=EXCLUDED.source,product_id=EXCLUDED.product_id,reusable_item_id=EXCLUDED.reusable_item_id,
       item_key=EXCLUDED.item_key,part_number=EXCLUDED.part_number,description=EXCLUDED.description,
       unit=EXCLUDED.unit,selling_level=EXCLUDED.selling_level,quantity=EXCLUDED.quantity,
       master_excl=EXCLUDED.master_excl,final_excl=EXCLUDED.final_excl,final_incl=EXCLUDED.final_incl,
       requested_discount=EXCLUDED.requested_discount,effective_discount=EXCLUDED.effective_discount,
       requested_markup=EXCLUDED.requested_markup,effective_markup=EXCLUDED.effective_markup,adjustment_mode=EXCLUDED.adjustment_mode,
       vat_rate=EXCLUDED.vat_rate,subtotal=EXCLUDED.subtotal,total=EXCLUDED.total,
       minimum_reached=EXCLUDED.minimum_reached,discount_limited=EXCLUDED.discount_limited,
       quotation_id=COALESCE(EXCLUDED.quotation_id,price_watch_events.quotation_id),
       quotation_line_index=COALESCE(EXCLUDED.quotation_line_index,price_watch_events.quotation_line_index),
       customer_name=CASE WHEN EXCLUDED.customer_name<>'' THEN EXCLUDED.customer_name ELSE price_watch_events.customer_name END,
       quote_round_off=GREATEST(EXCLUDED.quote_round_off,price_watch_events.quote_round_off),
       revision_count=price_watch_events.revision_count+1,last_seen_at=now(),updated_at=now()`,
    [
      input.id,
      input.actorId,
      input.stage,
      input.source,
      input.productId ?? null,
      input.reusableItemId ?? null,
      input.itemKey,
      input.partNumber,
      input.description,
      input.unit,
      input.sellingLevel,
      input.price.quantity,
      input.price.masterExcl,
      input.price.finalExcl,
      input.price.finalIncl,
      input.price.requestedDiscount,
      input.price.effectiveDiscount,
      input.price.requestedMarkup ?? "0",
      input.price.effectiveMarkup ?? "0",
      input.price.adjustmentMode ?? "DISCOUNT",
      input.price.vatRate,
      input.price.subtotal,
      input.price.total,
      Boolean(input.price.minimumReached),
      Boolean(input.price.discountLimited),
      input.quotationId ?? null,
      input.quotationLineIndex ?? null,
      input.customerName ?? "",
      input.quoteRoundOff ?? "0",
    ],
  );
}

export async function captureLookup(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "PRODUCT_VIEW");
  const input = lookupSchema.parse(raw);
  return db.transaction(async (tx) => {
    // Older clients remain supported; new clients retain a calculation ID for retries.
    const calculationId = input.calculationId ?? randomUUID();
    const previous = await one(
      tx,
      "SELECT actor_id,event_id,request FROM price_lookup_history WHERE id=$1",
      [calculationId],
    );
    if (previous) {
      assert(
        previous.actor_id === actor.id &&
          previous.event_id === input.interactionId &&
          isDeepStrictEqual(previous.request, JSON.parse(json(input.line))),
        409,
        "Calculation ID already used",
      );
      return { ok: true, interactionId: input.interactionId, calculationId };
    }
    const product = await getProduct(tx, input.line.productId);
    assert(product.active, 409, "Product is archived");
    const price = calculate(toInput(product), pricingPolicy(actor), input.line);
    const existing = await one(
      tx,
      "SELECT actor_id,stage FROM price_watch_events WHERE id=$1 FOR UPDATE",
      [input.interactionId],
    );
    assert(
      !existing || existing.actor_id === actor.id,
      409,
      "Price interaction belongs to another user",
    );
    if (!existing || existing.stage === "LOOKUP")
      await upsertEvent(tx, {
        id: input.interactionId,
        actorId: actor.id,
        stage: "LOOKUP",
        source: "CATALOG",
        productId: product.id,
        itemKey: `CATALOG:${product.id}`,
        partNumber: product.part_number,
        description: product.description,
        unit: product.unit,
        sellingLevel: price.sellingLevel,
        price,
      });
    const snapshot = {
      product_id: product.id,
      item_key: `CATALOG:${product.id}`,
      part_number: product.part_number,
      description: product.description,
      unit: product.unit,
      selling_level: price.sellingLevel,
      source: "CATALOG",
      quantity: price.quantity,
      master_excl: price.masterExcl,
      final_excl: price.finalExcl,
      final_incl: price.finalIncl,
      subtotal: price.subtotal,
      total: price.total,
      requested_discount: price.requestedDiscount,
      effective_discount: price.effectiveDiscount,
      requested_markup: price.requestedMarkup ?? "0",
      effective_markup: price.effectiveMarkup ?? "0",
      adjustment_mode: price.adjustmentMode ?? "DISCOUNT",
      vat_rate: price.vatRate,
      minimum_reached: price.minimumReached,
      discount_limited: price.discountLimited,
    };
    await tx.query(
      `INSERT INTO price_lookup_history(id,event_id,actor_id,snapshot,request)
    SELECT $1,e.id,$3,to_jsonb(e)||$4::jsonb,$5::jsonb FROM price_watch_events e WHERE e.id=$2
    ON CONFLICT(id) DO NOTHING`,
      [
        calculationId,
        input.interactionId,
        actor.id,
        json(snapshot),
        json(input.line),
      ],
    );
    const saved = await one(
      tx,
      "SELECT actor_id,event_id,request FROM price_lookup_history WHERE id=$1",
      [calculationId],
    );
    assert(
      saved?.actor_id === actor.id &&
        saved.event_id === input.interactionId &&
        isDeepStrictEqual(saved.request, JSON.parse(json(input.line))),
      409,
      "Calculation ID already used",
    );
    return { ok: true, interactionId: input.interactionId, calculationId };
  });
}

export async function captureCart(
  db: DB,
  actor: Actor,
  raw: unknown,
  vat: string,
) {
  requirePermission(actor, "QUOTE_CREATE");
  const input = cartSchema.parse(raw);
  const id = input.interactionId ?? input.line.watcherEventId ?? randomUUID();
  if ("type" in input.line && input.line.type === "CUSTOM") {
    const custom = input.line as z.infer<typeof customLineInput>;
    const price = calculateCustom(custom, custom.vat ?? vat);
    await upsertEvent(db, {
      id,
      actorId: actor.id,
      stage: "CART",
      source: "CUSTOM",
      reusableItemId: custom.reusableItemId,
      itemKey: customKey(custom),
      partNumber: custom.partNumber,
      description: custom.description,
      unit: custom.unit,
      sellingLevel: "CUSTOM",
      price,
    });
  } else {
    const catalog = input.line as z.infer<typeof lineInput>;
    const product = await getProduct(db, catalog.productId);
    const price = calculate(toInput(product), pricingPolicy(actor), catalog);
    await upsertEvent(db, {
      id,
      actorId: actor.id,
      stage: "CART",
      source: "CATALOG",
      productId: product.id,
      itemKey: `CATALOG:${product.id}`,
      partNumber: product.part_number,
      description: product.description,
      unit: product.unit,
      sellingLevel: price.sellingLevel,
      price,
    });
  }
  return { ok: true, interactionId: id };
}

export async function syncQuotationEvents(db: DB, quotation: any) {
  const stage = quotation.status === "ISSUED" ? "ISSUED" : "DRAFT";
  for (let index = 0; index < quotation.lines.length; index++) {
    const line = quotation.lines[index];
    if (!line.price) continue;
    const source = line.source === "CUSTOM" ? "CUSTOM" : "CATALOG";
    const id = line.input?.watcherEventId ?? randomUUID();
    line.input = { ...line.input, watcherEventId: id };
    await upsertEvent(db, {
      id,
      actorId: quotation.owner_id,
      stage,
      source,
      productId: source === "CATALOG" ? line.productId : undefined,
      reusableItemId: line.input?.reusableItemId,
      itemKey:
        source === "CATALOG"
          ? `CATALOG:${line.productId}`
          : customKey(line.input ?? line),
      partNumber: line.partNumber ?? "",
      description: line.description,
      unit: line.unit,
      sellingLevel: line.sellingLevel ?? line.price.sellingLevel ?? "CUSTOM",
      price: line.price,
      quotationId: quotation.id,
      quotationLineIndex: index,
      customerName: quotation.customer?.name ?? "",
      quoteRoundOff: quotation.totals?.quoteDiscount ?? "0",
    });
  }
}

function filteredWhere(actor: Actor, raw: unknown, personal = false) {
  requirePermission(actor, personal ? "PRODUCT_VIEW" : "PRICE_WATCHER");
  const value = filtersSchema.parse(raw);
  assert(
    value.minDiscount === undefined ||
      value.maxDiscount === undefined ||
      value.minDiscount <= value.maxDiscount,
    400,
    "Minimum discount must not exceed maximum discount",
  );
  const args: any[] = [];
  const bind = (item: unknown) => {
    args.push(item);
    return `$${args.length}`;
  };
  const from = bind(value.from ?? null);
  const to = bind(value.to ?? null);
  const conditions = [
    `e.last_seen_at>=COALESCE(${from}::date::timestamp AT TIME ZONE 'Asia/Riyadh',now()-interval '90 days')`,
    `(${to}::date IS NULL OR e.last_seen_at<((${to}::date+1)::timestamp AT TIME ZONE 'Asia/Riyadh'))`,
  ];
  if (personal)
    conditions.push(`e.actor_id=${bind(actor.id)}`, "e.stage='LOOKUP'");
  if (value.actorId) conditions.push(`e.actor_id=${bind(value.actorId)}`);
  if (value.stage !== "ALL") conditions.push(`e.stage=${bind(value.stage)}`);
  if (value.source !== "ALL") conditions.push(`e.source=${bind(value.source)}`);
  if (value.sellingLevel !== "ALL")
    conditions.push(`e.selling_level=${bind(value.sellingLevel)}`);
  if (value.minDiscount !== undefined)
    conditions.push(`e.effective_discount>=${bind(value.minDiscount)}`);
  if (value.maxDiscount !== undefined)
    conditions.push(`e.effective_discount<=${bind(value.maxDiscount)}`);
  if (value.itemKey) conditions.push(`e.item_key=${bind(value.itemKey)}`);
  if (value.query) {
    const q = bind(`%${value.query.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `(e.part_number ILIKE ${q} ESCAPE '\\' OR e.description ILIKE ${q} ESCAPE '\\')`,
    );
  }
  if (value.customer) {
    const q = bind(`%${value.customer.replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(`e.customer_name ILIKE ${q} ESCAPE '\\'`);
  }
  return { value, args, where: conditions.join(" AND "), bind };
}

function ordered(
  field: string,
  direction: string,
  columns: { key: string; kind?: string }[],
  fallback: string,
  prefix = "",
) {
  const key = field || fallback;
  const column = columns.find((c) => c.key === key);
  assert(column, 400, "Unsupported sort column");
  const cast =
    column.kind === "number" || column.kind === "percent" ? "::numeric" : "";
  return `${prefix}${key}${cast} ${direction === "asc" ? "ASC" : "DESC"} NULLS LAST`;
}

export async function activity(
  db: DB,
  actor: Actor,
  raw: unknown,
  personal = false,
) {
  const f = filteredWhere(actor, raw, personal);
  const count = await one(
    db,
    `SELECT count(*)::int AS total FROM price_watch_activity e WHERE ${f.where}`,
    f.args,
  );
  const total = count?.total ?? 0,
    totalPages = Math.max(1, Math.ceil(total / f.value.pageSize));
  const page = Math.min(f.value.page, totalPages - 1);
  const order = ordered(
    f.value.sort,
    f.value.direction,
    activityColumns,
    "last_seen_at",
    "r.",
  );
  const limit = f.bind(f.value.pageSize),
    offset = f.bind(page * f.value.pageSize);
  const items = (
    await db.query(
      `SELECT * FROM (
    SELECT e.*,COALESCE(NULLIF(u.name,''),u.username) AS staff_name,q.number AS quotation_number
    FROM price_watch_activity e JOIN users u ON u.id=e.actor_id LEFT JOIN quotations q ON q.id=e.quotation_id
    WHERE ${f.where}) r ORDER BY ${order},r.id ASC LIMIT ${limit} OFFSET ${offset}`,
      f.args,
    )
  ).rows;
  return { items, total, totalPages, page, pageSize: f.value.pageSize };
}

export async function dashboard(db: DB, actor: Actor, raw: unknown) {
  const filter = filteredWhere(actor, raw);
  const groupOrder = ordered(
    filter.value.view === "GROUPS" ? filter.value.sort : "",
    filter.value.direction,
    groupColumns,
    "latest_at",
    "r.",
  );
  const staffOrder = ordered(
    filter.value.staffSort,
    filter.value.staffDirection,
    staffColumns,
    "subtotal",
    "r.",
  );
  const summary = await one(
    db,
    `SELECT count(*)::int AS events,count(DISTINCT quotation_id)::int AS quotations,
            count(DISTINCT NULLIF(customer_name,''))::int AS customers,
            count(DISTINCT item_key)::int AS items,COALESCE(sum(quantity),0)::text AS quantity,
            COALESCE(sum(subtotal),0)::text AS subtotal,
            CASE WHEN sum(master_excl*quantity)>0 THEN
              (100*(1-sum(final_excl*quantity)/sum(master_excl*quantity)))::text ELSE '0' END AS weighted_discount
     FROM price_watch_events e WHERE ${filter.where}`,
    filter.args,
  );
  const roundOff = await one(
    db,
    `SELECT COALESCE(sum(value),0)::text AS quote_round_off FROM (
       SELECT e.quotation_id,max(e.quote_round_off) AS value FROM price_watch_events e
       WHERE ${filter.where} AND e.quotation_id IS NOT NULL GROUP BY e.quotation_id
     ) distinct_quotes`,
    filter.args,
  );
  summary!.quote_round_off = roundOff?.quote_round_off ?? "0";
  const coverage = (
    await db.query(
      `SELECT stage,count(*)::int AS events FROM price_watch_events e
       WHERE ${filter.where} GROUP BY stage ORDER BY CASE stage WHEN 'LOOKUP' THEN 1 WHEN 'CART' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END`,
      filter.args,
    )
  ).rows;
  const staff = (
    await db.query(
      `SELECT * FROM (SELECT u.id,u.name,u.username,COALESCE(NULLIF(u.name,''),u.username) AS staff_name,count(*)::int AS events,count(DISTINCT e.item_key)::int AS items,
              count(DISTINCT e.quotation_id)::int AS quotations,count(DISTINCT NULLIF(e.customer_name,''))::int AS customers,
              COALESCE(sum(e.subtotal),0)::text AS subtotal,
              CASE WHEN sum(e.master_excl*e.quantity)>0 THEN
                (100*(1-sum(e.final_excl*e.quantity)/sum(e.master_excl*e.quantity)))::text ELSE '0' END AS weighted_discount,
              count(*) FILTER (WHERE e.effective_discount>=50)::int AS high_discount_events
       FROM price_watch_events e JOIN users u ON u.id=e.actor_id
       WHERE ${filter.where} GROUP BY u.id,u.name,u.username) r ORDER BY ${staffOrder},r.id`,
      filter.args,
    )
  ).rows;
  const count = await one<{ total: number }>(
    db,
    `SELECT count(*)::int AS total FROM (
       SELECT e.actor_id,e.item_key FROM price_watch_events e WHERE ${filter.where} GROUP BY e.actor_id,e.item_key
     ) grouped`,
    filter.args,
  );
  const total = count?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filter.value.pageSize));
  const page = Math.min(filter.value.page, totalPages - 1);
  const limit = filter.bind(filter.value.pageSize);
  const offset = filter.bind(page * filter.value.pageSize);
  const groups = (
    await db.query(
      `SELECT * FROM (SELECT e.actor_id,COALESCE(NULLIF(u.name,''),u.username) AS staff_name,e.item_key,
              (array_agg(e.part_number ORDER BY e.last_seen_at DESC))[1] AS part_number,
              (array_agg(e.description ORDER BY e.last_seen_at DESC))[1] AS description,
              (array_agg(e.source ORDER BY e.last_seen_at DESC))[1] AS source,
              count(*)::int AS events,count(DISTINCT e.quotation_id)::int AS quotations,
              count(DISTINCT NULLIF(e.customer_name,''))::int AS customers,sum(e.quantity)::text AS quantity,
              (sum(e.final_excl*e.quantity)/sum(e.quantity))::text AS weighted_average,
              avg(e.final_excl)::text AS simple_average,
              percentile_cont(0.5) WITHIN GROUP(ORDER BY e.final_excl)::text AS median,
              min(e.final_excl)::text AS minimum,max(e.final_excl)::text AS maximum,
              (array_agg(e.final_excl ORDER BY e.last_seen_at DESC))[1]::text AS latest,
              max(e.last_seen_at) AS latest_at,
              CASE WHEN sum(e.master_excl*e.quantity)>0 THEN
                (100*(1-sum(e.final_excl*e.quantity)/sum(e.master_excl*e.quantity)))::text ELSE '0' END AS weighted_discount,
              count(*) FILTER (WHERE e.final_excl=0 OR e.effective_discount=100)::int AS zero_price_events
       FROM price_watch_events e JOIN users u ON u.id=e.actor_id
       WHERE ${filter.where}
       GROUP BY e.actor_id,u.name,u.username,e.item_key) r
       ORDER BY ${groupOrder},r.item_key,r.actor_id
       LIMIT ${limit} OFFSET ${offset}`,
      filter.args,
    )
  ).rows;
  const users = (
    await db.query(
      "SELECT id,name,username FROM users WHERE NOT disabled ORDER BY name,username",
    )
  ).rows;
  const individual =
    filter.value.view === "ACTIVITY"
      ? await activity(db, actor, raw)
      : undefined;
  return {
    summary,
    coverage,
    staff,
    groups,
    users,
    page,
    pageSize: filter.value.pageSize,
    total,
    totalPages,
    view: filter.value.view,
    ...(individual ?? {}),
  };
}

export async function details(db: DB, actor: Actor, raw: unknown) {
  const filter = filteredWhere(actor, raw);
  assert(filter.value.itemKey, 400, "Select an item");
  const result = await activity(db, actor, {
    ...filter.value,
    view: "ACTIVITY",
  });
  await audit(
    db,
    actor.id,
    "PRICE_WATCHER_DETAIL",
    "price_watch_events",
    filter.value.itemKey,
  );
  return result;
}

export function stageCanPromote(current: string, next: string) {
  return stageRank[next] >= stageRank[current];
}

export async function queueExport(
  db: DB,
  actor: Actor,
  raw: unknown,
  format: "XLSX" | "PDF",
) {
  requirePermission(actor, "PRICE_WATCHER");
  const filters = filtersSchema.parse(raw);
  const id = randomUUID();
  await db.query("INSERT INTO jobs(id,kind,payload) VALUES($1,$2,$3)", [
    id,
    `PRICE_WATCHER_${format}`,
    json({ ownerId: actor.id, actor, filters }),
  ]);
  await audit(
    db,
    actor.id,
    `PRICE_WATCHER_${format}_EXPORT`,
    "price_watch_events",
    id,
  );
  return { id, status: "PENDING", format };
}
