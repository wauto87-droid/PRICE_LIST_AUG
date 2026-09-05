import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { DB } from "../core/db";
import { one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import type { Actor } from "../auth/service";
import { requirePermission } from "../auth/service";
import { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const money = (v: unknown) => new Decimal(String(v ?? 0));
const publicSettings = (row: any) => ({
  enabled: row.enabled,
  companyName: row.data?.companyName ?? "AMT Electric",
  companyNameAr: row.data?.companyNameAr ?? "",
  hero: row.data?.hero ?? "",
  heroAr: row.data?.heroAr ?? "",
  supportMobile: row.data?.supportMobile ?? "",
  moyasarPublishableKey: process.env.MOYASAR_PUBLISHABLE_KEY ?? "",
  onlinePaymentEnabled: Boolean(
    process.env.MOYASAR_PUBLISHABLE_KEY && process.env.MOYASAR_SECRET_KEY,
  ),
  deliveryEnabled: row.data?.deliveryEnabled !== false,
  pickupEnabled: row.data?.pickupEnabled !== false,
});

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
        [data.enabled, json(data)],
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
export async function catalog(db: DB, raw: unknown, account?: any) {
  const input = z
    .object({
      q: z.string().trim().max(100).default(""),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(48).default(24),
    })
    .parse(raw);
  const store = await one(
    db,
    "SELECT enabled FROM storefront_settings WHERE id=1",
  );
  assert(store?.enabled, 404, "Online store is not available");
  const query = input.q.replace(/[\\%_]/g, "\\$&"),
    preferredLevel = account?.price_level || "RETAIL",
    args: any[] = [query, preferredLevel];
  const where = `p.active AND p.storefront_published AND ($1='' OR p.part_number ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%' OR p.keywords ILIKE '%'||$1||'%')`;
  const total = Number(
    (await one(db, `SELECT count(*) n FROM products p WHERE ${where}`, [query]))
      ?.n ?? 0,
  );
  args.push(input.pageSize, (input.page - 1) * input.pageSize);
  const rows = (
    await db.query(
      `SELECT p.id,p.part_number,p.description,p.unit,p.storefront_slug,p.storefront_content,COALESCE(i.image_count,0)::int image_count,
    l.method level_method,l.fixed_price::text,l.markup::text level_markup,l.list_price::text level_list_price,l.base_discount::text level_discount,pp.cost::text,pp.vat::text,
    COALESCE(s.available,0)::text available FROM products p JOIN product_pricing pp ON pp.product_id=p.id
    JOIN LATERAL (SELECT * FROM product_selling_levels x WHERE x.product_id=p.id AND x.active ORDER BY CASE WHEN x.code=$2 THEN 0 WHEN x.code='RETAIL' THEN 1 WHEN x.code='END_CUSTOMER' THEN 2 ELSE 3 END LIMIT 1) l ON true
    LEFT JOIN (SELECT product_id,count(*) image_count FROM product_images GROUP BY product_id)i ON i.product_id=p.id
    LEFT JOIN (SELECT m.product_id,sum(m.quantity)-COALESCE((SELECT sum(r.quantity) FROM stock_reservations r WHERE r.product_id=m.product_id AND r.status='ACTIVE'),0) available FROM inventory_movements m WHERE m.kind NOT IN ('RESERVE','RELEASE') GROUP BY m.product_id)s ON s.product_id=p.id
    WHERE ${where} ORDER BY p.part_number LIMIT $3 OFFSET $4`,
      args,
    )
  ).rows;
  const items = rows.map((r: any) => ({
    ...r,
    priceExcl: levelPrice(r).toDecimalPlaces(2).toFixed(2),
    priceIncl: levelPrice(r)
      .mul(money(100).add(r.vat))
      .div(100)
      .toDecimalPlaces(2)
      .toFixed(2),
    availability: money(r.available).lte(0)
      ? "BACKORDER"
      : money(r.available).lte(5)
        ? "LIMITED"
        : "IN_STOCK",
    available: undefined,
    cost: undefined,
    level_method: undefined,
    fixed_price: undefined,
    level_markup: undefined,
    level_list_price: undefined,
    level_discount: undefined,
  }));
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function requestOtp(db: DB, raw: unknown) {
  const data = z
    .object({
      destination: z.string().trim().min(5).max(200),
      channel: z.enum(["SMS", "EMAIL"]),
    })
    .parse(raw);
  const code = String(randomInt(100000, 1000000)),
    id = randomUUID();
  await db.query(
    "INSERT INTO otp_challenges(id,purpose,destination_hash,code_hash,expires_at) VALUES($1,'STOREFRONT_CHECKOUT',$2,$3,now()+interval '10 minutes')",
    [id, sha(data.destination.toLowerCase()), sha(`${id}:${code}`)],
  );
  const endpoint = process.env.OTP_PROVIDER_URL;
  if (endpoint) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OTP_PROVIDER_TOKEN ?? ""}`,
      },
      body: JSON.stringify({
        destination: data.destination,
        channel: data.channel,
        code,
      }),
    });
    assert(res.ok, 503, "Unable to send verification code");
  } else
    assert(
      process.env.NODE_ENV === "test",
      503,
      "OTP delivery provider is not configured",
    );
  return {
    id,
    expiresInSeconds: 600,
    ...(process.env.NODE_ENV === "test" ? { testCode: code } : {}),
  };
}
export async function verifyOtp(db: DB, raw: unknown) {
  const data = z
    .object({ id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })
    .parse(raw);
  return db.transaction(async (tx) => {
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
    assert(
      row.code_hash === sha(`${data.id}:${data.code}`),
      400,
      "Verification code is incorrect",
    );
    const token = randomBytes(32).toString("base64url");
    await tx.query(
      "UPDATE otp_challenges SET verified_at=now(),verification_token_hash=$2 WHERE id=$1",
      [data.id, sha(token)],
    );
    return { verificationToken: token };
  });
}

async function pricedLines(
  db: DB,
  requested: { productId: string; quantity: string }[],
  account?: any,
) {
  const ids = [...new Set(requested.map((x) => x.productId))];
  const rows = (
    await db.query(
      `SELECT p.id,p.part_number,p.description,p.unit,l.method level_method,l.fixed_price::text,l.markup::text level_markup,l.list_price::text level_list_price,l.base_discount::text level_discount,pp.cost::text,pp.vat::text FROM products p JOIN product_pricing pp ON pp.product_id=p.id JOIN LATERAL(SELECT * FROM product_selling_levels x WHERE x.product_id=p.id AND x.active ORDER BY CASE WHEN x.code=$2 THEN 0 WHEN x.code='RETAIL'THEN 1 WHEN x.code='END_CUSTOMER'THEN 2 ELSE 3 END LIMIT 1)l ON true WHERE p.id=ANY($1::uuid[]) AND p.active AND p.storefront_published`,
      [ids, account?.price_level || "RETAIL"],
    )
  ).rows;
  assert(
    rows.length === ids.length,
    409,
    "One or more cart products are no longer available",
  );
  const map = new Map(rows.map((r: any) => [r.id, r]));
  return requested.map((item) => {
    const row = map.get(item.productId)!,
      qty = money(item.quantity);
    assert(
      qty.isFinite() && qty.gt(0) && qty.decimalPlaces() <= 3,
      400,
      "Enter a valid cart quantity",
    );
    const excl = levelPrice(row).toDecimalPlaces(2),
      lineExcl = excl.mul(qty).toDecimalPlaces(2),
      vat = lineExcl.mul(row.vat).div(100).toDecimalPlaces(2);
    return {
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
  });
}

export async function checkout(db: DB, raw: unknown, account?: any) {
  const data = z
    .object({
      verificationId: z.string().uuid().optional(),
      verificationToken: z.string().min(20).optional(),
      contact: z.object({
        name: z.string().trim().min(1).max(150),
        email: z.string().email().optional(),
        mobile: z.string().trim().min(5).max(40),
      }).optional(),
      lines: z
        .array(z.object({ productId: z.string().uuid(), quantity: z.string() }))
        .min(1)
        .max(100),
      fulfillmentMethod: z.enum(["DELIVERY", "PICKUP"]),
      warehouseId: z.string().uuid().optional(),
      zoneId: z.string().uuid().optional(),
      address: z.record(z.string(), z.unknown()).optional(),
      paymentMethod: z.enum(["MOYASAR", "BANK_TRANSFER", "CASH", "CREDIT_TERMS"]),
      moyasarToken: z.string().max(200).optional(),
      idempotencyKey: z.string().uuid(),
    })
    .parse(raw);
  const store = await one(db, "SELECT * FROM storefront_settings WHERE id=1");
  assert(store?.enabled, 404, "Online store is not available");
  let otp:any;
  if (!account) {
    assert(data.verificationId && data.verificationToken && data.contact, 403, "Verify your contact details before checkout");
    otp = await one(db, "SELECT * FROM otp_challenges WHERE id=$1", [data.verificationId]);
    assert(otp?.verified_at && !otp.consumed_at && otp.verification_token_hash === sha(data.verificationToken), 403, "Checkout verification is invalid or expired");
    assert(data.paymentMethod !== "CREDIT_TERMS", 403, "Credit terms require an approved business account");
  } else if (data.paymentMethod === "CREDIT_TERMS") assert(account.credit_enabled, 403, "Credit terms are not enabled for this account");
  if (data.fulfillmentMethod === "PICKUP")
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
  const lines = await pricedLines(db, data.lines, account);
  let subtotal = new Decimal(0),
    vat = new Decimal(0);
  for (const l of lines) {
    subtotal = subtotal.add(l.lineExcl);
    vat = vat.add(l.vat);
  }
  let deliveryFee = new Decimal(0);
  if (data.fulfillmentMethod === "DELIVERY" && data.zoneId) {
    const zone = await one(
      db,
      "SELECT * FROM delivery_zones WHERE id=$1 AND active",
      [data.zoneId],
    );
    assert(zone, 400, "Delivery zone is unavailable");
    deliveryFee = money(zone.fee);
    if (zone.free_above && subtotal.gte(zone.free_above))
      deliveryFee = new Decimal(0);
  }
  const total = subtotal.add(vat).add(deliveryFee).toDecimalPlaces(2);
  if (data.paymentMethod === "CREDIT_TERMS") {
    const used = money((await one(db, `SELECT COALESCE(sum((totals->>'total')::numeric),0)::text used FROM ecommerce_orders WHERE customer_account_id=$1 AND payment_method='CREDIT_TERMS' AND status IN ('PENDING_REVIEW','CONFIRMED')`, [account.id]))?.used ?? 0);
    assert(used.add(total).lte(account.credit_limit ?? 0), 409, "This order exceeds the available customer credit limit");
  }
  const created = await db.transaction(async (tx) => {
    const existing = await one(
      tx,
      "SELECT * FROM ecommerce_orders WHERE idempotency_key=$1",
      [data.idempotencyKey],
    );
    if (existing) return existing;
    if (!account) await tx.query("UPDATE otp_challenges SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL", [data.verificationId]);
    const id = randomUUID(),
      number = `WEB-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomInt(100000, 1000000)}`;
    await tx.query(
      `INSERT INTO ecommerce_orders(id,number,customer_account_id,guest_contact,status,fulfillment_method,warehouse_id,address,lines,totals,payment_method,idempotency_key)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        number,
        account?.id ?? null,
        account ? null : json(data.contact),
        data.paymentMethod === "MOYASAR" ? "PENDING_PAYMENT" : "PENDING_REVIEW",
        data.fulfillmentMethod,
        data.warehouseId ?? null,
        json(data.address ?? {}),
        json(lines),
        json({
          subtotal: subtotal.toFixed(2),
          vat: vat.toFixed(2),
          deliveryFee: deliveryFee.toFixed(2),
          total: total.toFixed(2),
        }),
        data.paymentMethod,
        data.idempotencyKey,
      ],
    );
    return one(tx, "SELECT * FROM ecommerce_orders WHERE id=$1", [id]);
  });
  assert(created, 500, "Unable to create order");
  if (data.paymentMethod !== "MOYASAR")
    return { orderNumber: created.number, status: created.status };
  assert(data.moyasarToken, 400, "Payment token is required");
  const publishable = process.env.MOYASAR_PUBLISHABLE_KEY;
  assert(publishable, 503, "Online payment is not configured");
  const callbackBase = process.env.PUBLIC_URL;
  assert(callbackBase, 503, "Public application URL is not configured");
  const response = await fetch("https://api.moyasar.com/v1/payments", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${publishable}:`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount: total.mul(100).toNumber(),
      currency: "SAR",
      description: `Order ${created.number}`,
      callback_url: `${callbackBase.replace(/\/$/, "")}/api/v1/storefront/payment-return`,
      metadata: { order_id: created.id },
      source: { type: "token", token: data.moyasarToken },
    }),
  });
  const payment = await response.json();
  assert(response.ok, 502, "Payment provider rejected the request");
  const paymentId = randomUUID();
  await db.query(
    "INSERT INTO payment_transactions(id,ecommerce_order_id,provider,provider_reference,status,amount,currency,request_key,provider_payload)VALUES($1,$2,'MOYASAR',$3,$4,$5,'SAR',$6,$7)",
    [
      paymentId,
      created.id,
      payment.id,
      payment.status === "paid" ? "PAID" : "CREATED",
      total.toFixed(2),
      data.idempotencyKey,
      json({ id: payment.id, status: payment.status }),
    ],
  );
  return {
    orderNumber: created.number,
    status: payment.status === "paid" ? "PAID" : "PENDING_PAYMENT",
    redirectUrl: payment.source?.transaction_url ?? null,
    paymentReference: payment.id,
  };
}

export async function confirmMoyasarPayment(db: DB, paymentId: string) {
  const secret = process.env.MOYASAR_SECRET_KEY;
  assert(secret, 503, "Online payment verification is not configured");
  const response = await fetch(
    `https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
      },
    },
  );
  const payment = await response.json();
  assert(response.ok, 502, "Unable to verify payment");
  const tx = await one(
    db,
    "SELECT * FROM payment_transactions WHERE provider='MOYASAR' AND provider_reference=$1",
    [paymentId],
  );
  assert(tx, 404, "Payment record not found");
  assert(
    money(payment.amount).eq(money(tx.amount).mul(100)) &&
      payment.currency === "SAR" &&
      payment.metadata?.order_id === tx.ecommerce_order_id,
    409,
    "Payment verification does not match this order",
  );
  assert(payment.status === "paid", 409, "Payment has not completed");
  return db.transaction(async (database) => {
    await database.query(
      "UPDATE payment_transactions SET status='PAID',provider_payload=$2,updated_at=now() WHERE id=$1",
      [tx.id, json({ id: payment.id, status: payment.status })],
    );
    await database.query(
      "UPDATE ecommerce_orders SET status='CONFIRMED',updated_at=now() WHERE id=$1 AND status='PENDING_PAYMENT'",
      [tx.ecommerce_order_id],
    );
    await audit(
      database,
      null,
      "ECOMMERCE_PAYMENT_CONFIRMED",
      "ecommerce_orders",
      tx.ecommerce_order_id,
      null,
      { paymentId },
    );
    return one(
      database,
      "SELECT number,status FROM ecommerce_orders WHERE id=$1",
      [tx.ecommerce_order_id],
    );
  });
}

