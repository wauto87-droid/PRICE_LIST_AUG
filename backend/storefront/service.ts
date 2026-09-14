import { normalizePhone, whatsapp, getStoreUrl } from "./whatsapp";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { DB } from "../core/db";
import { one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import type { Actor } from "../auth/service";
import { requirePermission } from "../auth/service";
import {
  hash as hashPassword,
  verify as verifyPassword,
} from "@node-rs/argon2";
import { appPath, APP_BASE_PATH } from "../../shared/paths";
import { throttle } from "../auth/service";
import fs from "node:fs/promises";
import path from "node:path";
import * as commerce from "./commerce";
import * as operations from "./operations";
import { checkoutQuote } from "./requirements";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const money = (v: unknown) => new Decimal(String(v ?? 0));
const publicSettings = (input: any) => {
  const row = input || { data: {} };
  return {
    enabled: row?.enabled ?? false,
    companyName: row.data?.companyName ?? "AMT Electric",
    companyNameAr: row.data?.companyNameAr ?? "",
    hero: row.data?.hero ?? "",
    heroAr: row.data?.heroAr ?? "",
    supportMobile: row.data?.supportMobile ?? "",
    moyasarPublishableKey: process.env.MOYASAR_PUBLISHABLE_KEY ?? "",
    onlinePaymentEnabled: Boolean(
      process.env.MOYASAR_PUBLISHABLE_KEY &&
      process.env.MOYASAR_SECRET_KEY &&
      (process.env.PUBLIC_URL || process.env.APP_ORIGIN),
    ),
    otpConfigured: Boolean(process.env.OTP_PROVIDER_URL),
    deliveryEnabled: row.data?.deliveryEnabled !== false,
    pickupEnabled: row.data?.pickupEnabled !== false,
    businessEnabled: row.data?.businessEnabled === true,
    operationsEnabled: row.data?.operationsEnabled === true,
    bankTransferEnabled:row.data?.bankTransferEnabled!==false,
    bankInstructions:row.data?.bankInstructions||'',
  };
};

export async function configuration(db: DB, actor?: Actor) {
  const row = await one(db, "SELECT * FROM storefront_settings WHERE id=1");
  if (actor) requirePermission(actor, "STOREFRONT_MANAGE");
  if (actor)
    return {
      ...row,
      data: {
        ...row!.data,
        moyasarConfigured: Boolean(
          process.env.MOYASAR_PUBLISHABLE_KEY && process.env.MOYASAR_SECRET_KEY,
        ),
      },
    };
  const pickupLocations = (
      await db.query(
        "SELECT id,code,name,name_ar FROM warehouses WHERE active AND pickup_enabled ORDER BY code",
      )
    ).rows,
    deliveryZones = (
      await db.query(
        "SELECT id,name,fee::text,free_above::text FROM delivery_zones WHERE active ORDER BY name",
      )
    ).rows;
  return { ...publicSettings(row), pickupLocations, deliveryZones };
}
export async function saveConfiguration(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const data = z
    .object({
      enabled: z.boolean(),
      version: z.number().int().positive(),
      companyName: z.string().trim().min(1).max(120),
      companyNameAr: z.string().trim().max(120).default(""),
      hero: z.string().trim().max(300).default(""),
      heroAr: z.string().trim().max(300).default(""),
      supportMobile: z.string().trim().max(40).default(""),
      deliveryEnabled: z.boolean().default(true),
      pickupEnabled: z.boolean().default(true),
      businessEnabled: z.boolean().optional(),
      operationsEnabled: z.boolean().optional(),
      bankTransferEnabled:z.boolean().optional(),bankInstructions:z.string().max(2000).optional(),
      onlineHoldMinutes: z.number().int().min(5).max(120).optional(),
      bankHoldMinutes: z.number().int().min(30).max(10080).optional(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const before = await one(
      tx,
      "SELECT * FROM storefront_settings WHERE id=1 FOR UPDATE",
    );
    assert(
      before?.version === data.version,
      409,
      "Storefront settings changed. Reload and try again",
    );
    const saved = (
      await tx.query(
        "UPDATE storefront_settings SET enabled=$1,data=$2,version=version+1,updated_at=now() WHERE id=1 RETURNING *",
        [data.enabled, json({ ...before!.data, ...data })],
      )
    ).rows[0];
    await audit(
      tx,
      actor.id,
      "STOREFRONT_SETTINGS_UPDATE",
      "storefront_settings",
      "1",
      before,
      { ...saved, data: { ...saved.data, secrets: "not stored" } },
    );
    return saved;
  });
}

const levelPrice = (row: any) => {
  const method = row.level_method;
  if (method === "FIXED") return money(row.fixed_price);
  if (method === "COST_MARKUP")
    return money(row.cost).mul(money(row.level_markup).add(100)).div(100);
  return money(row.level_list_price)
    .mul(money(100).sub(row.level_discount))
    .div(100);
};
const catalogBase = `SELECT p.id,p.part_number,p.description,p.unit,p.quantity_precision,p.storefront_slug,p.storefront_content,p.details,p.keywords,b.name brand,c.name category,b.id brand_id,c.id category_id,resolved.price_excl,resolved.price_source,pp.vat,
 COALESCE((SELECT sum(quantity) FROM inventory_movements m JOIN warehouses w ON w.id=m.warehouse_id WHERE m.product_id=p.id AND w.active AND m.kind NOT IN ('RESERVE','RELEASE')),0)-COALESCE((SELECT sum(quantity) FROM stock_reservations r WHERE r.product_id=p.id AND r.status='ACTIVE'),0)-COALESCE((SELECT sum(quantity) FROM commerce_holds h WHERE h.product_id=p.id AND h.status='ACTIVE'),0) available
 FROM products p ${commerce.priceJoins("$1", "1")} LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.active AND p.storefront_published`;
async function openStore(db: DB) {
  const store = await one(db, "SELECT * FROM storefront_settings WHERE id=1");
  assert(store?.enabled, 404, "Online store is not available");
  return store;
}
async function publicProduct(db: DB, r: any, account?: any) {
  const resolved = {
    price: r.price_excl == null ? null : String(r.price_excl),
    source: r.price_source,
  };
  const images = (
    await db.query(
      "SELECT id,caption FROM product_images WHERE product_id=$1 ORDER BY display_order,id",
      [r.id],
    )
  ).rows.map((i) => ({
    id: i.id,
    caption: i.caption,
    url: appPath(`/api/v1/storefront/images/${i.id}`),
  }));
  return {
    id: r.id,
    part_number: r.part_number,
    description: r.description,
    unit: r.unit,
    quantityPrecision: r.quantity_precision,
    slug: r.storefront_slug,
    content: {
      description:
        typeof r.storefront_content?.description === "string"
          ? r.storefront_content.description
          : "",
      manufacturer: r.details?.manufacturer,
      productName: r.details?.productName,
      productType: r.details?.productType,
      series: r.details?.series,
      specifications: r.details?.specifications,
      applications: r.details?.applications,
    },
    brand: r.brand,
    category: r.category,
    images,
    priceSource: resolved.source,
    purchasable: resolved.price !== null && money(r.available).gt(0),
    priceExcl: r.price_excl === null ? null : money(r.price_excl).toFixed(2),
    priceIncl:
      r.price_excl === null
        ? null
        : money(r.price_excl).mul(money(r.vat).add(100)).div(100).toFixed(2),
    availability: money(r.available).lte(0)
      ? "BACKORDER"
      : money(r.available).lte(5)
        ? "LIMITED"
        : "IN_STOCK",
  };
}
export async function catalog(db: DB, raw: unknown, account?: any) {
  const input = z
    .object({
      q: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(48).default(24),
      brand: z.string().default(""),
      category: z.string().default(""),
      availability: z
        .enum(["", "IN_STOCK", "LIMITED", "BACKORDER"])
        .default(""),
      sort: z
        .enum(["part", "relevance", "price-asc", "price-desc"])
        .default("relevance"),
    })
    .parse(raw);
  await openStore(db);
  const args: any[] = [
    account?.company_id || null,
    input.q.replace(/[\\%_]/g, "\\$&"),
    input.brand,
    input.category,
    input.availability,
  ];
  const where = `($2='' OR part_number ILIKE '%'||$2||'%' OR description ILIKE '%'||$2||'%' OR keywords ILIKE '%'||$2||'%' OR EXISTS(SELECT 1 FROM product_aliases a WHERE a.product_id=catalog.id AND a.normalized ILIKE '%'||regexp_replace(lower($2),'[^a-z0-9]','','g')||'%')) AND ($3='' OR brand=$3) AND ($4='' OR category=$4) AND ($5='' OR CASE WHEN available<=0 THEN 'BACKORDER' WHEN available<=5 THEN 'LIMITED' ELSE 'IN_STOCK' END=$5)`;
  const total = Number(
    (
      await one(
        db,
        `WITH catalog AS (${catalogBase}) SELECT count(*) n FROM catalog WHERE ${where}`,
        args,
      )
    )?.n || 0,
  );
  const page = Math.min(
    input.page,
    Math.max(1, Math.ceil(total / input.pageSize)),
  );
  const order =
    input.sort === "part" || input.sort === "relevance"
      ? "CASE WHEN lower(part_number)=lower($2) THEN 0 WHEN regexp_replace(lower(part_number),'[^a-z0-9]','','g')=regexp_replace(lower($2),'[^a-z0-9]','','g') THEN 1 WHEN part_number ILIKE $2||'%' THEN 2 ELSE 3 END,part_number,id"
      : `round(price_excl*(100+vat)/100,2) ${input.sort === "price-desc" ? "DESC" : "ASC"} NULLS LAST,part_number,id`;
  const rows = (
    await db.query(
      `WITH catalog AS (${catalogBase}) SELECT * FROM catalog WHERE ${where} ORDER BY ${order} LIMIT $6 OFFSET $7`,
      [...args, input.pageSize, (page - 1) * input.pageSize],
    )
  ).rows;
  if (input.q)
    await db.query(
      "INSERT INTO commerce_searches(query,result_count) VALUES($1,$2) ON CONFLICT(query) DO UPDATE SET count=commerce_searches.count+1,result_count=$2,last_at=now()",
      [input.q.toLowerCase(), total],
    );
  const facets = (
    await db.query(
      `WITH catalog AS (${catalogBase}) SELECT DISTINCT brand,category FROM catalog`,
      [args[0]],
    )
  ).rows;
  return {
    items: await Promise.all(rows.map((r) => publicProduct(db, r, account))),
    page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    brands: [...new Set(facets.map((r) => r.brand).filter(Boolean))].sort(),
    categories: [
      ...new Set(facets.map((r) => r.category).filter(Boolean)),
    ].sort(),
  };
}
export async function productDetail(db: DB, id: string, account?: any) {
  await openStore(db);
  const row = await one(
    db,
    `WITH catalog AS (${catalogBase}) SELECT * FROM catalog WHERE id=$2`,
    [account?.company_id || null, id],
  );
  assert(row, 404, "Product is unavailable");
  return publicProduct(db, row, account);
}
export async function publicImage(db: DB, id: string) {
  await openStore(db);
  const row = await one(
    db,
    "SELECT i.thumbnail_path FROM product_images i JOIN products p ON p.id=i.product_id WHERE i.id=$1 AND p.active AND p.storefront_published",
    [id],
  );
  assert(row, 404, "Image is unavailable");
  const root = path.resolve(
      process.env.UPLOAD_DIR || ".data/uploads",
      "product-images",
    ),
    file = path.resolve(row.thumbnail_path);
  assert(file.startsWith(root + path.sep), 404, "Image is unavailable");
  return fs.readFile(file);
}

export async function requestOtp(db: DB, raw: unknown) {
  const data = z.object({ destination:z.string().trim().min(5).max(200), channel:z.enum(["SMS","EMAIL","WHATSAPP"]), purpose:z.enum(["CHECKOUT","SIGNUP","LOGIN"]).default("CHECKOUT") }).parse(raw);
  assert(data.purpose === "CHECKOUT" || data.channel === "WHATSAPP",400,"Signup and login require WhatsApp verification");
  const destination=data.channel === "WHATSAPP" ? normalizePhone(data.destination) : normalizeContact(data.destination);
  const destinationHash=sha(destination);
  await throttle(db, `store-otp:${destinationHash}`, 5);
  return db.transaction(async tx => {
    await tx.query("INSERT INTO commerce_otp_destinations(destination_hash) VALUES($1) ON CONFLICT DO NOTHING",[destinationHash]);
    const previous=await one(tx,"SELECT sent_at FROM commerce_otp_destinations WHERE destination_hash=$1 FOR UPDATE",[destinationHash]);
    assert(!previous?.sent_at || Date.now()-new Date(previous.sent_at).getTime()>=60000,429,"Wait 60 seconds before requesting another code");
    const code=String(randomInt(100000,1000000)),id=randomUUID();
    if(data.channel === "WHATSAPP") {
      if(process.env.NODE_ENV !== "test" || process.env.WHATSAPP_SERVICE_URL) await whatsapp("send",{destination,code,purpose:data.purpose,storeUrl:getStoreUrl()});
    } else if(process.env.OTP_PROVIDER_URL) {
      const res=await fetch(process.env.OTP_PROVIDER_URL,{method:"POST",signal:AbortSignal.timeout(15000),headers:{"content-type":"application/json",authorization:`Bearer ${process.env.OTP_PROVIDER_TOKEN ?? ""}`},body:JSON.stringify({destination,channel:data.channel,code})});
      assert(res.ok,503,"Unable to send verification code");
    } else assert(process.env.NODE_ENV === "test",503,"OTP delivery provider is not configured");
    await tx.query("UPDATE otp_challenges SET consumed_at=now() WHERE destination_hash=$1 AND purpose=$2 AND consumed_at IS NULL",[destinationHash,`STOREFRONT_${data.purpose}`]);
    await tx.query("INSERT INTO otp_challenges(id,purpose,destination_hash,code_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",[id,`STOREFRONT_${data.purpose}`,destinationHash,sha(`${id}:${code}`)]);
    await tx.query("UPDATE commerce_otp_destinations SET sent_at=now() WHERE destination_hash=$1",[destinationHash]);
    return {id,expiresInSeconds:600,...(process.env.NODE_ENV === "test"?{testCode:code}:{})};
  });
}
export async function verifyOtp(db: DB, raw: unknown) {
  const data = z
    .object({ id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })
    .parse(raw);
  const result = await db.transaction(async (tx) => {
    const row = await one(
      tx,
      "SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE",
      [data.id],
    );
    assert(
      row &&
        !row.consumed_at &&
        !row.verified_at &&
        new Date(row.expires_at) > new Date(),
      400,
      "Verification code is invalid or expired",
    );
    assert(row.attempts < 5, 429, "Too many verification attempts");
    await tx.query(
      "UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1",
      [data.id],
    );
    if (row.code_hash !== sha(`${data.id}:${data.code}`)) return null;
    const token = randomBytes(32).toString("base64url");
    await tx.query(
      "UPDATE otp_challenges SET verified_at=now(),verification_token_hash=$2 WHERE id=$1",
      [data.id, sha(token)],
    );
    return { verificationToken: token };
  });
  assert(result, 400, "Verification code is incorrect");
  return result;
}

async function pricedLines(
  db: DB,
  requested: { productId: string; quantity: string }[],
  account?: any,
  quotation?: any,
) {
  const ids = [...new Set(requested.map((x) => x.productId))];
  assert(
    ids.length === requested.length,
    400,
    "Duplicate cart products are not allowed",
  );
  const rows = (
    await db.query(
      `SELECT p.id,p.part_number,p.description,p.unit,p.quantity_precision FROM products p WHERE p.id=ANY($1::uuid[]) AND p.active AND p.storefront_published`,
      [ids],
    )
  ).rows;
  assert(
    rows.length === ids.length,
    409,
    "One or more cart products are no longer available",
  );
  const map = new Map(rows.map((r: any) => [r.id, r]));
  return Promise.all(
    requested.map(async (item) => {
      const row = map.get(item.productId)!,
        qty = money(item.quantity);
      assert(
        qty.isFinite() &&
          qty.gt(0) &&
          qty.lte(1000000) &&
          qty.decimalPlaces() <= (row.quantity_precision ?? 3),
        400,
        "Enter a valid cart quantity",
      );
      const resolved = await commerce.resolvePrice(
        db,
        row.id,
        item.quantity,
        account,
      );
      const quoted = quotation?.lines.find((l: any) => l.productId === row.id);
      assert(
        resolved.price !== null || quoted,
        409,
        "This product needs a quotation before checkout",
      );
      row.vat = resolved.vat;
      const excl = money(
          quoted?.price?.finalExcl ?? resolved.price,
        ).toDecimalPlaces(2),
        lineExcl = excl.mul(qty).toDecimalPlaces(2),
        vat = lineExcl.mul(row.vat).div(100).toDecimalPlaces(2);
      return {
        priceSource: resolved.source,
        productId: row.id,
        partNumber: row.part_number,
        description: row.description,
        unit: row.unit,
        quantity: qty.toString(),
        unitExcl: excl.toFixed(2),
        vatRate: String(row.vat),
        lineExcl: lineExcl.toFixed(2),
        vat: vat.toFixed(2),
        lineTotal: lineExcl.add(vat).toFixed(2),
      };
    }),
  );
}

const normalizeContact = (value: string) =>
  value.includes("@")
    ? value.trim().toLowerCase()
    : value
        .replace(/[^+0-9]/g, "")
        .replace(/^00/, "+")
        .replace(/^0(?=5)/, "+966");
const cartSchema = z.object({
  requestId: z.string().uuid().optional(),
  coupon: z.string().trim().max(40).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.string().regex(/^\d+(?:\.\d{1,3})?$/),
      }),
    )
    .min(1)
    .max(100),
  fulfillmentMethod: z.enum(["DELIVERY", "PICKUP"]),
  warehouseId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  address: z
    .object({ text: z.string().trim().max(2000).default("") })
    .optional(),
});
const checkoutSchema = cartSchema.extend({
  verificationId: z.string().uuid().optional(),
  verificationToken: z.string().min(20).optional(),
  contact: z
    .object({
      name: z.string().trim().min(1).max(150),
      mobile: z.string().trim().min(5).max(40),
      email: z.string().email().optional(),
    })
    .optional(),
  paymentMethod: z.enum(["MOYASAR", "BANK_TRANSFER", "CREDIT_TERMS"]),
  moyasarToken: z.string().max(200).optional(),
  idempotencyKey: z.string().uuid(),
  quoteHash: z.string().optional(),
});
export async function preview(db: DB, raw: unknown, account?: any) {
  const data = cartSchema.parse(raw),
    store = await openStore(db);
  if (data.fulfillmentMethod === "PICKUP") {
    assert(store.data?.pickupEnabled !== false, 400, "Pickup is unavailable");
    assert(
      data.warehouseId &&
        (await one(
          db,
          "SELECT id FROM warehouses WHERE id=$1 AND active AND pickup_enabled",
          [data.warehouseId],
        )),
      400,
      "Choose an available pickup location",
    );
  } else {
    assert(
      store.data?.deliveryEnabled !== false,
      400,
      "Delivery is unavailable",
    );
    assert(data.zoneId, 400, "Choose a delivery zone");
    assert(data.address?.text, 400, "Enter your delivery address");
  }
  const acceptedQuote = data.requestId
    ? await checkoutQuote(db, account, data.requestId)
    : undefined;
  let lines = await pricedLines(db, data.lines, account, acceptedQuote);
  let quotationId: string | undefined;
  if (data.requestId) {
    const q = acceptedQuote!;
    quotationId = q.id;
    assert(
      q.lines.length === data.lines.length,
      409,
      "Purchase the exact quoted quantities",
    );
    lines = lines.map((l) => {
      const quoted = q.lines.find((x: any) => x.productId === l.productId);
      assert(
        quoted && money(quoted.price.quantity).eq(l.quantity),
        409,
        "Purchase the exact quoted quantities",
      );
      return {
        ...l,
        priceSource: "QUOTE",
        unitExcl: money(quoted.price.finalExcl).toFixed(2),
        lineExcl: money(quoted.price.subtotal).toFixed(2),
        vatRate: String(quoted.price.vatRate),
        vat: money(quoted.price.vatAmount).toFixed(2),
        lineTotal: money(quoted.price.total).toFixed(2),
      };
    });
  }
  let couponId: string | undefined;
  if (data.coupon) {
    const c = (await commerce.activeCampaigns(db, account)).find(
      (c) =>
        c.kind === "COUPON" &&
        c.data.code.toUpperCase() === data.coupon!.toUpperCase(),
    );
    assert(c, 400, "Coupon is invalid or expired");
    const used = await one(
      db,
      "SELECT count(*) n FROM commerce_redemptions r JOIN ecommerce_orders o ON o.id=r.order_id WHERE r.campaign_id=$1 AND o.status NOT IN ('CANCELLED','FAILED')",
      [c.id],
    );
    assert(
      !c.data.usageLimit || Number(used?.n) < c.data.usageLimit,
      409,
      "Coupon usage limit reached",
    );
    let eligible = false;
    lines = lines.map((l) => {
      if (
        l.priceSource !== "PUBLIC" ||
        (c.data.productIds.length && !c.data.productIds.includes(l.productId))
      )
        return l;
      eligible = true;
      const unit = money(l.unitExcl)
          .mul(money(100).sub(c.data.discount))
          .div(100)
          .toDecimalPlaces(2),
        excl = unit.mul(l.quantity).toDecimalPlaces(2),
        vat = excl.mul(l.vatRate).div(100).toDecimalPlaces(2);
      return {
        ...l,
        priceSource: "COUPON",
        unitExcl: unit.toFixed(2),
        lineExcl: excl.toFixed(2),
        vat: vat.toFixed(2),
        lineTotal: excl.add(vat).toFixed(2),
      };
    });
    assert(
      eligible,
      400,
      "Coupon does not apply to these items or negotiated prices",
    );
    couponId = c.id;
  }
  const subtotal = lines.reduce((s, l) => s.add(l.lineExcl), money(0)),
    vat = lines.reduce((s, l) => s.add(l.vat), money(0));
  let deliveryFee = money(0);
  if (data.fulfillmentMethod === "DELIVERY") {
    const zone = await one(
      db,
      "SELECT * FROM delivery_zones WHERE id=$1 AND active",
      [data.zoneId],
    );
    assert(zone, 400, "Delivery zone is unavailable");
    deliveryFee =
      zone.free_above !== null && subtotal.gte(zone.free_above)
        ? money(0)
        : money(zone.fee);
  }
  const totals = {
    subtotal: subtotal.toFixed(2),
    vat: vat.toFixed(2),
    deliveryFee: deliveryFee.toFixed(2),
    total: subtotal.add(vat).add(deliveryFee).toFixed(2),
  };
  return {
    lines,
    totals,
    quotationId,
    couponId,
    quoteHash: sha(JSON.stringify({ lines, totals, quotationId, couponId })),
  };
}
function verifiedContact(otp: any, token: string | undefined, contact: any) {
  return (
    otp?.verified_at &&
    new Date(otp.expires_at) > new Date() &&
    token &&
    otp.verification_token_hash === sha(token) &&
    contact &&
    [contact.mobile, contact.email]
      .filter(Boolean)
      .some((v) => sha(normalizeContact(v)) === otp.destination_hash)
  );
}
const orderResult = (order: any, payment?: any) => ({
  orderId: order.id,
  orderNumber: order.number,
  status: order.status,
  totals: order.totals,
  redirectUrl: payment?.provider_payload?.redirectUrl || null,
  paymentReference: payment?.provider_reference || null,
});
export async function checkout(db: DB, raw: unknown, account?: any) {
  await operations.expireHolds(db);
  const data = checkoutSchema.parse(raw);
  const fingerprint = sha(
    JSON.stringify({
      ...data,
      moyasarToken: undefined,
      quoteHash: undefined,
      verificationToken: undefined,
    }),
  );
  // A committed row reserves the provider ID before any external request. Retries use that same ID.
  const created = await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO storefront_checkout_keys(id) VALUES($1) ON CONFLICT DO NOTHING",
      [data.idempotencyKey],
    );
    await one(
      tx,
      "SELECT id FROM storefront_checkout_keys WHERE id=$1 FOR UPDATE",
      [data.idempotencyKey],
    );
    const existing = await one(
      tx,
      "SELECT * FROM ecommerce_orders WHERE idempotency_key=$1",
      [data.idempotencyKey],
    );
    if (existing) {
      assert(
        existing.request_hash === fingerprint,
        409,
        "This checkout attempt has different details. Start a new checkout.",
      );
      if (account)
        assert(
          existing.customer_account_id === account.id,
          403,
          "Order access denied",
        );
      else {
        const otp = await one(tx, "SELECT * FROM otp_challenges WHERE id=$1", [
          data.verificationId,
        ]);
        assert(
          otp &&
            data.verificationToken &&
            otp.verification_token_hash === sha(data.verificationToken) &&
            existing.verification_id === data.verificationId,
          403,
          "Order access denied",
        );
      }
      return existing;
    }
    let currentAccount = account;
    if (account) {
      currentAccount = await one(
        tx,
        "SELECT * FROM customer_accounts WHERE id=$1 FOR UPDATE",
        [account.id],
      );
      assert(
        currentAccount?.status === "ACTIVE",
        403,
        "Account is unavailable",
      );
    } else {
      const otp = data.verificationId
        ? await one(tx, "SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE", [
            data.verificationId,
          ])
        : null;
      assert(
        otp?.purpose === "STOREFRONT_CHECKOUT" && verifiedContact(otp, data.verificationToken, data.contact) &&
          !otp?.consumed_at,
        403,
        "Verify the checkout contact again; verification is invalid or expired",
      );
      assert(
        data.paymentMethod !== "CREDIT_TERMS",
        403,
        "Credit terms require an approved business account",
      );
    }
    if (currentAccount?.company_id) {
      const company = await commerce.companyFor(
        tx,
        currentAccount,
        false,
        true,
      );
      currentAccount = {
        ...currentAccount,
        credit_enabled: company.credit_enabled,
        credit_limit: company.credit_limit,
      };
    }
    if (data.coupon)
      await tx.query(
        "SELECT id FROM commerce_campaigns WHERE kind='COUPON' AND upper(data->>'code')=upper($1) FOR UPDATE",
        [data.coupon],
      );
    const quote = await preview(tx, data, currentAccount);
    if(data.paymentMethod==='BANK_TRANSFER'){const config:any=await configuration(tx);assert(config.bankTransferEnabled,400,'Bank transfer is unavailable');}
    if (data.quoteHash)
      assert(
        data.quoteHash === quote.quoteHash,
        409,
        "Prices changed. Review the updated order total before placing your order.",
      );
    if (data.paymentMethod === "MOYASAR") {
      assert(data.moyasarToken, 400, "Payment token is required");
      assert(
        process.env.MOYASAR_PUBLISHABLE_KEY &&
          process.env.MOYASAR_SECRET_KEY &&
          (process.env.PUBLIC_URL || process.env.APP_ORIGIN),
        503,
        "Online payment is not configured",
      );
      assert(
        money(quote.totals.total).gt(0),
        400,
        "Card payment requires a positive total",
      );
    }
    if (data.paymentMethod === "CREDIT_TERMS") {
      assert(
        currentAccount?.credit_enabled,
        403,
        "Credit terms are not enabled for this account",
      );
      const used = money(
        (
          await one(
            tx,
            "SELECT COALESCE(sum(amount),0)::text used FROM commerce_credit_entries WHERE company_id=$1",
            [currentAccount.company_id],
          )
        )?.used,
      );
      assert(
        used.add(quote.totals.total).lte(currentAccount.credit_limit || 0),
        409,
        "This order exceeds the available customer credit limit",
      );
    }
    const id = randomUUID(),
      number = `WEB-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`;
    await tx.query(
      "INSERT INTO ecommerce_orders(id,number,customer_account_id,guest_contact,status,fulfillment_method,warehouse_id,address,lines,totals,payment_method,idempotency_key,request_hash,verification_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        id,
        number,
        account?.id || null,
        account ? null : json(data.contact),
        data.paymentMethod === "MOYASAR" ? "PENDING_PAYMENT" : "PENDING_REVIEW",
        data.fulfillmentMethod,
        data.fulfillmentMethod === "PICKUP" ? data.warehouseId : null,
        json({ ...data.address, zoneId: data.zoneId }),
        json(quote.lines),
        json(quote.totals),
        data.paymentMethod,
        data.idempotencyKey,
        fingerprint,
        account ? null : data.verificationId,
      ],
    );
    await tx.query("UPDATE ecommerce_orders SET company_id=$2 WHERE id=$1", [
      id,
      currentAccount?.company_id || null,
    ]);
    if (quote.quotationId)
      await tx.query(
        "UPDATE ecommerce_orders SET quotation_id=$2 WHERE id=$1",
        [id, quote.quotationId],
      );
    if (quote.couponId)
      await tx.query(
        "INSERT INTO commerce_redemptions(campaign_id,order_id) VALUES($1,$2)",
        [quote.couponId, id],
      );
    await operations.reserveCheckout(
      tx,
      id,
      quote.lines,
      data.fulfillmentMethod === "PICKUP" ? data.warehouseId : undefined,
      data.paymentMethod,
    );
    if (data.paymentMethod === "CREDIT_TERMS")
      await tx.query(
        "INSERT INTO commerce_credit_entries(id,company_id,order_id,amount,kind,idempotency_key) VALUES($1,$2,$3,$4,'COMMIT',$5)",
        [
          randomUUID(),
          currentAccount.company_id,
          id,
          quote.totals.total,
          "COMMIT:" + id,
        ],
      );
    await commerce.event(tx, {
      orderId: id,
      companyId: currentAccount?.company_id,
      accountId: account?.id,
      kind: "ORDER_SUBMITTED",
      message: "Order " + number + " submitted.",
    });
    if (!account)
      await tx.query(
        "UPDATE otp_challenges SET consumed_at=now() WHERE id=$1",
        [data.verificationId],
      );
    if (data.paymentMethod === "MOYASAR") {
      const paymentId = randomUUID();
      await tx.query(
        "INSERT INTO payment_transactions(id,ecommerce_order_id,provider,provider_reference,status,amount,currency,request_key,provider_payload) VALUES($1::uuid,$2,'MOYASAR',$1::uuid::text,'CREATED',$3,'SAR',$4,'{}')",
        [paymentId, id, quote.totals.total, data.idempotencyKey],
      );
    }
    return (await one(tx, "SELECT * FROM ecommerce_orders WHERE id=$1", [id]))!;
  });
  if (created.payment_method !== "MOYASAR") return orderResult(created);
  let payment = (await one(
    db,
    "SELECT * FROM payment_transactions WHERE ecommerce_order_id=$1",
    [created.id],
  ))!;
  if (payment.provider_payload?.status) return orderResult(created, payment);
  // Moyasar given_id guarantees at most one charge, including an uncertain network response.
  const base = new URL(process.env.PUBLIC_URL || process.env.APP_ORIGIN!);
  const callback = new URL(appPath("/store"), base.origin);
  callback.searchParams.set("payment", "return");
  const res = await fetch("https://api.moyasar.com/v1/payments", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.MOYASAR_PUBLISHABLE_KEY}:`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      given_id: payment.provider_reference,
      amount: money(created.totals.total).mul(100).toNumber(),
      currency: "SAR",
      description: `Order ${created.number}`,
      callback_url: callback.toString(),
      metadata: { order_id: created.id },
      source: { type: "token", token: data.moyasarToken },
    }),
  });
  if (!res.ok) {
    // An idempotency conflict can mean the first request succeeded. Fetch its authoritative result.
    if (res.status === 409)
      return {
        ...(await confirmMoyasarPayment(db, payment.provider_reference)),
        orderId: created.id,
      };
    assert(
      false,
      502,
      "Payment could not be started. Retry this checkout to check the same payment safely.",
    );
  }
  const remote = await res.json();
  assert(
    remote.id === payment.provider_reference,
    502,
    "Payment reference mismatch",
  );
  await confirmMoyasarPayment(db, payment.provider_reference);
  payment = (await one(db, "SELECT * FROM payment_transactions WHERE id=$1", [
    payment.id,
  ]))!;
  return orderResult(
    await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [created.id]),
    payment,
  );
}
export async function confirmMoyasarPayment(db: DB, paymentId: string) {
  assert(
    process.env.MOYASAR_SECRET_KEY,
    503,
    "Online payment verification is not configured",
  );
  const res = await fetch(
    `https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      signal: AbortSignal.timeout(20000),
      headers: {
        authorization: `Basic ${Buffer.from(`${process.env.MOYASAR_SECRET_KEY}:`).toString("base64")}`,
      },
    },
  );
  assert(res.ok, 502, "Unable to verify payment. Please retry.");
  const remote = await res.json();
  return db.transaction(async (tx) => {
    const payment = await one(
      tx,
      "SELECT * FROM payment_transactions WHERE provider='MOYASAR' AND provider_reference=$1 FOR UPDATE",
      [paymentId],
    );
    assert(payment, 404, "Payment record not found");
    assert(
      remote.id === paymentId &&
        money(remote.amount).eq(money(payment.amount).mul(100)) &&
        remote.currency === "SAR" &&
        remote.metadata?.order_id === payment.ecommerce_order_id,
      409,
      "Payment verification does not match this order",
    );
    const paid = remote.status === "paid",
      failed = ["failed", "voided"].includes(remote.status);
    const payload = {
      status: remote.status,
      redirectUrl: remote.source?.transaction_url || null,
    };
    await tx.query(
      "UPDATE payment_transactions SET status=CASE WHEN status='PAID' THEN status ELSE $2 END,provider_payload=$3,updated_at=now() WHERE id=$1",
      [
        payment.id,
        paid ? "PAID" : failed ? "FAILED" : "CREATED",
        json(payload),
      ],
    );
    if (paid || failed)
      await operations.settlePayment(tx, payment.ecommerce_order_id, paid);
    if (paid && payment.status !== "PAID")
      await audit(
        tx,
        null,
        "ECOMMERCE_PAYMENT_CONFIRMED",
        "ecommerce_orders",
        payment.ecommerce_order_id,
        null,
        { paymentId },
      );
    const order = await one(tx, "SELECT * FROM ecommerce_orders WHERE id=$1", [
      payment.ecommerce_order_id,
    ]);
    return orderResult(order, {
      provider_reference: paymentId,
      provider_payload: payload,
    });
  });
}
export async function orderStatus(
  db: DB,
  id: string,
  raw: unknown,
  account?: any,
) {
  const data = z
    .object({ verificationToken: z.string().optional() })
    .parse(raw);
  const order = await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [
    id,
  ]);
  assert(order, 404, "Order not found");
  const detail = async () => ({
    ...orderResult(order),
    lines: order.lines,
    fulfillment: order.fulfillment_data,
    fulfillmentStatus: order.sales_order_id
      ? (
          await one(db, "SELECT status FROM sales_orders WHERE id=$1", [
            order.sales_order_id,
          ])
        )?.status
      : null,
    events: (
      await db.query(
        "SELECT message,created_at FROM commerce_events WHERE order_id=$1 ORDER BY created_at DESC",
        [id],
      )
    ).rows,
  });
  if (account && order.customer_account_id === account.id) return detail();
  const otp = order.verification_id
    ? await one(db, "SELECT * FROM otp_challenges WHERE id=$1", [
        order.verification_id,
      ])
    : null;
  assert(
    otp &&
      data.verificationToken &&
      sha(data.verificationToken) === otp.verification_token_hash,
    403,
    "Order access denied",
  );
  return detail();
}

