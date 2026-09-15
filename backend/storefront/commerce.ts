import { randomUUID, randomBytes, createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";
import { appPath } from "../../shared/paths";

export const amount = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);
const qty = z
  .string()
  .regex(/^\d{1,10}(?:\.\d{1,6})?$/)
  .refine((v) => new Decimal(v).gt(0));
const timestamp = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .default(null);
const safeLink = z
  .string()
  .max(500)
  .refine(
    (v) =>
      !v || (v.startsWith("/") && !v.startsWith("//") && !v.includes("\\")),
    "Use a local store link",
  );
export const campaignInput = z
  .object({
    id: z.string().uuid().optional(),
    version: z.number().int().optional(),
    kind: z.enum(["BANNER", "SECTION", "OFFER", "COUPON"]),
    title: z.string().trim().min(1).max(150),
    status: z.enum(["DRAFT", "PUBLISHED", "DISABLED"]),
    audience: z.enum(["ALL", "RETAIL", "BUSINESS"]).default("ALL"),
    position: z.number().int().min(0).max(1000).default(0),
    startsAt: timestamp,
    endsAt: timestamp,
    data: z.object({
      titleAr: z.string().max(150).default(""),
      text: z.string().max(500).default(""),
      textAr: z.string().max(500).default(""),
      image: safeLink.default(""),
      mobileImage: safeLink.default(""),
      link: safeLink.default(""),
      button: z.string().max(80).default("Shop now"),
      buttonAr: z.string().max(80).default("تسوق الآن"),
      productIds: z.array(z.string().uuid()).max(100).default([]),
      sectionType: z
        .enum([
          "PRODUCTS",
          "CATEGORIES",
          "BRANDS",
          "NEW",
          "BESTSELLERS",
          "OFFERS",
        ])
        .default("PRODUCTS"),
      names: z.array(z.string().max(100)).max(50).default([]),
      code: z.string().trim().max(40).default(""),
      discount: amount.default("0"),
      usageLimit: z.number().int().positive().nullable().default(null),
    }),
  })
  .refine(
    (v) =>
      !v.startsAt || !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt),
    "End must follow start",
  );