const accountCookie = "amt_store_session";
export async function authenticateAccount(db: DB, req: Request) {
  const raw = req.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(accountCookie + "="))?.slice(accountCookie.length + 1);
  if (!raw) return undefined;
  return one(db, `SELECT a.id,a.customer_id,a.email,a.mobile,a.status,a.price_level,a.credit_enabled,a.credit_limit,c.name,c.number
    FROM customer_account_sessions s JOIN customer_accounts a ON a.id=s.account_id LEFT JOIN customers c ON c.id=a.customer_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND a.status='ACTIVE'`, [sha(decodeURIComponent(raw))]);
}
export const accountSessionCookie = (token: string) => `${accountCookie}=${encodeURIComponent(token)}; Path=/amt_price_list; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;

export async function registerAccount(db: DB, raw: unknown) {
  const data = z.object({ name:z.string().trim().min(2).max(150),customerCode:z.string().trim().max(80).default(""),email:z.string().email(),mobile:z.string().trim().min(5).max(40),password:z.string().min(8).max(128),verificationId:z.string().uuid(),verificationToken:z.string().min(20) }).parse(raw);
  return db.transaction(async (tx) => {
    const otp = await one(tx,"SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE",[data.verificationId]);
    assert(otp?.verified_at&&!otp.consumed_at&&otp.verification_token_hash===sha(data.verificationToken),403,"Account verification is invalid or expired");
    assert(!(await one(tx,"SELECT id FROM customer_accounts WHERE lower(email)=lower($1) OR mobile=$2",[data.email,data.mobile])),409,"An account already exists for this email or mobile");
    const customerId=randomUUID(),accountId=randomUUID();
    await tx.query("INSERT INTO customers(id,name,number,mobile,reference) VALUES($1,$2,$3,$4,'')",[customerId,data.name,data.customerCode,data.mobile]);
    await tx.query("INSERT INTO customer_accounts(id,customer_id,email,mobile,password_hash,status) VALUES($1,$2,lower($3),$4,$5,'PENDING')",[accountId,customerId,data.email,data.mobile,await hashPassword(data.password)]);
    await tx.query("UPDATE otp_challenges SET consumed_at=now() WHERE id=$1",[data.verificationId]);
    await audit(tx,null,"STOREFRONT_ACCOUNT_REGISTER","customer_accounts",accountId,null,{customerCode:data.customerCode});
    return {id:accountId,status:"PENDING"};
  });
}

export async function loginAccount(db: DB, raw: unknown) {
  const data = z
    .object({
      login: z.string().trim().min(3).max(200),
      password: z.string().max(128),
    })
    .parse(raw);
  const account = await one(
    db,
    "SELECT * FROM customer_accounts WHERE lower(email)=lower($1) OR mobile=$1",
    [data.login],
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
  requirePermission(actor,"STOREFRONT_MANAGE");
  return (await db.query(`SELECT a.id,a.email,a.mobile,a.status,a.price_level,a.credit_enabled,a.credit_limit::text,a.created_at,c.name,c.number customer_code
    FROM customer_accounts a LEFT JOIN customers c ON c.id=a.customer_id ORDER BY CASE a.status WHEN 'PENDING' THEN 0 ELSE 1 END,a.created_at DESC`)).rows;
}

export async function updateAccount(db: DB, actor: Actor, id: string, raw: unknown) {
  requirePermission(actor,"STOREFRONT_MANAGE");
  const data=z.object({status:z.enum(["PENDING","ACTIVE","BLOCKED"]),priceLevel:z.enum(["WHOLESALE","RETAIL","END_CUSTOMER"]).nullable().default(null),creditEnabled:z.boolean().default(false),creditLimit:z.union([z.string(),z.number()]).nullable().default(null)}).parse(raw);
  if(data.creditEnabled)assert(data.creditLimit!==null&&money(data.creditLimit).gte(0),400,"Enter a valid credit limit");
  return db.transaction(async tx=>{const before=await one(tx,"SELECT * FROM customer_accounts WHERE id=$1 FOR UPDATE",[id]);assert(before,404,"Customer account not found");const saved=(await tx.query("UPDATE customer_accounts SET status=$2,price_level=$3,credit_enabled=$4,credit_limit=$5 WHERE id=$1 RETURNING id,email,mobile,status,price_level,credit_enabled,credit_limit::text",[id,data.status,data.priceLevel,data.creditEnabled,data.creditLimit])).rows[0];if(data.status!=='ACTIVE')await tx.query("DELETE FROM customer_account_sessions WHERE account_id=$1",[id]);await audit(tx,actor.id,"STOREFRONT_ACCOUNT_UPDATE","customer_accounts",id,before,saved);return saved;});
}