const accountCookie = "amt_store_session";
export async function logoutAccount(db: DB, req: Request) {
  const token = req.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(accountCookie + "="))
    ?.slice(accountCookie.length + 1);
  if (token)
    await db.query(
      "DELETE FROM customer_account_sessions WHERE token_hash=$1",
      [sha(decodeURIComponent(token))],
    );
}
export async function management(db: DB, actor: Actor, q = "", raw: unknown = {}) {
  requirePermission(actor,"STOREFRONT_MANAGE");
  const options=z.object({offset:z.coerce.number().int().min(0).default(0),publication:z.enum(["ALL","PUBLISHED","UNPUBLISHED","INACTIVE","MISSING_IMAGE","MISSING_PRICE"]).default("ALL"),selection:z.boolean().default(false)}).parse(raw);
  const where=`($1='' OR p.part_number ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%') AND ($2='ALL' OR ($2='PUBLISHED' AND p.storefront_published) OR ($2='UNPUBLISHED' AND NOT p.storefront_published) OR ($2='INACTIVE' AND NOT p.active) OR ($2='MISSING_IMAGE' AND NOT EXISTS(SELECT 1 FROM product_images i WHERE i.product_id=p.id)) OR ($2='MISSING_PRICE' AND NOT EXISTS(SELECT 1 FROM product_selling_levels l WHERE l.product_id=p.id AND l.active AND l.code IN ('RETAIL','END_CUSTOMER'))))`;
  const params=[q.slice(0,100),options.publication];
  const total=Number((await one(db,`SELECT count(*) n FROM products p WHERE ${where}`,params))!.n);
  if(options.selection){assert(total<=10000,400,"Narrow the filters to select at most 10,000 products per operation");return {products:(await db.query(`SELECT p.id,p.version FROM products p WHERE ${where} ORDER BY p.part_number,p.id`,params)).rows,total};}
  return {settings:await configuration(db,actor),defaultVat:(await one(db,'SELECT data FROM settings WHERE id=1'))?.data.vat||'15',accounts:await listAccounts(db,actor),zones:(await db.query("SELECT * FROM delivery_zones ORDER BY name")).rows,total,offset:options.offset,
    products:(await db.query(`SELECT p.id,p.part_number,p.description,p.active,p.storefront_published,p.storefront_slug,p.storefront_content,p.version FROM products p WHERE ${where} ORDER BY p.part_number,p.id LIMIT 100 OFFSET $3`,[...params,options.offset])).rows};
}
export async function publishProduct(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const data = z
    .object({
      published: z.boolean(),
      version: z.number().int(),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(150)
        .optional(),
      content: z
        .object({
          description: z.string().max(10000),
          seoTitle: z.string().max(150),
          seoDescription: z.string().max(320),
        })
        .optional(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const row = await one(tx, "SELECT * FROM products WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    assert(row, 404, "Product not found");
    assert(
      row.version === data.version,
      409,
      "Product changed. Reload before publishing",
    );
    if (data.published)
      assert(row.active, 400, "Activate the product before publishing");
    await tx.query(
      "UPDATE products SET storefront_published=$2,storefront_slug=$3,storefront_content=$4,version=version+1 WHERE id=$1",
      [
        id,
        data.published,
        data.slug || row.storefront_slug || id,
        json(
          data.content
            ? { ...row.storefront_content, ...data.content }
            : row.storefront_content,
        ),
      ],
    );
    await audit(
      tx,
      actor.id,
      "STOREFRONT_PRODUCT_PUBLISH",
      "products",
      id,
      { published: row.storefront_published },
      data,
    );
    return { ok: true };
  });
}
export async function saveZone(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const decimal = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);
  const data = z
    .object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(100),
      active: z.boolean(),
      fee: decimal,
      freeAbove: decimal.nullable().default(null),
    })
    .parse(raw);
  const id = data.id || randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO delivery_zones(id,name,active,fee,free_above) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$2,active=$3,fee=$4,free_above=$5",
      [id, data.name, data.active, data.fee, data.freeAbove],
    );
    await audit(
      tx,
      actor.id,
      "STOREFRONT_ZONE_SAVE",
      "delivery_zones",
      id,
      null,
      data,
    );
  });
  return { id };
}
export async function authenticateAccount(db: DB, req: Request) {
  const raw = req.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(accountCookie + "="))
    ?.slice(accountCookie.length + 1);
  if (!raw) return undefined;
  return one(
    db,
    `SELECT a.id,a.customer_id,a.email,a.mobile,a.status,COALESCE(co.price_level,a.price_level) price_level,COALESCE(co.credit_enabled,a.credit_enabled) credit_enabled,COALESCE(co.credit_limit,a.credit_limit) credit_limit,a.company_id,a.company_role,c.name,c.number
    FROM customer_account_sessions s JOIN customer_accounts a ON a.id=s.account_id LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN commerce_companies co ON co.id=a.company_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND a.status='ACTIVE' AND (a.company_id IS NULL OR EXISTS(SELECT 1 FROM commerce_companies co WHERE co.id=a.company_id AND co.status IN ('ACTIVE','PENDING')))`,
    [sha(decodeURIComponent(raw))],
  );
}
export const accountSessionCookie = (token: string) =>
  `${accountCookie}=${encodeURIComponent(token)}; Path=${APP_BASE_PATH || "/"}; HttpOnly; ${process.env.COOKIE_SECURE === "false" ? "" : "Secure; "}SameSite=Lax; Max-Age=${token ? 2592000 : 0}`;

