import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import Decimal from "decimal.js";
import { type DB, one } from "../core/db";
import { audit, json } from "../core/audit";
import { assert } from "../core/errors";
import {
  type Actor,
  PERMISSIONS,
  requirePermission,
  passwordSchema,
  usernameSchema,
} from "../auth/service";
import {
  percent,
  decimal,
  productInput,
  validateProduct,
  masterPrice,
  normalizePart,
  sellingLevels,
  levelPrice,
  levelCode,
} from "../pricing/engine";
import { getProduct, toInput, saveProduct } from "../products/service";
export async function settings(db: DB) {
  return (await one(db, "SELECT data FROM settings WHERE id=1"))!.data;
}
const settingsSchema = z
  .object({
    companyName: z.string().trim().min(1).max(100),
    companyArabic: z.string().max(100),
    currency: z.literal("SAR"),
    vat: percent,
    draftPrefix: z.string().regex(/^[A-Z]{1,8}$/),
    quotePrefix: z.string().regex(/^[A-Z]{1,8}$/),
    staffDiscount: percent,
    minimumVisible: z.boolean(),
    showMaxDiscount: z.boolean(),
    allowOfflineCache: z.boolean(),
    pdfUnitPrices: z.enum(["BOTH", "EXCL", "INCL"]),
    backupRetentionDays: z.number().int().min(3).max(365),
  })
  .strict();
export async function saveSettings(db: DB, actor: Actor, input: unknown) {
  requirePermission(actor, "SETTINGS_MANAGE");
  const data = settingsSchema.parse(input);
  return db.transaction(async (tx) => {
    const before = await settings(tx);
    await tx.query("UPDATE settings SET data=$1,version=version+1 WHERE id=1", [
      json(data),
    ]);
    await tx.query("UPDATE roles SET max_discount=$1 WHERE id='STAFF'", [
      data.staffDiscount,
    ]);
    await audit(tx, actor.id, "SETTINGS_CHANGE", "settings", "1", before, data);
    return data;
  });
}
export async function dashboard(db: DB) {
  return {
    products: await one(
      db,
      `SELECT count(*) AS total,count(*) FILTER(WHERE p.active) AS active,count(*) FILTER(WHERE method='COST_MARKUP') AS markup,count(*) FILTER(WHERE method='LIST_DISCOUNT') AS discount,count(*) FILTER(WHERE minimum_enabled) AS protected,count(*) FILTER(WHERE p.updated_at::date=current_date) AS updated FROM products p JOIN product_pricing pp ON p.id=pp.product_id`,
    ),
    quotes: await one(
      db,
      `SELECT count(*) FILTER(WHERE status='DRAFT') AS drafts,count(*) FILTER(WHERE status='ISSUED' AND issued_at::date=current_date) AS today FROM quotations`,
    ),
    imports: await one(
      db,
      `SELECT count(*) FILTER(WHERE status IN ('UPLOADED','PROCESSING','AWAITING_REVIEW','CONFIRMED')) AS pending,count(*) FILTER(WHERE status='FAILED') AS errors FROM import_jobs`,
    ),
    duplicates: (await one(
      db,
      `SELECT count(*) AS count FROM import_rows r JOIN import_jobs j ON j.id=r.job_id WHERE r.duplicate_id IS NOT NULL AND j.status='AWAITING_REVIEW'`,
    ))!.count,
  };
}
const userSchema = z
  .object({
    username: usernameSchema,
    name: z.string().trim().min(1).max(100),
    role: z.string().min(1).max(50),
    permissions: z.array(z.enum(PERMISSIONS)).default([]),
    maxDiscount: percent.nullable().default(null),
    disabled: z.boolean().default(false),
    password: passwordSchema.optional(),
  })
  .strict();
