import { randomUUID } from "node:crypto";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import {
  type Actor,
  has,
  pricingPolicy,
  requirePermission,
} from "../auth/service";
import {
  type ProductInput,
  productInput,
  validateProduct,
  normalizePart,
  masterPrice,
  calculate,
  money,
  canonicalProduct,
  sellingLevels,
  levelPrice,
} from "../pricing/engine";
import Decimal from "decimal.js";
export const productSelect = `SELECT p.*,pp.*,b.name AS brand,c.name AS category,COALESCE((SELECT json_agg(a.label) FROM product_aliases a WHERE a.product_id=p.id),'[]') AS aliases,
(SELECT json_agg(json_build_object('code',l.code,'active',l.active,'method',l.method,'fixedPrice',l.fixed_price::text,'markup',l.markup::text,'listPrice',l.list_price::text,'baseDiscount',l.base_discount::text) ORDER BY CASE l.code WHEN 'WHOLESALE' THEN 0 WHEN 'RETAIL' THEN 1 ELSE 2 END) FROM product_selling_levels l WHERE l.product_id=p.id) AS levels
FROM products p JOIN product_pricing pp ON pp.product_id=p.id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id`;
export function toInput(row: Record<string, any>): ProductInput {
  return {
    partNumber: row.part_number,
    description: row.description,
    brand: row.brand ?? "",
    category: row.category ?? "",
    keywords: row.keywords,
    aliases: row.aliases ?? [],
    method: row.method,
    cost: row.cost,
    markup: row.markup,
    listPrice: row.list_price,
    baseDiscount: row.base_discount,
    vat: row.vat,
    minimumEnabled: row.minimum_enabled,
    minimum: row.minimum,
    unit: row.unit,
    quantityPrecision: row.quantity_precision,
    active: row.active,
    ...(row.levels
      ? { levels: row.levels, defaultLevel: row.default_level }
      : {}),
  };
}
export async function getProduct(db: DB, id: string, lock = false) {
  if (lock)
    await db.query("SELECT id FROM products WHERE id=$1 FOR UPDATE", [id]);
  const row = await one(db, productSelect + " WHERE p.id=$1", [id]);
  assert(row, 404, "Product not found");
  return row;
}
export function staffProduct(
  row: Record<string, any>,
  actor: Actor,
  settings: Record<string, any>,
) {
  const p = toInput(row);
  const master = masterPrice(p);
  const result: Record<string, any> = {
    id: row.id,
    partNumber: p.partNumber,
    description: p.description,
    brand: p.brand,
    category: p.category,
    unit: p.unit,
    quantityPrecision: p.quantityPrecision,
    version: row.version,
    active: p.active,
    masterExcl: master.toFixed(2),
    masterIncl: money(
      master.mul(new Decimal(1).add(new Decimal(p.vat).div(100))),
    ),
    vat: p.vat,
    updatedAt: row.updated_at,
    defaultLevel: p.defaultLevel ?? "END_CUSTOMER",
    sellingLevels: sellingLevels(p)
      .filter((l) => l.active)
      .map((l) => ({
        code: l.code,
        masterExcl: levelPrice(p, l).toFixed(2),
        masterIncl: money(
          levelPrice(p, l).mul(new Decimal(1).add(new Decimal(p.vat).div(100))),
        ),
      })),
  };
  if (has(actor, "MIN_PRICE_VIEW") || settings.minimumVisible) {
    result.minimumEnabled = p.minimumEnabled;
    result.minimum = p.minimum;
  }
  if (settings.showMaxDiscount)
    result.maxDiscount = calculate(p, pricingPolicy(actor), {
      quantity: "1",
      discount: "0",
      override: false,
      reason: "",
    }).maxDiscount;
  if (has(actor, "COST_VIEW")) Object.assign(result, p);
  return result;
}
async function taxonomy(db: DB, kind: "brands" | "categories", name: string) {
  if (!name) return null;
  const normalized = normalizePart(name);
  const found = await one(db, `SELECT id FROM ${kind} WHERE normalized=$1`, [
    normalized,
  ]);
  if (found) return found.id;
  return (await one(
    db,
    `INSERT INTO ${kind}(id,name,normalized) VALUES($1,$2,$3) ON CONFLICT(normalized) DO UPDATE SET name=${kind}.name RETURNING id`,
    [randomUUID(), name, normalized],
  ))!.id;
}
export async function saveProduct(
  db: DB,
  actor: Actor,
  data: unknown,
  id?: string,
  expectedVersion?: number,
  source = "MANUAL",
  importId: string | null = null,
) {
  let p = productInput.parse(data);
  const normalized = normalizePart(p.partNumber);
  // Serializes identifier changes (including aliases) without relying on application-only duplicate checks.
  await db.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
  const old = id ? await getProduct(db, id, true) : undefined;
  // Old clients update only the default formula, never remove other levels.
  if (old && !p.levels) {
    const before = toInput(old);
    const code = before.defaultLevel ?? "END_CUSTOMER";
    p = {
      ...p,
      defaultLevel: code,
      levels: sellingLevels(before).map((l) =>
        l.code === code
          ? {
              ...l,
              method: p.method,
              markup: p.markup,
              listPrice: p.listPrice,
              baseDiscount: p.baseDiscount,
            }
          : l,
      ),
    };
  }
  p = canonicalProduct(validateProduct(p));
  if (old)
    assert(
      old.version === expectedVersion,
      409,
      "Product changed. Reload its current values before saving",
    );
  const collision = await one(
    db,
    "SELECT product_id AS id FROM product_aliases WHERE normalized=$1 UNION ALL SELECT id FROM products WHERE normalized_part=$1",
    [normalized],
  );
  assert(
    !collision || collision.id === id,
    409,
    "Duplicate part number or alias",
  );
  const aliases = [...new Set(p.aliases.map(normalizePart))].filter(
    (a) => a !== normalized,
  );
  for (const alias of aliases) {
    const match = await one(
      db,
      "SELECT id FROM products WHERE normalized_part=$1 UNION ALL SELECT product_id AS id FROM product_aliases WHERE normalized=$1",
      [alias],
    );
    assert(
      !match || match.id === id,
      409,
      `Alias already belongs to another product: ${alias}`,
    );
  }
  const brand = await taxonomy(db, "brands", p.brand),
    category = await taxonomy(db, "categories", p.category);
  const productId = id ?? randomUUID();
  if (old)
    await db.query(
      "UPDATE products SET part_number=$2,normalized_part=$3,description=$4,brand_id=$5,category_id=$6,keywords=$7,unit=$8,quantity_precision=$9,active=$10,version=version+1,updated_by=$11,updated_at=now() WHERE id=$1",
      [
        productId,
        p.partNumber,
        normalized,
        p.description,
        brand,
        category,
        p.keywords,
        p.unit,
        p.quantityPrecision,
        p.active,
        actor.id,
      ],
    );
  else
    await db.query(
      "INSERT INTO products(id,part_number,normalized_part,description,brand_id,category_id,keywords,unit,quantity_precision,active,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)",
      [
        productId,
        p.partNumber,
        normalized,
        p.description,
        brand,
        category,
        p.keywords,
        p.unit,
        p.quantityPrecision,
        p.active,
        actor.id,
      ],
    );
  await db.query(
    `INSERT INTO product_pricing(product_id,method,cost,markup,list_price,base_discount,master_excl,vat,minimum_enabled,minimum,default_level) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(product_id) DO UPDATE SET method=$2,cost=$3,markup=$4,list_price=$5,base_discount=$6,master_excl=$7,vat=$8,minimum_enabled=$9,minimum=$10,default_level=$11`,
    [
      productId,
      p.method,
      p.cost,
      p.markup,
      p.listPrice,
      p.baseDiscount,
      masterPrice(p).toFixed(2),
      p.vat,
      p.minimumEnabled,
      p.minimum,
      p.defaultLevel,
    ],
  );
  await db.query("DELETE FROM product_selling_levels WHERE product_id=$1", [
    productId,
  ]);
  for (const level of sellingLevels(p))
    await db.query(
      "INSERT INTO product_selling_levels(product_id,code,active,method,fixed_price,markup,list_price,base_discount) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        productId,
        level.code,
        level.active,
        level.method,
        level.fixedPrice,
        level.markup,
        level.listPrice,
        level.baseDiscount,
      ],
    );
  await db.query("DELETE FROM product_aliases WHERE product_id=$1", [
    productId,
  ]);
  for (const alias of aliases)
    await db.query(
      "INSERT INTO product_aliases(normalized,product_id,label) VALUES($1,$2,$3)",
      [alias, productId, alias],
    );
  const version = old ? old.version + 1 : 1;
  await db.query(
    "INSERT INTO price_history(id,product_id,before_value,after_value,actor_id,source,import_id,resulting_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      productId,
      json(old ? toInput(old) : null),
      json(p),
      actor.id,
      source,
      importId,
      version,
    ],
  );
  await audit(
    db,
    actor.id,
    old ? "PRODUCT_EDIT" : "PRODUCT_CREATE",
    "products",
    productId,
    old ? toInput(old) : null,
    p,
  );
  if (old && old.active !== p.active)
    await audit(
      db,
      actor.id,
      p.active ? "PRODUCT_REACTIVATE" : "PRODUCT_ARCHIVE",
      "products",
      productId,
      { active: old.active },
      { active: p.active },
    );
  if (old && json(toInput(old)) !== json(p))
    await audit(
      db,
      actor.id,
      "PRICE_CHANGE",
      "products",
      productId,
      toInput(old),
      p,
    );
  if (
    old &&
    (old.minimum_enabled !== p.minimumEnabled ||
      !new Decimal(old.minimum).eq(p.minimum))
  )
    await audit(
      db,
      actor.id,
      "MIN_PRICE_CHANGE",
      "products",
      productId,
      { enabled: old.minimum_enabled, minimum: old.minimum },
      { enabled: p.minimumEnabled, minimum: p.minimum },
    );
  return { id: productId, version };
}