export async function registerAccount(db: DB, raw: unknown) {
  const data = z
    .object({
      accountType: z.enum(["RETAIL", "COMPANY"]).default("COMPANY"),
      name: z.string().trim().min(2).max(150),
      customerCode: z.string().trim().max(80).default(""),
      email: z.string().email(),
      mobile: z.string().trim().min(5).max(40),
      password: z.string().min(8).max(128),
      verificationId: z.string().uuid(),
      verificationToken: z.string().min(20),
      registrationNumber: z.string().max(100).default(""),
      taxNumber: z.string().max(100).default(""),
      address: z.string().max(1000).default(""),
      contactPerson: z.string().max(150).default(""),
      invitationToken: z.string().max(200).optional(),
      supportingDocument: z
        .object({ name: z.string().max(180), base64: z.string().max(1400000) })
        .optional(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const otp = await one(
      tx,
      "SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE",
      [data.verificationId],
    );
    assert(
      otp?.purpose === "STOREFRONT_SIGNUP" && verifiedContact(otp, data.verificationToken, {mobile:normalizePhone(data.mobile)}) && !otp?.consumed_at,
      403,
      "Account verification is invalid or expired",
    );
    data.mobile = normalizePhone(data.mobile);
    const matchingPhones=(await tx.query("SELECT mobile FROM customer_accounts")).rows;
    assert(!matchingPhones.some(a=>{try{return normalizePhone(a.mobile)===data.mobile}catch{return false}}),409,"An account already exists for this mobile");
    assert(
      !(await one(
        tx,
        "SELECT id FROM customer_accounts WHERE lower(email)=lower($1) OR mobile=$2",
        [data.email, data.mobile],
      )),
      409,
      "An account already exists for this email or mobile",
    );
    const customerId = randomUUID(),
      accountId = randomUUID();
    await tx.query(
      "INSERT INTO customers(id,name,number,mobile,reference) VALUES($1,$2,$3,$4,'')",
      [customerId, data.name, data.customerCode, data.mobile],
    );
    await tx.query(
      "INSERT INTO customer_accounts(id,customer_id,email,mobile,password_hash,status,verified_mobile) VALUES($1,$2,lower($3),$4,$5,'ACTIVE',$4)",
      [
        accountId,
        customerId,
        data.email,
        data.mobile,
        await hashPassword(data.password),
      ],
    );
    if (data.invitationToken) {
      const invitation = await one(
        tx,
        "SELECT * FROM commerce_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE",
        [sha(data.invitationToken)],
      );
      assert(
        invitation &&
          invitation.email.toLowerCase() === data.email.toLowerCase(),
        403,
        "Invitation is invalid, expired, or for another email",
      );
      const company = await one(
        tx,
        "SELECT * FROM commerce_companies WHERE id=$1 AND status='ACTIVE'",
        [invitation.company_id],
      );
      assert(company, 403, "Company is unavailable");
      await tx.query(
        "UPDATE customer_accounts SET company_id=$2,company_role='BUYER',customer_id=$3,status='ACTIVE' WHERE id=$1",
        [accountId, company.id, company.customer_id],
      );
      await tx.query("DELETE FROM customers WHERE id=$1", [customerId]);
      await tx.query(
        "UPDATE commerce_invitations SET accepted_at=now() WHERE id=$1",
        [invitation.id],
      );
    } else if (data.accountType === "COMPANY") {
      await tx.query(
        "INSERT INTO commerce_companies(id,customer_id,name,profile) VALUES($1,$2,$3,$4)",
        [
          accountId,
          customerId,
          data.name,
          json({
            registrationNumber: data.registrationNumber,
            taxNumber: data.taxNumber,
            address: data.address,
            contactPerson: data.contactPerson,
            needsReview: !data.registrationNumber,
          }),
        ],
      );
      await tx.query("UPDATE customer_accounts SET company_id=$2 WHERE id=$1", [
        accountId,
        accountId,
      ]);
      if (data.supportingDocument) {
        const file = Buffer.from(data.supportingDocument.base64, "base64");
        assert(
          file.length <= 1024 * 1024 &&
            file.subarray(0, 5).toString() === "%PDF-",
          400,
          "Company registration document must be a PDF up to 1 MB",
        );
        await tx.query(
          "INSERT INTO commerce_attachments(id,company_id,name,mime,content) VALUES($1,$2,$3,'application/pdf',$4)",
          [
            randomUUID(),
            accountId,
            data.supportingDocument.name.replace(/[^\p{L}\p{N}._ -]/gu, "_"),
            file,
          ],
        );
      }
    }
    await tx.query("UPDATE otp_challenges SET consumed_at=now() WHERE id=$1", [
      data.verificationId,
    ]);
    await audit(
      tx,
      null,
      "STOREFRONT_ACCOUNT_REGISTER",
      "customer_accounts",
      accountId,
      null,
      { customerCode: data.customerCode },
    );
    return {
      id: accountId,
      status: "ACTIVE",
      companyStatus: !data.invitationToken && data.accountType === "COMPANY" ? "PENDING" : undefined,
    };
  });
}

export async function loginAccountOtp(db: DB, raw: unknown) {
  const data=z.object({mobile:z.string().max(40),verificationId:z.string().uuid(),verificationToken:z.string().min(20)}).parse(raw);
  const mobile=normalizePhone(data.mobile);
  return db.transaction(async tx=>{
    const otp=await one(tx,"SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE",[data.verificationId]);
    assert(otp?.purpose === "STOREFRONT_LOGIN" && !otp.consumed_at && verifiedContact(otp,data.verificationToken,{mobile}),403,"Login verification is invalid or expired");
    const matches=(await tx.query("SELECT id,mobile FROM customer_accounts")).rows.filter(a=>{try{return normalizePhone(a.mobile)===mobile}catch{return false}});
    assert(matches.length===1,401,"Use password login or contact the administrator to verify your account mobile");
    const account=await one(tx,"SELECT * FROM customer_accounts WHERE id=$1 FOR UPDATE",[matches[0].id]);
    assert(account?.status==='ACTIVE',401,"Account is unavailable");
    if(account.company_id) assert(["ACTIVE","PENDING"].includes((await one(tx,"SELECT status FROM commerce_companies WHERE id=$1",[account.company_id]))?.status),401,"Company account is unavailable");
    await tx.query("UPDATE customer_accounts SET verified_mobile=$2 WHERE id=$1",[account.id,mobile]);
    await tx.query("UPDATE otp_challenges SET consumed_at=now() WHERE id=$1",[otp.id]);
    const token=randomBytes(32).toString("hex");
    await tx.query("INSERT INTO customer_account_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[sha(token),account.id]);
    return {token,account:{id:account.id,email:account.email,mobile}};
  });
}

export async function loginAccount(db: DB, raw: unknown) {
  const data = z
    .object({
      login: z.string().trim().min(3).max(200),
      password: z.string().max(128),
    })
    .parse(raw);
  let normalizedPhone = data.login;
  try {
    normalizedPhone = normalizePhone(data.login);
  } catch (e) {
    // Ignore, maybe it's not a phone number or invalid
  }
  const account = await one(
    db,
    "SELECT * FROM customer_accounts WHERE lower(email)=lower($1) OR mobile=$1 OR mobile=$2",
    [data.login, normalizedPhone],
  );
  const valid = account
    ? await verifyPassword(account.password_hash, data.password)
    : false;
  assert(Boolean(account && valid), 401, "Invalid account or password");
  const activeAccount = account!;
  assert(
    activeAccount.status === "ACTIVE",
    401,
    activeAccount.status === "PENDING"
      ? "Business account is awaiting approval"
      : "Invalid account or password",
  );
  if (activeAccount.company_id)
    assert(
      ["ACTIVE", "PENDING"].includes((await one(db, "SELECT status FROM commerce_companies WHERE id=$1", [activeAccount.company_id]))?.status),
      401,
      "Company account is unavailable",
    );
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO customer_account_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
    [sha(token), activeAccount.id],
  );
  return {
    token,
    account: {
      id: activeAccount.id,
      email: activeAccount.email,
      mobile: activeAccount.mobile,
      priceLevel: activeAccount.price_level,
      creditEnabled: activeAccount.credit_enabled,
    },
  };
}

export async function listAccounts(db: DB, actor: Actor) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  return (
    await db.query(`SELECT a.id,a.email,a.mobile,a.status,a.price_level,a.credit_enabled,a.credit_limit::text,a.created_at,c.name,c.number customer_code
    FROM customer_accounts a LEFT JOIN customers c ON c.id=a.customer_id ORDER BY CASE a.status WHEN 'PENDING' THEN 0 ELSE 1 END,a.created_at DESC`)
  ).rows;
}

