import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { AppError, assert } from "../core/errors";
import { audit } from "../core/audit";
import { type Actor, has, requirePermission } from "../auth/service";
import { decimal, normalizePart, percent } from "../pricing/engine";
import { saveProduct } from "../products/service";

export const normalizeDescription = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US");
const editable = z
  .object({
    reference: z.string().trim().max(100).default(""),
    description: z.string().trim().min(1).max(1000),
    unit: z.string().trim().min(1).max(20).default("pcs"),
    suggestedUnitPrice: decimal,
    suggestedDiscount: percent.default("0"),
  })
  .strict();
const manage = (actor: Actor) =>
  requirePermission(actor, "REUSABLE_CUSTOM_MANAGE");
const canQuote = (actor: Actor) =>
  assert(
    has(actor, "QUOTE_CREATE") || has(actor, "QUOTE_EDIT"),
    403,
    "You do not have permission to use reusable custom items",
  );

async function catalogMatch(db: DB, reference: string) {
  if (!reference) return null;
  return one(
    db,
    `SELECT p.id,p.part_number FROM products p WHERE p.normalized_part=$1 UNION ALL SELECT p.id,p.part_number FROM product_aliases a JOIN products p ON p.id=a.product_id WHERE a.normalized=$1 LIMIT 1`,
    [normalizePart(reference)],
  );
}
async function duplicate(
  db: DB,
  reference: string,
  description: string,
  exclude?: string,
) {
  return one(
    db,
    "SELECT * FROM reusable_custom_items WHERE status='ACTIVE' AND id<>coalesce($3::uuid,'00000000-0000-0000-0000-000000000000'::uuid) AND (($1<>'' AND normalized_reference=$1) OR normalized_description=$2) ORDER BY CASE WHEN $1<>'' AND normalized_reference=$1 THEN 0 ELSE 1 END LIMIT 1",
    [
      reference ? normalizePart(reference) : "",
      normalizeDescription(description),
      exclude ?? null,
    ],
  );
}
export async function search(db: DB, actor: Actor, q: string) {
  canQuote(actor);
  const term = q.trim().slice(0, 100);
  return (
    await db.query(
      "SELECT r.id,r.reference,r.description,r.unit,r.suggested_unit_price AS \"suggestedUnitPrice\",r.suggested_discount AS \"suggestedDiscount\",r.usage_count,r.last_used_at,r.version FROM reusable_custom_items r WHERE r.status='ACTIVE' AND ($1='' OR r.reference ILIKE '%'||$1||'%' OR r.description ILIKE '%'||$1||'%') ORDER BY CASE WHEN upper(r.reference)=upper($1) THEN 0 ELSE 1 END,r.usage_count DESC,r.updated_at DESC LIMIT 20",
      [term],
    )
  ).rows;
}
export async function list(db: DB, actor: Actor, q = "", status = "ACTIVE") {
  manage(actor);
  assert(
    ["ACTIVE", "CONVERTED", "ALL"].includes(status),
    400,
    "Invalid status filter",
  );
  return (
    await db.query(
      "SELECT r.*,u.name creator,p.part_number product_part FROM reusable_custom_items r JOIN users u ON u.id=r.created_by LEFT JOIN products p ON p.id=r.product_id WHERE ($1='ALL' OR r.status=$1) AND ($2='' OR r.reference ILIKE '%'||$2||'%' OR r.description ILIKE '%'||$2||'%') ORDER BY r.updated_at DESC LIMIT 500",
      [status, q.trim().slice(0, 100)],
    )
  ).rows;
}
export async function update(db: DB, actor: Actor, id: string, input: unknown) {
  manage(actor);
  const raw = z
    .object({ ...editable.shape, version: z.coerce.number().int() })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    await tx.query(
      "LOCK TABLE reusable_custom_items IN SHARE ROW EXCLUSIVE MODE",
    );
    const old = await one(
      tx,
      "SELECT * FROM reusable_custom_items WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(old, 404, "Reusable item not found");
    assert(old.status === "ACTIVE", 409, "Converted items cannot be edited");
    assert(
      old.version === raw.version,
      409,
      "Reusable item changed. Reload and try again",
    );
    const product = await catalogMatch(tx, raw.reference);
    if (product)
      throw new AppError(
        409,
        `Reference matches catalog item ${product.part_number}. Use the catalog item instead`,
        {
          code: "CATALOG_MATCH",
          productId: product.id,
          partNumber: product.part_number,
        },
      );
    const same = await duplicate(tx, raw.reference, raw.description, id);
    assert(
      !same,
      409,
      `Reusable item already exists: ${same?.reference || same?.description}`,
    );
    const result = await one(
      tx,
      "UPDATE reusable_custom_items SET reference=$2,normalized_reference=$3,description=$4,normalized_description=$5,unit=$6,suggested_unit_price=$7,suggested_discount=$8,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
      [
        id,
        raw.reference,
        raw.reference ? normalizePart(raw.reference) : "",
        raw.description,
        normalizeDescription(raw.description),
        raw.unit,
        raw.suggestedUnitPrice,
        raw.suggestedDiscount,
      ],
    );
    await audit(
      tx,
      actor.id,
      "REUSABLE_CUSTOM_EDIT",
      "reusable_custom_items",
      id,
      old,
      result,
    );
    return result;
  });
}
export async function remove(db: DB, actor: Actor, id: string) {
  manage(actor);
  return db.transaction(async (tx) => {
    const old = await one(
      tx,
      "SELECT * FROM reusable_custom_items WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(old, 404, "Reusable item not found");
    await tx.query("DELETE FROM reusable_custom_items WHERE id=$1", [id]);
    await audit(
      tx,
      actor.id,
      "REUSABLE_CUSTOM_DELETE",
      "reusable_custom_items",
      id,
      old,
      null,
    );
    return { ok: true };
  });
}
export async function convert(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  manage(actor);
  requirePermission(actor, "PRODUCT_CREATE");
  const body = z
    .object({ version: z.coerce.number().int(), product: z.unknown() })
    .strict()
    .parse(input);
  return db.transaction(async (tx) => {
    const item = await one(
      tx,
      "SELECT * FROM reusable_custom_items WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      item && item.status === "ACTIVE",
      409,
      "Reusable item is not active",
    );
    assert(
      item.version === body.version,
      409,
      "Reusable item changed. Reload and try again",
    );
    const product = await saveProduct(tx, actor, body.product);
    await tx.query(
      "UPDATE reusable_custom_items SET status='CONVERTED',product_id=$2,version=version+1,updated_at=now() WHERE id=$1",
      [id, product.id],
    );
    await audit(
      tx,
      actor.id,
      "REUSABLE_CUSTOM_CONVERT",
      "reusable_custom_items",
      id,
      item,
      { productId: product.id },
    );
    return product;
  });
}

export async function attachToSavedQuote(
  db: DB,
  actor: Actor,
  lines: any[],
  oldLines: any[] = [],
) {
  await db.query(
    "LOCK TABLE reusable_custom_items IN SHARE ROW EXCLUSIVE MODE",
  );
  const oldCounts = new Map<string, number>();
  for (const line of oldLines)
    if (line.reusableItemId)
      oldCounts.set(
        line.reusableItemId,
        (oldCounts.get(line.reusableItemId) || 0) + 1,
      );
  const newCounts = new Map<string, number>();
  for (const line of lines) {
    if (line.source !== "CUSTOM" || line.unresolved || !line.price) continue;
    let item = null;
    let resolution = "SELECTED";
    if (line.input.reusableItemId)
      item = await one(db, "SELECT * FROM reusable_custom_items WHERE id=$1", [
        line.input.reusableItemId,
      ]);
    if (item?.status === "CONVERTED") {
      const product = await one(
        db,
        "SELECT part_number FROM products WHERE id=$1",
        [item.product_id],
      );
      assert(
        false,
        409,
        `Reusable item was converted to catalog product ${product?.part_number}. Use the catalog item instead`,
      );
    }
    if (!item) {
      item = await duplicate(db, line.input.partNumber, line.input.description);
      if (item) resolution = "EXISTING";
    }
    if (!item) {
      const product = await catalogMatch(db, line.input.partNumber);
      if (product)
        throw new AppError(
          409,
          `Reference matches catalog item ${product.part_number}. Use the catalog item instead`,
          {
            code: "CATALOG_MATCH",
            productId: product.id,
            partNumber: product.part_number,
          },
        );
      const id = randomUUID();
      item = await one(
        db,
        "INSERT INTO reusable_custom_items(id,reference,normalized_reference,description,normalized_description,unit,suggested_unit_price,suggested_discount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [
          id,
          line.input.partNumber,
          line.input.partNumber ? normalizePart(line.input.partNumber) : "",
          line.input.description,
          normalizeDescription(line.input.description),
          line.input.unit,
          line.input.unitPriceExcl,
          line.input.discount,
          actor.id,
        ],
      );
      await audit(
        db,
        actor.id,
        "REUSABLE_CUSTOM_CREATE",
        "reusable_custom_items",
        id,
        null,
        item,
      );
      resolution = "CREATED";
    }
    line.reusableItemId = item!.id;
    line.reusableResolution = resolution;
    line.reusableItem = {
      id: item!.id,
      reference: item!.reference,
      description: item!.description,
    };
    line.input.reusableItemId = item!.id;
    newCounts.set(item!.id, (newCounts.get(item!.id) || 0) + 1);
  }
  for (const [itemId, count] of newCounts) {
    const increase = Math.max(0, count - (oldCounts.get(itemId) || 0));
    if (increase) {
      await db.query(
        "UPDATE reusable_custom_items SET usage_count=usage_count+$2,last_used_at=now(),updated_at=now() WHERE id=$1",
        [itemId, increase],
      );
      await audit(
        db,
        actor.id,
        "REUSABLE_CUSTOM_USE",
        "reusable_custom_items",
        itemId,
        null,
        { quotationLines: increase },
      );
    }
  }
  return lines;
}
