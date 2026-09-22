import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { AppError } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, has, pricingPolicy, requirePermission } from "../auth/service";
import { calculateTargetPrice, customLineInput, lineInput, normalizePart, selectedLevel } from "../pricing/engine";
import { getProduct, toInput } from "../products/service";
import { quoteInput, snapshot } from "../quotations/service";

const pageSchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["ALL", "ACTIVE", "ARCHIVED"]).default("ALL"),
  sort: z.enum(["NEWEST", "OLDEST", "CODE_ASC", "CODE_DESC", "MOST_USED"]).default("NEWEST"),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const versionSchema = z.object({ version: z.coerce.number().int().positive() }).strict();

export async function learnedMatches(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "DELIVERY_ALIAS_MANAGE");
  const v = pageSchema.parse(raw), args: any[] = [];
  const bind = (x: any) => { args.push(x); return `$${args.length}`; };
  const where = ["a.kind='DELIVERY_NOTE'"];
  if (v.q) {
    const q = bind(`%${v.q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(a.label ILIKE ${q} ESCAPE '\\' OR p.part_number ILIKE ${q} ESCAPE '\\' OR p.description ILIKE ${q} ESCAPE '\\')`);
  }
  if (v.status !== "ALL") where.push(`p.active=${bind(v.status === "ACTIVE")}`);
  const count = await one<{ total: number }>(db, `SELECT count(*)::int AS total FROM product_aliases a JOIN products p ON p.id=a.product_id WHERE ${where.join(" AND ")}`, args);
  const total = count?.total ?? 0, totalPages = Math.max(1, Math.ceil(total / v.pageSize));
  const page = Math.min(v.page, totalPages - 1), limit = bind(v.pageSize), offset = bind(page * v.pageSize);
  const order = { NEWEST: "a.updated_at DESC,a.label", OLDEST: "a.created_at,a.label", CODE_ASC: "a.label,a.updated_at DESC", CODE_DESC: "a.label DESC,a.updated_at DESC", MOST_USED: "a.usage_count DESC,a.last_used_at DESC NULLS LAST,a.label" }[v.sort];
  const items = (await db.query(`SELECT a.normalized,a.label,a.kind,a.product_id,a.created_by,a.created_at,a.updated_at,a.usage_count,a.last_used_at,a.version,p.part_number,p.description,p.active,u.name AS creator_name FROM product_aliases a JOIN products p ON p.id=a.product_id LEFT JOIN users u ON u.id=a.created_by WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, args)).rows;
  return { items, page, pageSize: v.pageSize, total, totalPages };
}

export async function updateLearnedMatch(db: DB, actor: Actor, normalizedKey: string, raw: unknown) {
  requirePermission(actor, "DELIVERY_ALIAS_MANAGE");
  const v = z.object({ alias: z.string().trim().min(1).max(100), productId: z.string().uuid(), version: z.coerce.number().int().positive() }).strict().parse(raw);
  return db.transaction(async tx => {
    await tx.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
    const old = await one(tx, "SELECT * FROM product_aliases WHERE normalized=$1 AND kind='DELIVERY_NOTE' FOR UPDATE", [normalizedKey]);
    assert(old, 404, "Learned delivery match not found");
    assert(old.version === v.version, 409, "Learned match changed. Reload");
    await getProduct(tx, v.productId, true);
    const next = normalizePart(v.alias);
    const collision = await one(tx, `SELECT id FROM products WHERE normalized_part=$1 UNION ALL SELECT product_id AS id FROM product_aliases WHERE normalized=$1 AND normalized<>$2 LIMIT 1`, [next, normalizedKey]);
    assert(!collision, 409, `External code already belongs to another catalog product: ${v.alias}`);
    await tx.query("UPDATE product_aliases SET normalized=$2,label=$3,product_id=$4,updated_by=$5,updated_at=now(),version=version+1 WHERE normalized=$1", [normalizedKey, next, v.alias, v.productId, actor.id]);
    await audit(tx, actor.id, "PRODUCT_ALIAS_REASSIGN", "products", v.productId, old, { alias: v.alias, productId: v.productId });
    return { ok: true, normalized: next };
  });
}

export async function deleteLearnedMatch(db: DB, actor: Actor, key: string, raw: unknown) {
  requirePermission(actor, "DELIVERY_ALIAS_MANAGE");
  const v = versionSchema.parse(raw);
  return db.transaction(async tx => {
    const old = await one(tx, "SELECT * FROM product_aliases WHERE normalized=$1 AND kind='DELIVERY_NOTE' FOR UPDATE", [key]);
    assert(old, 404, "Learned delivery match not found");
    assert(old.version === v.version, 409, "Learned match changed. Reload");
    await tx.query("DELETE FROM product_aliases WHERE normalized=$1", [key]);
    await audit(tx, actor.id, "PRODUCT_ALIAS_DELETE", "products", old.product_id, old, null);
    return { ok: true };
  });
}

async function copyProtectedFile(source: string, id: string) {
  const ext = path.extname(source);
  const target = path.join(path.dirname(source), id + ext);
  await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  return target;
}

export async function correctCatalogImport(db: DB, actor: Actor, id: string, raw: unknown) {
  requirePermission(actor, "IMPORT_CONFIRM"); requirePermission(actor, "PRODUCT_EDIT");
  const v = versionSchema.parse(raw), source = await one(db, "SELECT * FROM import_jobs WHERE id=$1", [id]);
  assert(source, 404, "Import not found");
  assert(["IMPORTED", "ROLLED_BACK"].includes(source.status), 409, "Only completed imports can create a correction copy");
  assert(source.version === v.version, 409, "Import changed. Reload");
  const rowCount = await one<{ count: number }>(db, "SELECT count(*)::int AS count FROM import_rows WHERE job_id=$1", [id]);
  assert((rowCount?.count ?? 0) > 0, 409, "Original extracted rows are no longer available");
  const nextId = randomUUID();
  let target: string;
  try { target = await copyProtectedFile(source.file_path, nextId); } catch { throw new AppError(409, "Original protected upload file is no longer available"); }
  try {
    await db.transaction(async tx => {
      await tx.query("INSERT INTO import_jobs(id,filename,file_path,kind,status,owner_id,mapping,defaults,summary,mode,source_job_id) VALUES($1,$2,$3,$4,'AWAITING_REVIEW',$5,$6,$7,$8,$9,$10)", [nextId, source.filename, target, source.kind, actor.id, json(source.mapping), json(source.defaults), json(source.summary), source.mode, id]);
      await tx.query("INSERT INTO import_rows(id,job_id,row_number,raw,errors,decision,verified,confidence) SELECT gen_random_uuid(),$1,row_number,raw,'[]','REVIEW',false,'HIGH' FROM import_rows WHERE job_id=$2", [nextId, id]);
      await audit(tx, actor.id, "IMPORT_CORRECTION_CREATE", "import_jobs", nextId, { sourceJobId: id }, null);
    });
  } catch (e) { await fs.rm(target, { force: true }); throw e; }
  return { id: nextId, sourceJobId: id };
}

export async function correctDeliveryImport(db: DB, actor: Actor, id: string, raw: unknown) {
  assert(has(actor, "QUOTE_CREATE") || has(actor, "QUOTE_EDIT"), 403, "Quotation permission required");
  const v = versionSchema.parse(raw), source = await one(db, "SELECT * FROM delivery_quote_jobs WHERE id=$1", [id]);
  assert(source, 404, "Delivery-note import not found");
  assert(source.status === "COMPLETED", 409, "Only completed delivery-note imports can create a correction copy");
  assert(source.version === v.version, 409, "Import changed. Reload");
  const rowCount = await one<{ count: number }>(db, "SELECT count(*)::int AS count FROM delivery_quote_rows WHERE job_id=$1", [id]);
  assert((rowCount?.count ?? 0) > 0, 409, "Original extracted rows are no longer available");
  const nextId = randomUUID();
  let target: string;
  try { target = await copyProtectedFile(source.file_path, nextId); } catch { throw new AppError(409, "Original protected upload file is no longer available"); }
  try {
    await db.transaction(async tx => {
      await tx.query("INSERT INTO delivery_quote_jobs(id,filename,file_path,status,owner_id,mapping,header,summary,source_job_id) VALUES($1,$2,$3,'AWAITING_MAPPING',$4,$5,$6,$7,$8)", [nextId, source.filename, target, actor.id, json(source.mapping), json(source.header), json(source.summary), id]);
      await tx.query("INSERT INTO delivery_quote_rows(id,job_id,row_number,raw) SELECT gen_random_uuid(),$1,row_number,raw FROM delivery_quote_rows WHERE job_id=$2", [nextId, id]);
      await audit(tx, actor.id, "DELIVERY_QUOTE_CORRECTION_CREATE", "delivery_quote_jobs", nextId, { sourceJobId: id }, null);
    });
  } catch (e) { await fs.rm(target, { force: true }); throw e; }
  return { id: nextId, sourceJobId: id };
}

const includeField = z.enum(["name", "number", "mobile", "reference", "notes"]);
const templateContent = z.object({
  customer: quoteInput.shape.customer,
  includeFields: z.array(includeField).default([]),
  lines: quoteInput.shape.lines,
}).strict();
const templateWrite = z.object({ name: z.string().trim().min(1).max(150), description: z.string().trim().max(500).default(""), status: z.enum(["ACTIVE", "ARCHIVED"]).default("ACTIVE"), content: templateContent, userIds: z.array(z.string().uuid()).max(500).default([]), version: z.coerce.number().int().positive().optional() }).strict();

export async function listTemplates(db: DB, actor: Actor) {
  requirePermission(actor, "QUOTE_CREATE");
  const manage = has(actor, "QUOTE_TEMPLATE_MANAGE");
  const items = (await db.query(`SELECT t.*,COALESCE(json_agg(json_build_object('id',u.id,'name',u.name,'username',u.username)) FILTER(WHERE u.id IS NOT NULL),'[]') AS users FROM quotation_templates t LEFT JOIN quotation_template_users tu ON tu.template_id=t.id LEFT JOIN users u ON u.id=tu.user_id WHERE ${manage ? "true" : "t.status='ACTIVE' AND EXISTS(SELECT 1 FROM quotation_template_users mine WHERE mine.template_id=t.id AND mine.user_id=$1)"} GROUP BY t.id ORDER BY t.updated_at DESC`, manage ? [] : [actor.id])).rows;
  const availableUsers = manage
    ? (await db.query("SELECT id,name,username FROM users WHERE NOT disabled ORDER BY name,username")).rows
    : [];
  return { items, manage, availableUsers };
}

export async function saveTemplate(db: DB, actor: Actor, id: string | undefined, raw: unknown) {
  requirePermission(actor, "QUOTE_TEMPLATE_MANAGE");
  const v = templateWrite.parse(raw), templateId = id ?? randomUUID();
  return db.transaction(async tx => {
    if (id) {
      const old = await one(tx, "SELECT * FROM quotation_templates WHERE id=$1 FOR UPDATE", [id]);
      assert(old, 404, "Quotation template not found"); assert(old.version === v.version, 409, "Template changed. Reload");
      await tx.query("UPDATE quotation_templates SET name=$2,description=$3,status=$4,content=$5,updated_by=$6,version=version+1,updated_at=now() WHERE id=$1", [id, v.name, v.description, v.status, json(v.content), actor.id]);
    } else await tx.query("INSERT INTO quotation_templates(id,name,description,status,content,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6)", [templateId, v.name, v.description, v.status, json(v.content), actor.id]);
    await tx.query("DELETE FROM quotation_template_users WHERE template_id=$1", [templateId]);
    if (v.userIds.length) await tx.query("INSERT INTO quotation_template_users(template_id,user_id) SELECT $1,unnest($2::uuid[])", [templateId, v.userIds]);
    await audit(tx, actor.id, id ? "QUOTE_TEMPLATE_EDIT" : "QUOTE_TEMPLATE_CREATE", "quotation_templates", templateId);
    return one(tx, "SELECT * FROM quotation_templates WHERE id=$1", [templateId]);
  });
}

export async function duplicateTemplate(db: DB, actor: Actor, id: string) {
  requirePermission(actor, "QUOTE_TEMPLATE_MANAGE");
  const old = await one(db, "SELECT * FROM quotation_templates WHERE id=$1", [id]); assert(old, 404, "Quotation template not found");
  const users = (await db.query("SELECT user_id FROM quotation_template_users WHERE template_id=$1", [id])).rows.map(x => x.user_id);
  return saveTemplate(db, actor, undefined, { name: `${old.name} Copy`, description: old.description, status: "ACTIVE", content: old.content, userIds: users });
}

export async function deleteTemplate(db: DB, actor: Actor, id: string, raw: unknown) {
  requirePermission(actor, "QUOTE_TEMPLATE_MANAGE"); const v = versionSchema.parse(raw);
  return db.transaction(async tx => { const old = await one(tx, "SELECT * FROM quotation_templates WHERE id=$1 FOR UPDATE", [id]); assert(old, 404, "Quotation template not found"); assert(old.version === v.version, 409, "Template changed. Reload"); await tx.query("DELETE FROM quotation_templates WHERE id=$1", [id]); await audit(tx, actor.id, "QUOTE_TEMPLATE_DELETE", "quotation_templates", id, old, null); return { ok: true }; });
}

export async function instantiateTemplate(db: DB, actor: Actor, id: string) {
  requirePermission(actor, "QUOTE_CREATE");
  const row = await one(db, `SELECT t.* FROM quotation_templates t WHERE t.id=$1 AND t.status='ACTIVE' AND ($2 OR EXISTS(SELECT 1 FROM quotation_template_users tu WHERE tu.template_id=t.id AND tu.user_id=$3))`, [id, has(actor, "QUOTE_TEMPLATE_MANAGE"), actor.id]);
  assert(row, 404, "Quotation template not found or not assigned to you");
  const warnings: string[] = [], prepared: any[] = [];
  for (const original of row.content.lines) {
    const { watcherEventId, importMeta, ...line } = original;
    if (line.type === "CUSTOM") { prepared.push(line); continue; }
    const product = toInput(await getProduct(db, line.productId));
    const level = selectedLevel(product, line.sellingLevel);
    const markupNow = level.method === "COST_MARKUP";
    const markupSaved = line.markup !== undefined;
    if (markupNow !== markupSaved) warnings.push(`${product.partNumber}: pricing method changed; adjustment reset to 0%.`);
    prepared.push({ ...line, discount: markupNow ? "0" : (markupSaved ? "0" : line.discount), ...(markupNow ? { markup: markupSaved ? line.markup : "0" } : { markup: undefined }) });
  }
  const settings = (await one(db, "SELECT data FROM settings WHERE id=1"))!.data;
  const lines = await snapshot(db, actor, prepared, settings, { allowUnresolvedImportedCustom: false });
  const included = new Set(row.content.includeFields);
  const customer = Object.fromEntries(Object.entries(row.content.customer).map(([k, v]) => [k, included.has(k) ? v : ""]));
  return { templateId: id, customer, lines: lines.map(({ internalPricing, ...line }: any) => ({ ...line, price: line.price ? Object.fromEntries(Object.entries(line.price).filter(([k]) => k !== "maxDiscount")) : null })), warnings };
}

const historySchema = z.object({ itemKey: z.string().min(1).max(250), stage: z.enum(["ALL", "DRAFT", "ISSUED"]), customerNumber: z.string().trim().max(80).default(""), customerName: z.string().trim().max(150).default(""), excludeQuotationId: z.string().uuid().optional(), page: z.coerce.number().int().min(0).default(0), pageSize: z.coerce.number().int().min(1).max(50).default(10) });
export async function recentPrices(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "QUOTE_PRICE_HISTORY"); const v = historySchema.parse(raw);
  const offset = v.page * v.pageSize;
  const items = (await db.query(`SELECT e.id,q.status AS stage,e.part_number,e.description,e.quantity::text,e.selling_level,e.final_excl::text,e.final_incl::text,e.requested_discount::text,e.requested_markup::text,e.effective_discount::text,e.effective_markup::text,e.adjustment_mode,e.last_seen_at,e.customer_name,u.name AS staff_name,q.number AS quotation_number,q.id AS quotation_id,q.owner_id,(q.owner_id=$6 OR $7) AS can_open,CASE WHEN $3<>'' THEN btrim(COALESCE(q.customer->>'number',''))=$3 ELSE upper(regexp_replace(btrim(e.customer_name),'\\s+',' ','g'))=upper(regexp_replace(btrim($4),'\\s+',' ','g')) AND $4<>'' END AS same_customer FROM price_watch_events e JOIN quotations q ON q.id=e.quotation_id JOIN users u ON u.id=e.actor_id WHERE e.item_key=$1 AND q.status IN ('DRAFT','ISSUED') AND e.stage=q.status AND ($2='ALL' OR q.status=$2) AND ($5::uuid IS NULL OR q.id<>$5) ORDER BY same_customer DESC,e.last_seen_at DESC,e.id LIMIT $8 OFFSET $9`, [v.itemKey, v.stage, v.customerNumber, v.customerName, v.excludeQuotationId ?? null, actor.id, has(actor, "QUOTE_VIEW_ALL"), v.pageSize + 1, offset])).rows;
  await audit(db, actor.id, "QUOTE_PRICE_HISTORY_VIEW", "price_watch_events", v.itemKey);
  return { items: items.slice(0, v.pageSize), page: v.page, pageSize: v.pageSize, hasMore: items.length > v.pageSize };
}

const reuseSchema = z.object({
  customerNumber: z.string().trim().max(80).default(""),
  customerName: z.string().trim().max(150).default(""),
  excludeQuotationId: z.string().uuid().optional(),
  lines: z.array(z.object({ index: z.number().int().min(0), input: z.unknown() }).strict()).min(1).max(200),
}).strict();

export async function reusableCustomerPrices(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "QUOTE_PRICE_HISTORY");
  const value = reuseSchema.parse(raw);
  assert(value.customerNumber !== "1", 400, "Previous-price reuse is unavailable for Walk-in Customer");
  assert(value.customerNumber || value.customerName, 400, "Enter Customer Code or customer name first");
  const results: any[] = [];
  for (const item of value.lines) {
    let parsed: any;
    try {
      const rawLine: any = item.input;
      if (rawLine?.type === "CUSTOM") parsed = customLineInput.parse(rawLine);
      else {
        const { type: _type, ...catalogLine } = rawLine ?? {};
        parsed = lineInput.parse(catalogLine);
      }
    }
    catch { results.push({ index: item.index, status: "INVALID", reason: "Quotation line is incomplete" }); continue; }
    const itemKey = parsed.type === "CUSTOM"
      ? parsed.reusableItemId ? `REUSABLE:${parsed.reusableItemId}` : parsed.partNumber ? `CUSTOM-REF:${parsed.partNumber.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase()}` : `CUSTOM-DESC:${parsed.description.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase()}`
      : `CATALOG:${parsed.productId}`;
    const previous = await one(db, `SELECT e.final_excl::text,q.number AS quotation_number,q.status,e.last_seen_at,CASE WHEN $2<>'' THEN 'CODE' ELSE 'NAME' END AS customer_match FROM price_watch_events e JOIN quotations q ON q.id=e.quotation_id WHERE e.item_key=$1 AND e.stage=q.status AND q.status IN ('DRAFT','ISSUED') AND e.final_excl>0 AND ($4::uuid IS NULL OR q.id<>$4) AND (CASE WHEN $2<>'' THEN btrim(COALESCE(q.customer->>'number',''))=$2 ELSE upper(regexp_replace(btrim(COALESCE(q.customer->>'name','')),'\\s+',' ','g'))=upper(regexp_replace(btrim($3),'\\s+',' ','g')) END) ORDER BY CASE q.status WHEN 'ISSUED' THEN 0 ELSE 1 END,e.last_seen_at DESC,e.id LIMIT 1`, [itemKey, value.customerNumber, value.customerName, value.excludeQuotationId ?? null]);
    if (!previous) { results.push({ index: item.index, itemKey, status: "NOT_FOUND" }); continue; }
    if (parsed.type === "CUSTOM") {
      results.push({ index: item.index, itemKey, status: "MATCHED", input: { ...parsed, unitPriceExcl: previous.final_excl, discount: "0", ...(parsed.markup === undefined ? {} : { markup: "0" }) }, previous });
      continue;
    }
    try {
      const product = toInput(await getProduct(db, parsed.productId));
      const price = calculateTargetPrice(product, pricingPolicy(actor), {
        productId: parsed.productId,
        sellingLevel: parsed.sellingLevel,
        quantity: parsed.quantity,
        targetFinalExcl: previous.final_excl,
        override: false,
        reason: "",
        watcherEventId: parsed.watcherEventId,
        importMeta: parsed.importMeta,
      });
      const adjusted = price.finalExcl !== Number(previous.final_excl).toFixed(2);
      const { markup: _markup, ...discountInput } = parsed;
      const input = price.adjustmentMode === "MARKUP"
        ? { ...parsed, discount: "0", markup: price.requestedMarkup }
        : { ...discountInput, discount: price.requestedDiscount };
      results.push({ index: item.index, itemKey, status: adjusted ? "ADJUSTED" : "MATCHED", input, price, previous, reason: adjusted ? `Previous SAR ${Number(previous.final_excl).toFixed(2)} adjusted to permitted SAR ${price.finalExcl}.` : "" });
    } catch (error) { results.push({ index: item.index, itemKey, status: "INVALID", reason: error instanceof Error ? error.message : "Unable to validate previous price" }); }
  }
  await audit(db, actor.id, "QUOTE_PREVIOUS_PRICE_REUSE", "price_watch_events", value.customerNumber || value.customerName, null, { lineCount: value.lines.length, matched: results.filter(x => x.status === "MATCHED" || x.status === "ADJUSTED").length });
  return { results, summary: { matched: results.filter(x => x.status === "MATCHED").length, adjusted: results.filter(x => x.status === "ADJUSTED").length, notFound: results.filter(x => x.status === "NOT_FOUND").length, invalid: results.filter(x => x.status === "INVALID").length } };
}
