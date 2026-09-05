import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";

const root = () => path.resolve(process.env.UPLOAD_DIR || ".data/uploads", "product-images");
const rowSelect = `SELECT id,product_id,original_name,mime_type,caption,display_order,version,created_at,updated_at FROM product_images`;

export async function list(db: DB, actor: Actor, productId: string) {
  requirePermission(actor, "PRODUCT_VIEW");
  return (await db.query(`${rowSelect} WHERE product_id=$1 ORDER BY display_order`, [productId])).rows;
}

export async function upload(db: DB, actor: Actor, productId: string, file: File, caption = "") {
  requirePermission(actor, "PRODUCT_EDIT");
  assert(file.size > 0 && file.size <= 5 * 1024 * 1024, 400, "Image must be 5 MB or smaller");
  assert(await one(db, "SELECT id FROM products WHERE id=$1 FOR UPDATE", [productId]), 404, "Product not found");
  const count = Number((await one(db, "SELECT count(*)::int AS n FROM product_images WHERE product_id=$1", [productId]))?.n ?? 0);
  assert(count < 5, 400, "A product can have a maximum of five images");
  const input = Buffer.from(await file.arrayBuffer());
  let metadata;
  try { metadata = await sharp(input).metadata(); } catch { assert(false, 400, "File is not a valid JPEG, PNG, or WebP image"); }
  const format = metadata!.format;
  assert(format === "jpeg" || format === "png" || format === "webp", 400, "Only JPEG, PNG, and WebP images are supported");
  const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  const id = randomUUID();
  const dir = path.join(root(), productId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const original = path.join(dir, `${id}.${format === "jpeg" ? "jpg" : format}`);
  const thumb = path.join(dir, `${id}.thumb.webp`);
  await fs.writeFile(original, input, { mode: 0o600 });
  try {
    await sharp(input).rotate().resize(640, 640, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(thumb);
    await db.query(`INSERT INTO product_images(id,product_id,original_path,thumbnail_path,original_name,mime_type,caption,display_order,uploader_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, productId, original, thumb, path.basename(file.name).slice(0, 200), mime, caption.trim().slice(0, 300), count, actor.id]);
  } catch (error) {
    await Promise.allSettled([fs.unlink(original), fs.unlink(thumb)]);
    throw error;
  }
  await audit(db, actor.id, "PRODUCT_IMAGE_UPLOAD", "products", productId, null, { imageId: id, name: path.basename(file.name), order: count });
  return { id };
}

export async function update(db: DB, actor: Actor, productId: string, raw: unknown) {
  requirePermission(actor, "PRODUCT_EDIT");
  const data = z.object({ images: z.array(z.object({ id: z.string().uuid(), caption: z.string().max(300), version: z.number().int().positive() })).min(1).max(5) }).strict().parse(raw);
  return db.transaction(async tx => {
    const existing = (await tx.query(`${rowSelect} WHERE product_id=$1 FOR UPDATE`, [productId])).rows;
    assert(existing.length === data.images.length && data.images.every(x => existing.some((e:any) => e.id === x.id && e.version === x.version)), 409, "Images changed. Reload before saving");
    await tx.query("UPDATE product_images SET display_order=display_order+10 WHERE product_id=$1", [productId]);
    for (let i=0;i<data.images.length;i++) await tx.query("UPDATE product_images SET caption=$3,display_order=$4,version=version+1,updated_at=now() WHERE id=$1 AND product_id=$2", [data.images[i].id, productId, data.images[i].caption.trim(), i]);
    await audit(tx, actor.id, "PRODUCT_IMAGE_REORDER", "products", productId, existing.map((x:any)=>x.id), data.images.map(x=>x.id));
    return list(tx, actor, productId);
  });
}

export async function remove(db: DB, actor: Actor, productId: string, imageId: string, version: number) {
  requirePermission(actor, "PRODUCT_EDIT");
  const row = await one(db, "SELECT * FROM product_images WHERE id=$1 AND product_id=$2", [imageId, productId]);
  assert(row, 404, "Image not found"); assert(row.version === version, 409, "Image changed. Reload before deleting");
  await db.query("DELETE FROM product_images WHERE id=$1", [imageId]);
  await db.query("WITH ranked AS (SELECT id,row_number() OVER(ORDER BY display_order)-1 n FROM product_images WHERE product_id=$1) UPDATE product_images p SET display_order=ranked.n FROM ranked WHERE p.id=ranked.id", [productId]);
  await Promise.allSettled([fs.unlink(row.original_path), fs.unlink(row.thumbnail_path)]);
  await audit(db, actor.id, "PRODUCT_IMAGE_DELETE", "products", productId, { imageId }, null);
  return { id: imageId };
}

export async function file(db: DB, actor: Actor, imageId: string, thumbnail: boolean) {
  requirePermission(actor, "PRODUCT_VIEW");
  const row = await one(db, "SELECT * FROM product_images WHERE id=$1", [imageId]);
  assert(row, 404, "Image not found");
  const filePath = path.resolve(thumbnail ? row.thumbnail_path : row.original_path);
  assert(filePath.startsWith(root() + path.sep), 500, "Invalid image storage path");
  return { data: await fs.readFile(filePath), mime: thumbnail ? "image/webp" : row.mime_type, name: row.original_name };
}

export async function removeFilesForProduct(db: DB, productId: string) {
  const rows = (await db.query("SELECT original_path,thumbnail_path FROM product_images WHERE product_id=$1", [productId])).rows;
  return rows;
}