export async function deleteProduct(
  db: DB,
  actor: Actor,
  id: string,
  expectedVersion: number,
  source = "MANUAL",
) {
  await db.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
  const current = await getProduct(db, id, true);
  assert(
    current.version === expectedVersion,
    409,
    "Product changed. Reload its current values before deleting",
  );
  const before = toInput(current);
  const quoteUse = await one(
    db,
    `SELECT q.number
     FROM quotations q
     WHERE EXISTS (
       SELECT 1
       FROM jsonb_array_elements(q.lines) AS line
       WHERE line->>'productId' = $1
     )
     ORDER BY q.updated_at DESC
     LIMIT 1`,
    [id],
  );
  assert(
    !quoteUse,
    409,
    `Cannot delete ${before.partNumber}: it is used in quotation ${quoteUse?.number ?? ""}`.trim(),
  );
  const importUse = await one(
    db,
    `SELECT j.filename
     FROM import_rows r
     JOIN import_jobs j ON j.id=r.job_id
     WHERE r.duplicate_id=$1
       AND j.status IN ('UPLOADED','PROCESSING','AWAITING_REVIEW','CONFIRMED')
     LIMIT 1`,
    [id],
  );
  assert(
    !importUse,
    409,
    `Cannot delete ${before.partNumber}: it is referenced by import ${importUse?.filename ?? ""}`.trim(),
  );
  await db.query("DELETE FROM price_history WHERE product_id=$1", [id]);
  await db.query("DELETE FROM product_aliases WHERE product_id=$1", [id]);
  await db.query("DELETE FROM product_selling_levels WHERE product_id=$1", [id]);
  await db.query("DELETE FROM product_pricing WHERE product_id=$1", [id]);
  await db.query("DELETE FROM products WHERE id=$1", [id]);
  await audit(
    db,
    actor.id,
    "PRODUCT_DELETE",
    "products",
    id,
    before,
    null,
    source,
  );
  return { id, partNumber: before.partNumber };
}
export async function search(
  db: DB,
  actor: Actor,
  query: string,
  settings: any,
  admin = false,
) {
  requirePermission(actor, "PRODUCT_VIEW");
  if (admin) requirePermission(actor, "PRODUCT_EDIT");
  const q = normalizePart(query).slice(0, 100);
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const active = admin ? "true" : "active";
  if (!q) {
    const rows = await db.query(
      productSelect +
        ` WHERE ${admin ? "true" : "p.active"} ORDER BY p.normalized_part LIMIT 50`,
    );
    return rows.rows.map((r) =>
      admin && has(actor, "COST_VIEW")
        ? { id: r.id, version: r.version, ...toInput(r) }
        : staffProduct(r, actor, settings),
    );
  }
  // Bound each ranked candidate set before joining prices; avoid sorting the entire catalog.
  const candidates = `WITH candidates AS (
    (SELECT id,0 AS rank FROM products WHERE ${active} AND normalized_part=$1 LIMIT 50)
    UNION ALL (SELECT p.id,0 FROM products p JOIN product_aliases a ON a.product_id=p.id WHERE ${admin ? "true" : "p.active"} AND a.normalized=$1 LIMIT 50)
    UNION ALL (SELECT id,1 FROM products WHERE ${active} AND normalized_part LIKE $2 ORDER BY normalized_part LIMIT 50)
    UNION ALL (SELECT id,2 FROM products WHERE ${active} AND normalized_part LIKE $3 ORDER BY normalized_part LIMIT 50)
    UNION ALL (SELECT p.id,2 FROM products p JOIN product_aliases a ON a.product_id=p.id WHERE ${admin ? "true" : "p.active"} AND a.normalized LIKE $3 ORDER BY p.normalized_part LIMIT 50)
    UNION ALL (SELECT id,3 FROM products WHERE ${active} AND description ILIKE $3 LIMIT 50)
    UNION ALL (SELECT id,4 FROM products WHERE ${active} AND keywords ILIKE $3 LIMIT 50)
    UNION ALL (SELECT p.id,4 FROM products p JOIN brands b ON b.id=p.brand_id WHERE ${admin ? "true" : "p.active"} AND b.name ILIKE $3 LIMIT 50)
    UNION ALL (SELECT p.id,4 FROM products p JOIN categories c ON c.id=p.category_id WHERE ${admin ? "true" : "p.active"} AND c.name ILIKE $3 LIMIT 50)
  ), ranked AS (SELECT id,min(rank) AS rank FROM candidates GROUP BY id)
  `;
  const rows = await db.query(
    candidates +
      productSelect +
      ` JOIN ranked r ON r.id=p.id ORDER BY r.rank,p.normalized_part LIMIT 50`,
    [q, escaped + "%", "%" + escaped + "%"],
  );
  return rows.rows.map((r) =>
    admin && has(actor, "COST_VIEW")
      ? { id: r.id, version: r.version, ...toInput(r) }
      : staffProduct(r, actor, settings),
  );
}