export async function updateAccount(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const data = z
    .object({
      status: z.enum(["PENDING", "ACTIVE", "BLOCKED"]),
      priceLevel: z
        .enum(["WHOLESALE", "RETAIL", "END_CUSTOMER"])
        .nullable()
        .default(null),
      creditEnabled: z.boolean().default(false),
      creditLimit: z.union([z.string(), z.number()]).nullable().default(null),
    })
    .parse(raw);
  if (data.creditEnabled)
    assert(
      data.creditLimit !== null && money(data.creditLimit).gte(0),
      400,
      "Enter a valid credit limit",
    );
  return db.transaction(async (tx) => {
    const before = await one(
      tx,
      "SELECT * FROM customer_accounts WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(before, 404, "Customer account not found");
    if (before.company_id)
      await tx.query(
        "UPDATE commerce_companies SET status=$2,price_level=$3,credit_enabled=$4,credit_limit=$5,version=version+1 WHERE id=$1",
        [
          before.company_id,
          data.status === "BLOCKED" ? "SUSPENDED" : data.status,
          data.priceLevel,
          data.creditEnabled,
          data.creditLimit || 0,
        ],
      );
    const saved = (
      await tx.query(
        "UPDATE customer_accounts SET status=$2,price_level=$3,credit_enabled=$4,credit_limit=$5 WHERE id=$1 RETURNING id,email,mobile,status,price_level,credit_enabled,credit_limit::text",
        [
          id,
          data.status,
          data.priceLevel,
          data.creditEnabled,
          data.creditLimit,
        ],
      )
    ).rows[0];
    if (data.status !== "ACTIVE")
      await tx.query(
        "DELETE FROM customer_account_sessions WHERE account_id=$1",
        [id],
      );
    await audit(
      tx,
      actor.id,
      "STOREFRONT_ACCOUNT_UPDATE",
      "customer_accounts",
      id,
      before,
      saved,
    );
    return saved;
  });
}

export async function customerOrders(db: DB, account: any) {
  assert(account?.id, 401, "Unauthenticated");
  return (
    await db.query(
      "SELECT id, number, status, totals, created_at FROM ecommerce_orders WHERE customer_account_id=$1 ORDER BY created_at DESC LIMIT 50",
      [account.id],
    )
  ).rows;
}

export async function changePassword(db: DB, account: any, raw: unknown) {
  assert(account?.id, 401, "Unauthenticated");
  const data = z
    .object({
      currentPassword: z.string().max(128),
      newPassword: z.string().min(8).max(128),
    })
    .parse(raw);
  
  const current = await one(db, "SELECT password_hash FROM customer_accounts WHERE id=$1", [account.id]);
  assert(current, 401, "Account not found");
  
  const valid = await verifyPassword(current.password_hash, data.currentPassword);
  assert(valid, 400, "Invalid current password");
  
  const newHash = await hashPassword(data.newPassword);
  await db.query("UPDATE customer_accounts SET password_hash=$2 WHERE id=$1", [account.id, newHash]);
  
  // Invalidate other sessions except current if we wanted to, but simple update is fine
  return { success: true };
}
