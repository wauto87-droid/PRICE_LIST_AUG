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
    details: row.details ?? {},
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
    details: p.details,
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
      "UPDATE products SET part_number=$2,normalized_part=$3,description=$4,brand_id=$5,category_id=$6,keywords=$7,unit=$8,quantity_precision=$9,active=$10,version=version+1,updated_by=$11,updated_at=now(),details=$12 WHERE id=$1",
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
        json(p.details ?? {}),
      ],
    );
  else
    await db.query(
      "INSERT INTO products(id,part_number,normalized_part,description,brand_id,category_id,keywords,unit,quantity_precision,active,created_by,updated_by,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)",
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
        json(p.details ?? {}),
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
  await db.query("DELETE FROM product_selling_levels WHERE product_id=$1", [
    id,
  ]);
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

const SEARCH_RESULT_LIMIT = 50;

function partRankedCte(activeClause: string) {
  return `WITH part_ranked AS (
    SELECT match.id, min(match.rank)::int AS rank
    FROM (
      SELECT p.id, 0 AS rank
      FROM products p
      WHERE ${activeClause} AND p.normalized_part=$1
      UNION ALL
      SELECT p.id, 0 AS rank
      FROM product_aliases a
      JOIN products p ON p.id=a.product_id
      WHERE ${activeClause} AND a.normalized=$1
      UNION ALL
      SELECT p.id, 1 AS rank
      FROM products p
      WHERE ${activeClause} AND p.normalized_part LIKE $2 ESCAPE '\\'
      UNION ALL
      SELECT p.id, 1 AS rank
      FROM product_aliases a
      JOIN products p ON p.id=a.product_id
      WHERE ${activeClause} AND a.normalized LIKE $2 ESCAPE '\\'
      UNION ALL
      SELECT p.id, 2 AS rank
      FROM products p
      WHERE ${activeClause} AND p.normalized_part LIKE $3 ESCAPE '\\'
      UNION ALL
      SELECT p.id, 2 AS rank
      FROM product_aliases a
      JOIN products p ON p.id=a.product_id
      WHERE ${activeClause} AND a.normalized LIKE $3 ESCAPE '\\'
    ) AS match
    GROUP BY match.id
  )`;
}

function textRankedCte(activeClause: string) {
  return `WITH text_ranked AS (
    SELECT
      p.id,
      CASE
        WHEN p.description ILIKE $1 ESCAPE '\\' THEN 3
        WHEN p.keywords ILIKE $1 ESCAPE '\\' THEN 4
        WHEN b.name ILIKE $1 ESCAPE '\\' THEN 5
        ELSE 6
      END AS rank
    FROM products p
    LEFT JOIN brands b ON b.id=p.brand_id
    LEFT JOIN categories c ON c.id=p.category_id
    WHERE ${activeClause}
      AND (
        p.description ILIKE $1 ESCAPE '\\'
        OR p.keywords ILIKE $1 ESCAPE '\\'
        OR b.name ILIKE $1 ESCAPE '\\'
        OR c.name ILIKE $1 ESCAPE '\\'
      )
      AND NOT (p.id = ANY($2::uuid[]))
  )`;
}

async function getRankedPartMatches(
  db: DB,
  activeClause: string,
  q: string,
  escaped: string,
  limit: number,
  offset = 0,
) {
  return (
    await db.query(
      partRankedCte(activeClause) +
        ` SELECT p.id,p.version,part_ranked.rank
          FROM part_ranked
          JOIN products p ON p.id=part_ranked.id
          ORDER BY part_ranked.rank,p.normalized_part
          LIMIT $4 OFFSET $5`,
      [q, escaped + "%", "%" + escaped + "%", limit, offset],
    )
  ).rows;
}

async function countRankedPartMatches(
  db: DB,
  activeClause: string,
  q: string,
  escaped: string,
) {
  return Number(
    (await one(
      db,
      partRankedCte(activeClause) +
        " SELECT count(*)::int AS n FROM part_ranked",
      [q, escaped + "%", "%" + escaped + "%"],
    ))!.n,
  );
}

async function getRankedTextMatches(
  db: DB,
  activeClause: string,
  wildcard: string,
  excludedIds: string[],
  limit: number,
  offset = 0,
) {
  return (
    await db.query(
      textRankedCte(activeClause) +
        ` SELECT p.id,p.version,text_ranked.rank
          FROM text_ranked
          JOIN products p ON p.id=text_ranked.id
          ORDER BY text_ranked.rank,p.normalized_part
          LIMIT $3 OFFSET $4`,
      [wildcard, excludedIds, limit, offset],
    )
  ).rows;
}

async function countRankedTextMatches(
  db: DB,
  activeClause: string,
  wildcard: string,
  excludedIds: string[],
) {
  return Number(
    (await one(
      db,
      textRankedCte(activeClause) +
        " SELECT count(*)::int AS n FROM text_ranked",
      [wildcard, excludedIds],
    ))!.n,
  );
}

async function hydrateProductsByIds(db: DB, ids: string[]) {
  if (!ids.length) return [];
  return (
    await db.query(
      `WITH ordered AS (
        SELECT id, ord
        FROM unnest($1::uuid[]) WITH ORDINALITY AS input(id, ord)
      )
      SELECT p.*,pp.*,b.name AS brand,c.name AS category,
        COALESCE(
          (SELECT json_agg(a.label) FROM product_aliases a WHERE a.product_id=p.id),
          '[]'
        ) AS aliases,
        (
          SELECT json_agg(
            json_build_object(
              'code',l.code,
              'active',l.active,
              'method',l.method,
              'fixedPrice',l.fixed_price::text,
              'markup',l.markup::text,
              'listPrice',l.list_price::text,
              'baseDiscount',l.base_discount::text
            )
            ORDER BY CASE l.code WHEN 'WHOLESALE' THEN 0 WHEN 'RETAIL' THEN 1 ELSE 2 END
          )
          FROM product_selling_levels l
          WHERE l.product_id=p.id
        ) AS levels
      FROM ordered
      JOIN products p ON p.id=ordered.id
      JOIN product_pricing pp ON pp.product_id=p.id
      LEFT JOIN brands b ON b.id=p.brand_id
      LEFT JOIN categories c ON c.id=p.category_id
      ORDER BY ordered.ord`,
      [ids],
    )
  ).rows;
}

async function hydrateLookupProductsByIds(db: DB, ids: string[]) {
  if (!ids.length) return [];
  return (
    await db.query(
      `WITH ordered AS (
        SELECT id, ord
        FROM unnest($1::uuid[]) WITH ORDINALITY AS input(id, ord)
      )
      SELECT
        p.id,
        p.part_number,
        p.description,
        p.unit,
        p.quantity_precision,
        p.active,
        pp.master_excl,
        pp.vat,
        pp.minimum_enabled,
        pp.minimum,
        pp.default_level,
        b.name AS brand,
        c.name AS category,
        (
          SELECT json_agg(
            json_build_object(
              'code',l.code,
              'masterExcl', level_price.master_excl,
              'masterIncl', level_price.master_incl
            )
            ORDER BY CASE l.code WHEN 'WHOLESALE' THEN 0 WHEN 'RETAIL' THEN 1 ELSE 2 END
          )
          FROM product_selling_levels l
          CROSS JOIN LATERAL (
            SELECT
              CASE
                WHEN l.method='FIXED' THEN l.fixed_price::text
                WHEN l.method='COST_MARKUP' THEN round(pp.cost * (1 + l.markup / 100.0), 2)::text
                ELSE round(l.list_price * (1 - l.base_discount / 100.0), 2)::text
              END AS master_excl,
              round(
                (
                  CASE
                    WHEN l.method='FIXED' THEN l.fixed_price
                    WHEN l.method='COST_MARKUP' THEN pp.cost * (1 + l.markup / 100.0)
                    ELSE l.list_price * (1 - l.base_discount / 100.0)
                  END
                ) * (1 + pp.vat / 100.0),
                2
              )::text AS master_incl
          ) AS level_price
          WHERE l.product_id=p.id AND l.active
        ) AS selling_levels
      FROM ordered
      JOIN products p ON p.id=ordered.id
      JOIN product_pricing pp ON pp.product_id=p.id
      LEFT JOIN brands b ON b.id=p.brand_id
      LEFT JOIN categories c ON c.id=p.category_id
      ORDER BY ordered.ord`,
      [ids],
    )
  ).rows;
}

function lookupProduct(
  row: Record<string, any>,
  actor: Actor,
  settings: Record<string, any>,
) {
  const masterExcl = row.master_excl;
  const vat = row.vat;
  const result: Record<string, any> = {
    id: row.id,
    partNumber: row.part_number,
    description: row.description,
    brand: row.brand ?? "",
    category: row.category ?? "",
    unit: row.unit,
    quantityPrecision: row.quantity_precision,
    masterExcl,
    masterIncl: money(
      new Decimal(masterExcl).mul(
        new Decimal(1).add(new Decimal(vat).div(100)),
      ),
    ),
    vat,
    defaultLevel: row.default_level ?? "END_CUSTOMER",
    sellingLevels: Array.isArray(row.selling_levels) ? row.selling_levels : [],
    details: row.details ?? {},
  };
  if (has(actor, "MIN_PRICE_VIEW") || settings.minimumVisible) {
    result.minimumEnabled = row.minimum_enabled;
    result.minimum = row.minimum;
  }
  return result;
}

export async function search(
  db: DB,
  actor: Actor,
  query: string,
  settings: any,
  adminOrOptions:
    | boolean
    | {
        admin?: boolean;
        page?: number;
        pageSize?: number;
        selectionLimit?: number;
        selectionOffset?: number;
        protectedOnly?: boolean;
        minimumFilter?: "ALL" | "PROTECTED" | "UNPROTECTED";
        statusFilter?: "ALL" | "ACTIVE" | "ARCHIVED";
        methodFilter?: "ALL" | "COST_MARKUP" | "LIST_DISCOUNT" | "FIXED";
        contentFilter?: "ALL" | "MISSING" | "COMPLETE";
      } = false,
) {
  const options =
    typeof adminOrOptions === "boolean"
      ? { admin: adminOrOptions }
      : adminOrOptions;
  const admin = options.admin ?? false;
  requirePermission(actor, "PRODUCT_VIEW");
  if (admin) requirePermission(actor, "PRODUCT_EDIT");
  const q = normalizePart(query).slice(0, 100);
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const active = admin ? "true" : "active";
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
  const page = Math.max(options.page ?? 0, 0);
  const offset = page * pageSize;
  const minimumFilter =
    options.minimumFilter ?? (options.protectedOnly ? "PROTECTED" : "ALL");
  const statusFilter = options.statusFilter ?? "ALL";
  const methodFilter = options.methodFilter ?? "ALL";
  const contentFilter = options.contentFilter ?? "ALL";
  const selectionLimit = Math.min(
    Math.max(options.selectionLimit ?? 5000, 1),
    5000,
  );
  const selectionOffset = Math.max(options.selectionOffset ?? 0, 0);
  const activeClause = admin ? "true" : "p.active";
  const minimumClause =
    minimumFilter === "PROTECTED"
      ? `EXISTS (
        SELECT 1
        FROM product_pricing pp
        WHERE pp.product_id = p.id
          AND pp.minimum_enabled
          AND pp.minimum > 0
      )`
      : minimumFilter === "UNPROTECTED"
        ? `NOT EXISTS (
        SELECT 1
        FROM product_pricing pp
        WHERE pp.product_id = p.id
          AND pp.minimum_enabled
          AND pp.minimum > 0
      )`
        : "true";
  const statusClause =
    statusFilter === "ACTIVE"
      ? "p.active"
      : statusFilter === "ARCHIVED"
        ? "NOT p.active"
        : "true";
  const methodClause =
    methodFilter === "ALL"
      ? "true"
      : `EXISTS (
        SELECT 1
        FROM product_pricing pp
        WHERE pp.product_id = p.id
          AND pp.method = '${methodFilter}'
      )`;
  const missingContent = `(btrim(p.description)='' OR upper(regexp_replace(btrim(p.description),'\s+',' ','g'))=upper(regexp_replace(btrim(p.part_number),'\s+',' ','g')) OR upper(regexp_replace(btrim(p.description),'[.\s]+','','g')) IN ('N/A','NA','UNKNOWN','NODESCRIPTION'))`;
  const contentClause =
    contentFilter === "MISSING"
      ? missingContent
      : contentFilter === "COMPLETE"
        ? `NOT ${missingContent}`
        : "true";
  const productWhere = `${activeClause} AND ${minimumClause} AND ${statusClause} AND ${methodClause} AND ${contentClause}`;
  const mapRows = (rows: Record<string, any>[]) =>
    rows.map((r) =>
      admin && has(actor, "COST_VIEW")
        ? { id: r.id, version: r.version, ...toInput(r) }
        : staffProduct(r, actor, settings),
    );
  if (!q) {
    if (!admin) {
      const rows = await db.query(
        productSelect +
          ` WHERE ${activeClause} ORDER BY p.normalized_part LIMIT ${SEARCH_RESULT_LIMIT}`,
      );
      return mapRows(rows.rows);
    }
    const totalRows = Number(
      (await one(
        db,
        `SELECT count(*)::int AS n
           FROM products p
           JOIN product_pricing pp ON pp.product_id = p.id
           WHERE ${productWhere}`,
      ))!.n,
    );
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages - 1);
    const safeOffset = safePage * pageSize;
    const rows = await db.query(
      productSelect +
        ` WHERE ${productWhere} ORDER BY p.normalized_part LIMIT $1 OFFSET $2`,
      [pageSize, safeOffset],
    );
    const selectableItems = (
      await db.query(
        `SELECT p.id,p.version
         FROM products p
         JOIN product_pricing pp ON pp.product_id = p.id
         WHERE ${productWhere}
         ORDER BY p.normalized_part
         LIMIT $1 OFFSET $2`,
        [selectionLimit, selectionOffset],
      )
    ).rows;
    return {
      items: mapRows(rows.rows),
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
      hasMore: safePage + 1 < totalPages,
      minimumFilter,
      statusFilter,
      methodFilter,
      contentFilter,
      selectableItems,
      selectionLimitReached: totalRows > selectionLimit,
      selectionOffset,
      selectionHasMore: selectionOffset + selectableItems.length < totalRows,
    };
  }
  if (!admin) {
    const partMatches = await getRankedPartMatches(
      db,
      activeClause,
      q,
      escaped,
      SEARCH_RESULT_LIMIT,
    );
    const rankedIds = partMatches.map((row) => row.id);
    if (rankedIds.length < SEARCH_RESULT_LIMIT) {
      const textMatches = await getRankedTextMatches(
        db,
        activeClause,
        "%" + escaped + "%",
        rankedIds,
        SEARCH_RESULT_LIMIT - rankedIds.length,
      );
      rankedIds.push(...textMatches.map((row) => row.id));
    }
    const rows = await hydrateLookupProductsByIds(db, rankedIds);
    return rows.map((row) => lookupProduct(row, actor, settings));
  }
  const partTotal = await countRankedPartMatches(db, productWhere, q, escaped);
  const needsFallback =
    partTotal < offset + pageSize || partTotal < selectionLimit;
  const partIdsForFallback = needsFallback
    ? (await getRankedPartMatches(db, productWhere, q, escaped, partTotal)).map(
        (row) => row.id,
      )
    : [];
  const textTotal = needsFallback
    ? await countRankedTextMatches(
        db,
        productWhere,
        "%" + escaped + "%",
        partIdsForFallback,
      )
    : 0;
  const totalRows = partTotal + textTotal;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const safeOffset = safePage * pageSize;
  const pagePartMatches =
    safeOffset < partTotal
      ? await getRankedPartMatches(
          db,
          productWhere,
          q,
          escaped,
          pageSize,
          safeOffset,
        )
      : [];
  const remainingPageSlots = pageSize - pagePartMatches.length;
  const textOffset = Math.max(safeOffset - partTotal, 0);
  const pageTextMatches =
    remainingPageSlots > 0 && needsFallback
      ? await getRankedTextMatches(
          db,
          productWhere,
          "%" + escaped + "%",
          partIdsForFallback,
          remainingPageSlots,
          textOffset,
        )
      : [];
  const rows = await hydrateProductsByIds(
    db,
    [...pagePartMatches, ...pageTextMatches].map((row) => row.id),
  );
  const selectablePartMatches =
    selectionOffset < partTotal
      ? await getRankedPartMatches(
          db,
          productWhere,
          q,
          escaped,
          Math.min(selectionLimit, partTotal - selectionOffset),
          selectionOffset,
        )
      : [];
  const selectableItems = selectablePartMatches.map(({ id, version }) => ({
    id,
    version,
  }));
  if (selectableItems.length < selectionLimit && needsFallback) {
    const selectionTextOffset = Math.max(selectionOffset - partTotal, 0);
    selectableItems.push(
      ...(
        await getRankedTextMatches(
          db,
          productWhere,
          "%" + escaped + "%",
          partIdsForFallback,
          selectionLimit - selectableItems.length,
          selectionTextOffset,
        )
      ).map(({ id, version }) => ({ id, version })),
    );
  }
  return {
    items: mapRows(rows),
    page: safePage,
    pageSize,
    totalRows,
    totalPages,
    hasMore: safePage + 1 < totalPages,
    minimumFilter,
    statusFilter,
    methodFilter,
    contentFilter,
    selectableItems,
    selectionLimitReached: totalRows > selectionLimit,
    selectionOffset,
    selectionHasMore: selectionOffset + selectableItems.length < totalRows,
  };
}