export async function saveUser(
  db: DB,
  actor: Actor,
  input: unknown,
  id?: string,
) {
  requirePermission(actor, "USER_MANAGE");
  const data = userSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM settings WHERE id=1 FOR UPDATE");
    assert(
      await one(tx, "SELECT id FROM roles WHERE id=$1", [data.role]),
      400,
      "Role does not exist",
    );
    if (id === actor.id)
      assert(
        !data.disabled && data.role === "ADMIN",
        400,
        "You cannot disable or demote your own administrator account",
      );
    const before = id
      ? await one(
          tx,
          "SELECT id,username,name,role_id,permissions,max_discount,disabled FROM users WHERE id=$1",
          [id],
        )
      : null;
    if (id) assert(before, 404, "User not found");
    else assert(data.password, 400, "Password is required");
    const uid = id ?? randomUUID();
    if (id) {
      await tx.query(
        "UPDATE users SET username=$2,name=$3,role_id=$4,permissions=$5,max_discount=$6,disabled=$7 WHERE id=$1",
        [
          id,
          data.username,
          data.name,
          data.role,
          data.permissions,
          data.maxDiscount,
          data.disabled,
        ],
      );
      if (data.password)
        await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
          id,
          await hash(data.password),
        ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
    } else
      await tx.query(
        "INSERT INTO users(id,username,name,role_id,permissions,max_discount,disabled,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          uid,
          data.username,
          data.name,
          data.role,
          data.permissions,
          data.maxDiscount,
          data.disabled,
          await hash(data.password!),
        ],
      );
    const { password, ...safe } = data;
    await audit(
      tx,
      actor.id,
      id ? "USER_CHANGE" : "USER_CREATE",
      "users",
      uid,
      before,
      safe,
    );
    return { id: uid };
  });
}
export async function saveRole(db: DB, actor: Actor, input: unknown) {
  requirePermission(actor, "USER_MANAGE");
  const data = z
    .object({
      id: z.string().regex(/^[A-Z_]{2,50}$/),
      permissions: z.array(z.enum(PERMISSIONS)),
      maxDiscount: percent,
    })
    .strict()
    .parse(input);
  assert(data.id !== "ADMIN", 400, "The administrator role is protected");
  return db.transaction(async (tx) => {
    const old = await one(tx, "SELECT * FROM roles WHERE id=$1", [data.id]);
    await tx.query(
      "INSERT INTO roles VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET permissions=$2,max_discount=$3",
      [data.id, data.permissions, data.maxDiscount],
    );
    await tx.query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role_id=$1)",
      [data.id],
    );
    await audit(tx, actor.id, "PERMISSION_CHANGE", "roles", data.id, old, data);
    return { ok: true };
  });
}
export async function saveTaxonomy(
  db: DB,
  actor: Actor,
  kind: "brands" | "categories",
  input: unknown,
  id?: string,
) {
  requirePermission(actor, "PRODUCT_EDIT");
  const data = z
    .object({
      name: z.string().trim().min(1).max(100),
      active: z.boolean().default(true),
      defaultMethod: z
        .enum(["COST_MARKUP", "LIST_DISCOUNT"])
        .default("COST_MARKUP"),
    })
    .strict()
    .parse(input);
  const uid = id ?? randomUUID();
  return db.transaction(async (tx) => {
    const before = id
      ? await one(tx, `SELECT * FROM ${kind} WHERE id=$1`, [id])
      : null;
    if (id) assert(before, 404, "Record not found");
    await tx.query(
      `INSERT INTO ${kind}(id,name,normalized,active) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,normalized=$3,active=$4`,
      [uid, data.name, normalizePart(data.name), data.active],
    );
    if (kind === "brands")
      await tx.query("UPDATE brands SET default_method=$2 WHERE id=$1", [
        uid,
        data.defaultMethod,
      ]);
    await audit(tx, actor.id, "TAXONOMY_CHANGE", kind, uid, before, data);
    return { id: uid };
  });
}
export async function bulkPrice(db: DB, actor: Actor, input: unknown) {
  requirePermission(actor, "PRODUCT_EDIT");
  requirePermission(actor, "COST_VIEW");
  const data = z
    .object({
      items: z
        .array(z.object({ id: z.string().uuid(), version: z.number().int() }))
        .min(1)
        .max(1000),
      operation: z.enum([
        "COST_INCREASE",
        "COST_DECREASE",
        "MARKUP",
        "BASE_DISCOUNT",
        "MINIMUM",
        "REMOVE_MINIMUM",
        "VAT",
        "FIXED_PRICE",
      ]),
      value: decimal,
      sellingLevel: z
        .union([levelCode, z.literal("ALL"), z.literal("DEFAULT")])
        .default("DEFAULT"),
      confirm: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  if (["BASE_DISCOUNT", "VAT", "COST_DECREASE"].includes(data.operation))
    assert(
      new Decimal(data.value).lte(100),
      400,
      "This percentage cannot exceed 100",
    );
  return db.transaction(async (tx) => {
    const preview = [];
    for (const item of [...data.items].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const row = await getProduct(tx, item.id);
      assert(
        row.version === item.version,
        409,
        "Products changed. Generate a new preview",
      );
      const before = toInput(row),
        after = {
          ...before,
          levels: sellingLevels(before).map((l) => ({ ...l })),
        };
      if (
        data.operation === "COST_INCREASE" ||
        data.operation === "COST_DECREASE"
      ) {
        assert(
          after.levels.some((l) => l.active && l.method === "COST_MARKUP"),
          400,
          "Cost updates require cost-markup products",
        );
        after.cost = new Decimal(after.cost)
          .mul(
            new Decimal(1).add(
              new Decimal(data.value)
                .div(100)
                .mul(data.operation === "COST_DECREASE" ? -1 : 1),
            ),
          )
          .toDecimalPlaces(6)
          .toString();
      }
      if (["MARKUP", "BASE_DISCOUNT", "FIXED_PRICE"].includes(data.operation)) {
        const code =
          data.sellingLevel === "DEFAULT"
            ? (before.defaultLevel ?? "END_CUSTOMER")
            : data.sellingLevel;
        const targets = after.levels.filter(
          (l) => l.active && (code === "ALL" || l.code === code),
        );
        assert(
          targets.length,
          400,
          "Selected selling level is not active on " + before.partNumber,
        );
        for (const l of targets) {
          const method =
            data.operation === "MARKUP"
              ? "COST_MARKUP"
              : data.operation === "BASE_DISCOUNT"
                ? "LIST_DISCOUNT"
                : "FIXED";
          assert(
            l.method === method,
            400,
            `Operation requires ${method} for ${before.partNumber} / ${l.code}`,
          );
          if (data.operation === "MARKUP") l.markup = data.value;
          if (data.operation === "BASE_DISCOUNT") l.baseDiscount = data.value;
          if (data.operation === "FIXED_PRICE") l.fixedPrice = data.value;
        }
      }
      if (data.operation === "VAT") after.vat = data.value;
      if (data.operation === "MINIMUM") {
        after.minimum = data.value;
        after.minimumEnabled = true;
      }
      if (data.operation === "REMOVE_MINIMUM") after.minimumEnabled = false;
      validateProduct(productInput.parse(after));
      preview.push({
        id: item.id,
        partNumber: after.partNumber,
        before,
        after,
        oldPrice: masterPrice(before).toFixed(2),
        newPrice: masterPrice(after).toFixed(2),
        levels: after.levels
          .filter((l) => l.active)
          .map((l) => ({
            code: l.code,
            before: levelPrice(
              before,
              sellingLevels(before).find((b) => b.code === l.code)!,
            ).toFixed(2),
            after: levelPrice(after, l).toFixed(2),
          })),
      });
      if (data.confirm)
        await saveProduct(tx, actor, after, item.id, item.version, "BULK");
    }
    return { preview, applied: data.confirm };
  });
}