export async function companyFor(
  db: DB,
  account: any,
  owner = false,
  lock = false,
) {
  assert(account?.id, 401, "Sign in to your business account");
  const a = await one(
    db,
    "SELECT a.id,a.company_role,a.company_id,c.* FROM customer_accounts a JOIN commerce_companies c ON c.id=a.company_id WHERE a.id=$1 AND a.status='ACTIVE'" +
      (lock ? " FOR UPDATE OF c" : ""),
    [account.id],
  );
  assert(
    a?.status === "ACTIVE",
    403,
    "An approved company account is required",
  );
  assert(
    !owner || a.company_role === "OWNER",
    403,
    "Only the company owner can manage members",
  );
  return a!;
}
export async function feature(
  db: DB,
  key: "businessEnabled" | "operationsEnabled",
) {
  const s = await one(db, "SELECT data FROM storefront_settings WHERE id=1");
  assert(s?.data?.[key] === true, 404, "This commerce feature is not enabled");
}
export async function saveCampaign(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const d = campaignInput.parse(raw);
  assert(
    new Decimal(d.data.discount).lte(100),
    400,
    "Discount cannot exceed 100%",
  );
  if (d.kind === "COUPON")
    assert(d.data.code.length > 0, 400, "Enter a coupon code");
  return db.transaction(async (tx) => {
    const id = d.id || randomUUID();
    const before = await one(
      tx,
      "SELECT * FROM commerce_campaigns WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      !d.id || before?.version === d.version,
      409,
      "Campaign changed. Reload before saving",
    );
    if (d.kind === "COUPON")
      assert(
        !(await one(
          tx,
          "SELECT id FROM commerce_campaigns WHERE kind='COUPON' AND upper(data->>'code')=upper($1) AND id<>$2",
          [d.data.code, id],
        )),
        409,
        "Coupon code already exists",
      );
    const row = await one(
      tx,
      `INSERT INTO commerce_campaigns(id,kind,title,status,audience,position,starts_at,ends_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET title=$3,status=$4,audience=$5,position=$6,starts_at=$7,ends_at=$8,data=$9,version=commerce_campaigns.version+1 RETURNING *`,
      [
        id,
        d.kind,
        d.title,
        d.status,
        d.audience,
        d.position,
        d.startsAt,
        d.endsAt,
        json(d.data),
      ],
    );
    await audit(
      tx,
      actor.id,
      "COMMERCE_CAMPAIGN_SAVE",
      "commerce_campaigns",
      id,
      before,
      row,
    );
    return row;
  });
}
export async function activeCampaigns(db: DB, account?: any) {
  const business = account?.company_id
    ? !!(await one(
        db,
        "SELECT id FROM commerce_companies WHERE id=$1 AND status='ACTIVE'",
        [account.company_id],
      ))
    : false;
  return (
    await db.query(
      "SELECT * FROM commerce_campaigns WHERE status='PUBLISHED' AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>now()) AND audience IN ('ALL',$1) ORDER BY position,id",
      [business ? "BUSINESS" : "RETAIL"],
    )
  ).rows;
}
export async function savePrice(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  requirePermission(actor, "PRODUCT_EDIT");
  const d = z
    .object({
      id: z.string().uuid().optional(),
      version: z.number().int().optional(),
      companyId: z.string().uuid().nullable().default(null),
      priceListId: z.string().uuid().nullable().default(null),
      productId: z.string().uuid(),
      minQuantity: qty.default("1"),
      price: amount,
      startsAt: timestamp,
      endsAt: timestamp,
    })
    .parse(raw);
  assert(
    Boolean(d.companyId) !== Boolean(d.priceListId),
    400,
    "Select a company or a price list",
  );
  assert(
    !d.startsAt || !d.endsAt || new Date(d.endsAt) > new Date(d.startsAt),
    400,
    "End must follow start",
  );
  return db.transaction(async (tx) => {
    const id = d.id || randomUUID();
    const old = await one(
      tx,
      "SELECT * FROM commerce_prices WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(!d.id || old?.version === d.version, 409, "Price changed. Reload");
    assert(!old||(old.company_id===d.companyId&&old.price_list_id===d.priceListId&&old.product_id===d.productId),400,'Change the value or dates of this price, or create a new assignment');
    await tx.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[d.productId]);
    const overlap=await one(tx,"SELECT id FROM commerce_prices WHERE id<>$1 AND product_id=$2 AND company_id IS NOT DISTINCT FROM $3::uuid AND price_list_id IS NOT DISTINCT FROM $4::uuid AND min_quantity=$5 AND COALESCE(starts_at,'-infinity'::timestamptz)<COALESCE($7::timestamptz,'infinity'::timestamptz) AND COALESCE(ends_at,'infinity'::timestamptz)>COALESCE($6::timestamptz,'-infinity'::timestamptz)",[id,d.productId,d.companyId,d.priceListId,d.minQuantity,d.startsAt,d.endsAt]);
    assert(!overlap,409,'A price for this quantity tier already covers these dates. Edit that price or choose non-overlapping dates.');
    const saved = await one(
      tx,
      "INSERT INTO commerce_prices(id,company_id,price_list_id,product_id,min_quantity,price,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET min_quantity=$5,price=$6,starts_at=$7,ends_at=$8,version=commerce_prices.version+1 RETURNING *",
      [
        id,
        d.companyId,
        d.priceListId,
        d.productId,
        d.minQuantity,
        d.price,
        d.startsAt,
        d.endsAt,
      ],
    );
    await audit(
      tx,
      actor.id,
      "COMMERCE_PRICE_SAVE",
      "commerce_prices",
      id,
      old,
      saved,
    );
    return saved;
  });
}
// Shared SQL keeps catalog ordering, quantity previews and checkout on identical rules.
export function priceJoins(
  companyParameter: string,
  quantityParameter: string,
) {
  return `
 JOIN product_pricing pp ON pp.product_id=p.id
 LEFT JOIN commerce_companies co ON co.id=${companyParameter}::uuid AND co.status='ACTIVE'
 LEFT JOIN LATERAL (SELECT * FROM product_selling_levels x WHERE x.product_id=p.id AND x.active AND x.code IN ('RETAIL','END_CUSTOMER',co.price_level) ORDER BY CASE WHEN co.price_level IS NOT NULL AND x.code=co.price_level THEN 0 WHEN x.code='RETAIL' THEN 1 ELSE 2 END LIMIT 1) l ON true
 LEFT JOIN LATERAL (SELECT x.* FROM commerce_prices x LEFT JOIN commerce_price_lists pl ON pl.id=x.price_list_id WHERE x.product_id=p.id AND (x.company_id=co.id OR (x.price_list_id=co.price_list_id AND pl.active)) AND x.min_quantity<=${quantityParameter}::numeric AND (x.starts_at IS NULL OR x.starts_at<=now()) AND (x.ends_at IS NULL OR x.ends_at>now()) ORDER BY CASE WHEN x.company_id=co.id THEN 0 ELSE 1 END,x.min_quantity DESC,x.id LIMIT 1) cp ON true
 CROSS JOIN LATERAL (SELECT CASE WHEN cp.id IS NOT NULL THEN cp.price WHEN l.method='FIXED' THEN l.fixed_price WHEN l.method='COST_MARKUP' THEN pp.cost*(100+l.markup)/100 WHEN l.method IS NOT NULL THEN l.list_price*(100-l.base_discount)/100 ELSE NULL END base_price,CASE WHEN cp.company_id IS NOT NULL THEN 'COMPANY' WHEN cp.price_list_id IS NOT NULL THEN 'PRICE_LIST' WHEN co.price_level IS NOT NULL AND l.code=co.price_level THEN 'COMPANY_LEVEL' ELSE 'PUBLIC' END price_source) bp
 LEFT JOIN LATERAL (SELECT max((c.data->>'discount')::numeric) discount FROM commerce_campaigns c WHERE c.kind='OFFER' AND c.status='PUBLISHED' AND (c.starts_at IS NULL OR c.starts_at<=now()) AND (c.ends_at IS NULL OR c.ends_at>now()) AND c.audience IN ('ALL',CASE WHEN co.id IS NULL THEN 'RETAIL' ELSE 'BUSINESS' END) AND (jsonb_array_length(c.data->'productIds')=0 OR (c.data->'productIds') ? p.id::text)) offer ON bp.price_source='PUBLIC'
 CROSS JOIN LATERAL (SELECT round(bp.base_price*(100-COALESCE(offer.discount,0))/100,2) price_excl,CASE WHEN offer.discount>0 THEN 'OFFER' ELSE bp.price_source END price_source) resolved
 `;
}
export async function resolvePrice(
  db: DB,
  productId: string,
  quantity: string,
  account?: any,
) {
  if (account?.company_id) await companyFor(db, account);
  const r = await one(
    db,
    `SELECT resolved.price_excl::text price,resolved.price_source source,pp.vat::text vat FROM products p ${priceJoins("$1", "$2")} WHERE p.id=$3`,
    [account?.company_id || null, quantity, productId],
  );
  return {
    price: r?.price ?? null,
    source: r?.source || "PUBLIC",
    vat: r?.vat || "0",
  };
}
export async function event(
  db: DB,
  details: {
    orderId?: string;
    requestId?: string;
    companyId?: string;
    accountId?: string;
    kind: string;
    message: string;
  },
) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO commerce_events(id,order_id,request_id,company_id,account_id,kind,message) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      id,
      details.orderId || null,
      details.requestId || null,
      details.companyId || null,
      details.accountId || null,
      details.kind,
      details.message,
    ],
  );
  if (details.accountId) {
    const a = await one(db, "SELECT email FROM customer_accounts WHERE id=$1", [
      details.accountId,
    ]);
    if (a?.email)
      await db.query(
        "INSERT INTO commerce_notifications(id,event_id,destination) VALUES($1,$2,$3)",
        [randomUUID(), id, a.email],
      );
  }
}
export async function saveCompany(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const d = z
    .object({
      version: z.number().int(),
      status: z.enum(["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"]),
      reviewNote: z.string().max(2000).default(""),
      priceListId: z.string().uuid().nullable().default(null),
      priceLevel: z
        .enum(["RETAIL", "END_CUSTOMER", "WHOLESALE"])
        .nullable()
        .default(null),
      creditEnabled: z.boolean(),
      creditLimit: amount,
    })
    .parse(raw);
  assert(
    !["REJECTED", "SUSPENDED"].includes(d.status) || d.reviewNote.trim(),
    400,
    "Provide a reason",
  );
  return db.transaction(async (tx) => {
    const before = await one(
      tx,
      "SELECT * FROM commerce_companies WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(before?.version === d.version, 409, "Company changed. Reload");
    await tx.query(
      "UPDATE commerce_companies SET status=$2,review_note=$3,price_list_id=$4,price_level=$5,credit_enabled=$6,credit_limit=$7,version=version+1 WHERE id=$1",
      [
        id,
        d.status,
        d.reviewNote,
        d.priceListId,
        d.priceLevel,
        d.creditEnabled,
        d.creditLimit,
      ],
    );
    if (d.status === "ACTIVE" && before.status !== "ACTIVE")
      await tx.query(
        "UPDATE customer_accounts SET status='ACTIVE' WHERE company_id=$1 AND status='PENDING'",
        [id],
      );
    await audit(
      tx,
      actor.id,
      "COMMERCE_COMPANY_UPDATE",
      "commerce_companies",
      id,
      before,
      d,
    );
    if(before.status!==d.status){const owners=(await tx.query("SELECT id FROM customer_accounts WHERE company_id=$1 AND company_role='OWNER'",[id])).rows;for(const a of owners)await event(tx,{companyId:id,accountId:a.id,kind:'COMPANY_'+d.status,message:'Company application: '+d.status+'. '+d.reviewNote});}
    return { ok: true };
  });
}
export async function dashboard(db: DB, actor: Actor) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  return {
    campaigns: (
      await db.query(
        "SELECT * FROM commerce_campaigns ORDER BY kind,position,title",
      )
    ).rows,
    companies: (
      await db.query(
        "SELECT c.*,COALESCE((SELECT sum(amount) FROM commerce_credit_entries e WHERE e.company_id=c.id),0)::text credit_used FROM commerce_companies c ORDER BY created_at DESC",
      )
    ).rows,
    priceLists: (
      await db.query("SELECT * FROM commerce_price_lists ORDER BY name")
    ).rows,
    prices: (
      await db.query(
        "SELECT x.*,p.part_number FROM commerce_prices x JOIN products p ON p.id=x.product_id ORDER BY p.part_number,min_quantity",
      )
    ).rows,
    attachments: (
      await db.query(
        "SELECT id,company_id,request_id,name FROM commerce_attachments ORDER BY created_at DESC LIMIT 500",
      )
    ).rows,
    lowStock: (
      await db.query(
        "SELECT p.part_number,w.name warehouse,s.minimum::text,COALESCE((SELECT sum(quantity) FROM inventory_movements m WHERE m.product_id=p.id AND m.warehouse_id=w.id AND kind NOT IN ('RESERVE','RELEASE')),0)-COALESCE((SELECT sum(quantity) FROM stock_reservations r WHERE r.product_id=p.id AND r.warehouse_id=w.id AND status='ACTIVE'),0)-COALESCE((SELECT sum(quantity) FROM commerce_holds h WHERE h.product_id=p.id AND h.warehouse_id=w.id AND status='ACTIVE'),0) available FROM replenishment_settings s JOIN products p ON p.id=s.product_id JOIN warehouses w ON w.id=s.warehouse_id WHERE p.active AND w.active",
      )
    ).rows.filter((r) => new Decimal(r.available).lte(r.minimum)),
    requests: (
      await db.query(
        "SELECT r.*,c.name company_name,q.number quote_number,q.status quote_status FROM commerce_requests r JOIN commerce_companies c ON c.id=r.company_id LEFT JOIN quotations q ON q.id=r.quotation_id ORDER BY r.created_at DESC LIMIT 200",
      )
    ).rows,
    returns: (
      await db.query(
        "SELECT r.*,o.number order_number FROM commerce_returns r JOIN ecommerce_orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 200",
      )
    ).rows,
    orders: (
      await db.query(
        `SELECT 
          o.*,
          c.name AS company_name,
          ca.email AS account_email,
          ca.mobile AS account_mobile,
          cust.name AS customer_name,
          cust.number AS customer_number,
          cust.mobile AS customer_mobile,
          ca.email AS customer_email,
          w.name AS warehouse_name
        FROM ecommerce_orders o
        LEFT JOIN commerce_companies c ON c.id = o.company_id
        LEFT JOIN customer_accounts ca ON ca.id = o.customer_account_id
        LEFT JOIN customers cust ON cust.id = ca.customer_id
        LEFT JOIN warehouses w ON w.id = o.warehouse_id
        ORDER BY o.created_at DESC LIMIT 200`,
      )
    ).rows,
    summary: await one(
      db,
      "SELECT (SELECT COALESCE(sum((totals->>'total')::numeric),0)::text FROM ecommerce_orders WHERE status='CONFIRMED') sales,(SELECT count(*) FROM commerce_requests WHERE status IN ('SUBMITTED','REVIEW')) pending_quotes,(SELECT COALESCE(sum(amount),0)::text FROM commerce_credit_entries) credit_used,(SELECT count(*) FROM ecommerce_orders) total_orders,(SELECT count(*) FROM ecommerce_orders WHERE status IN ('PENDING_REVIEW','PENDING_PAYMENT')) pending_orders",
    ),
    searches: (
      await db.query(
        "SELECT * FROM commerce_searches WHERE result_count=0 ORDER BY count DESC LIMIT 20",
      )
    ).rows,
    notifications: (
      await db.query(
        "SELECT n.id,n.status,n.error,n.attempts,e.message FROM commerce_notifications n JOIN commerce_events e ON e.id=n.event_id WHERE n.status<>'SENT' ORDER BY n.updated_at DESC LIMIT 100",
      )
    ).rows,
  };
}
export async function invite(db: DB, account: any, raw: unknown) {
  await feature(db, "businessEnabled");
  const c = await companyFor(db, account, true);
  const { email } = z.object({ email: z.string().email() }).parse(raw);
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO commerce_invitations(id,company_id,email,token_hash,expires_at) VALUES($1,$2,lower($3),$4,now()+interval '7 days')",
    [
      randomUUID(),
      c.company_id,
      email,
      createHash("sha256").update(token).digest("hex"),
    ],
  );
  return { link: appPath("/store") + "?invitation=" + token };
}
export async function removeMember(db: DB, account: any, id: string) {
  const c = await companyFor(db, account, true);
  assert(id !== account.id, 400, "You cannot remove yourself");
  await db.transaction(async (tx) => {
    const a = await one(
      tx,
      "SELECT id FROM customer_accounts WHERE id=$1 AND company_id=$2 AND company_role='BUYER' FOR UPDATE",
      [id, c.company_id],
    );
    assert(a, 404, "Buyer not found");
    await tx.query(
      "UPDATE customer_accounts SET status='BLOCKED' WHERE id=$1",
      [id],
    );
    await tx.query(
      "DELETE FROM customer_account_sessions WHERE account_id=$1",
      [id],
    );
  });
  return { ok: true };
}
