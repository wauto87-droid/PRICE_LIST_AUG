import Decimal from "decimal.js";
import { getProduct, toInput } from "../products/service";
import { sellingLevels, levelPrice } from "../pricing/engine";
import { resolvePrice } from "./commerce";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { json, audit } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";
import { companyFor, event, feature } from "./commerce";
import * as quotes from "../quotations/service";
import * as lifecycle from "../quotations/lifecycle";
import { appPath } from "../../shared/paths";
import { createHash } from "node:crypto";
export async function checkoutQuote(db: DB, account: any, requestId: string) {
  const r = await ownedRequest(db, account, requestId);
  assert(
    r.quotation_id && r.customer_token,
    409,
    "A shared quotation is required",
  );
  const q = await one(
    db,
    "SELECT q.*,a.expires_at access_expires FROM quotations q JOIN quotation_access_tokens a ON a.quotation_id=q.id WHERE q.id=$1 AND a.token_hash=$2 AND a.revoked_at IS NULL FOR UPDATE OF q",
    [
      r.quotation_id,
      createHash("sha256").update(r.customer_token).digest("hex"),
    ],
  );
  assert(
    q && q.status === "ACCEPTED" && new Date(q.access_expires) > new Date(),
    409,
    "Accept a valid quotation before purchasing",
  );
  assert(
    !(await one(db, "SELECT id FROM sales_orders WHERE quotation_id=$1", [
      q.id,
    ])),
    409,
    "Our team is already processing this quotation",
  );
  assert(
    !(await one(db, "SELECT id FROM ecommerce_orders WHERE quotation_id=$1", [
      q.id,
    ])),
    409,
    "This quotation already has an order",
  );
  assert(
    q.lines.every((l: any) => l.productId && l.source === "CATALOG") &&
      !Number(q.totals.quoteDiscount),
    409,
    "This quotation requires staff-assisted ordering. Contact our team to arrange supply.",
  );
  return q!;
}

const requestInput = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().uuid().nullable().default(null),
        partNumber: z.string().max(100).default(""),
        description: z.string().trim().min(1).max(1000),
        unit: z.string().max(20).default("pcs"),
        quantity: z
          .string()
          .regex(/^\d+(?:\.\d{1,6})?$/)
          .refine((v) => Number(v) > 0),
      }),
    )
    .max(200)
    .default([]),
  notes: z.string().max(4000).default(""),
  requiredDate: z.string().date().nullable().default(null),
});
export async function submit(db: DB, account: any, raw: unknown) {
  await feature(db, "businessEnabled");
  const c = await companyFor(db, account);
  const d = requestInput.parse(raw);
  assert(
    d.lines.length || d.notes.trim(),
    400,
    "Add materials or describe the attached requirements",
  );
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO commerce_requests(id,number,company_id,account_id,lines,notes,required_date) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        "RFQ-" + id.slice(0, 8).toUpperCase(),
        c.company_id,
        account.id,
        json(d.lines),
        d.notes,
        d.requiredDate,
      ],
    );
    await event(tx, {
      requestId: id,
      companyId: c.company_id,
      accountId: account.id,
      kind: "REQUEST_SUBMITTED",
      message:
        "Your requirements have been submitted. Our team will prepare an offer.",
    });
  });
  return { id };
}
export async function ownedRequest(db: DB, account: any, id: string) {
  const c = await companyFor(db, account);
  const r = await one(
    db,
    "SELECT * FROM commerce_requests WHERE id=$1 AND company_id=$2",
    [id, c.company_id],
  );
  assert(
    r && (c.company_role === "OWNER" || r.account_id === account.id),
    404,
    "Requirements request not found",
  );
  return r!;
}
export async function requestDiscount(db:DB,account:any,id:string,raw:unknown){const d=z.object({note:z.string().trim().min(3).max(1000)}).parse(raw);await ownedRequest(db,account,id);return db.transaction(async tx=>{const r=await one(tx,'SELECT * FROM commerce_requests WHERE id=$1 FOR UPDATE',[id]);assert(r?.status==='QUOTED'&&r.quotation_id,409,'A pending quotation is required');const q=await one(tx,'SELECT status FROM quotations WHERE id=$1 FOR UPDATE',[r.quotation_id]);assert(q&&['SENT','VIEWED','ISSUED'].includes(q.status),409,'The quotation has already been completed');await tx.query('UPDATE quotation_access_tokens SET revoked_at=now() WHERE quotation_id=$1 AND revoked_at IS NULL',[r.quotation_id]);await tx.query("UPDATE commerce_requests SET status='REVIEW',notes=notes||$2,version=version+1 WHERE id=$1",[id,'\nDiscount request: '+d.note]);await event(tx,{requestId:id,companyId:r.company_id,accountId:account.id,kind:'DISCOUNT_REQUESTED',message:'Additional discount requested: '+d.note});return {ok:true};});}
export async function portal(db: DB, account: any) {
  await feature(db, "businessEnabled");
  const c = await companyFor(db, account);
  const args = [c.company_id, c.company_role === "OWNER", account.id];
  return {
    company: c,
    members:
      c.company_role === "OWNER"
        ? (
            await db.query(
              "SELECT id,email,mobile,status,company_role FROM customer_accounts WHERE company_id=$1",
              [c.company_id],
            )
          ).rows
        : [],
    requests: (
      await db.query(
        "SELECT r.*,q.status quote_status,q.number quote_number FROM commerce_requests r LEFT JOIN quotations q ON q.id=r.quotation_id WHERE r.company_id=$1 AND ($2 OR r.account_id=$3) ORDER BY r.created_at DESC",
        args,
      )
    ).rows.map((r) => ({
      ...r,
      quoteUrl: r.customer_token
        ? appPath("/customer-quotation/" + r.customer_token)
        : null,
      customer_token: undefined,
    })),
    orders: (
      await db.query(
        "SELECT o.*,s.status fulfillment_status FROM ecommerce_orders o LEFT JOIN sales_orders s ON s.id=o.sales_order_id WHERE o.company_id=$1 AND ($2 OR o.customer_account_id=$3) ORDER BY o.created_at DESC",
        args,
      )
    ).rows,
    events: (
      await db.query(
        "SELECT * FROM commerce_events WHERE company_id=$1 AND ($2 OR account_id=$3) ORDER BY created_at DESC LIMIT 100",
        args,
      )
    ).rows,
    attachments: (
      await db.query(
        "SELECT a.id,a.name,a.request_id FROM commerce_attachments a LEFT JOIN commerce_requests r ON r.id=a.request_id WHERE a.company_id=$1 AND ($2 OR r.account_id=$3)",
        args,
      )
    ).rows,
    creditUsed: (
      await one(
        db,
        "SELECT COALESCE(sum(amount),0)::text n FROM commerce_credit_entries WHERE company_id=$1",
        [c.company_id],
      )
    )?.n,
  };
}
export async function upload(
  db: DB,
  account: any,
  requestId: string | null,
  name: string,
  content: Buffer,
) {
  const c = await companyFor(db, account, requestId === null);
  if (requestId) await ownedRequest(db, account, requestId);
  assert(
    content.length > 0 && content.length <= 10 * 1024 * 1024,
    413,
    "Choose a file of up to 10 MB",
  );
  const ext = name.split(".").pop()?.toLowerCase();
  assert(
    ["pdf", "xlsx", "xls", "csv"].includes(ext || ""),
    400,
    "Use PDF, Excel or CSV",
  );
  assert(
    ext !== "pdf" || content.subarray(0, 5).toString() === "%PDF-",
    400,
    "Invalid PDF",
  );
  assert(
    ext !== "xlsx" || content.subarray(0, 2).toString() === "PK",
    400,
    "Invalid Excel file",
  );
  assert(
    ext !== "xls" || content.subarray(0, 4).toString("hex") === "d0cf11e0",
    400,
    "Invalid Excel file",
  );
  const id = randomUUID();
  const mime =
    ext === "pdf"
      ? "application/pdf"
      : ext === "csv"
        ? "text/csv"
        : "application/octet-stream";
  await db.query(
    "INSERT INTO commerce_attachments(id,company_id,request_id,name,mime,content) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      c.company_id,
      requestId,
      name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180),
      mime,
      content,
    ],
  );
  return { id };
}
export async function attachment(
  db: DB,
  id: string,
  account?: any,
  actor?: Actor,
) {
  const a = await one(db, "SELECT * FROM commerce_attachments WHERE id=$1", [
    id,
  ]);
  assert(a, 404, "Attachment not found");
  if (actor) requirePermission(actor, "STOREFRONT_MANAGE");
  else {
    const c = await companyFor(db, account, a.request_id === null);
    assert(c.company_id === a.company_id, 404, "Attachment not found");
    if (a.request_id) await ownedRequest(db, account, a.request_id);
  }
  return a!;
}
export async function review(db: DB, actor: Actor, id: string, raw: unknown) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const d = z
    .object({
      version: z.number().int(),
      action: z.enum(["REVIEW", "SAVE_LINES", "CREATE_DRAFT", "SHARE"]),
      lines:z.array(requestInput.shape.lines.unwrap().element.extend({quotedPrice:z.string().regex(/^\d+(?:\.\d{1,2})?$/).optional()})).min(1).max(200).optional(),
      quotationId: z.string().uuid().optional(),
      leadTime: z.string().max(1000).default(""),
      days: z.number().int().min(1).max(90).default(30),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const r = await one(
      tx,
      "SELECT r.*,c.name FROM commerce_requests r JOIN commerce_companies c ON c.id=r.company_id WHERE r.id=$1 FOR UPDATE OF r",
      [id],
    );
    assert(r?.version === d.version, 409, "Request changed. Reload");
    assert(
      !["ACCEPTED", "DECLINED"].includes(r.status),
      409,
      "Request has already been completed",
    );
    let quotationId = r.quotation_id,
      token = r.customer_token;
    if(d.action==='SAVE_LINES'){assert(!quotationId,409,'Review the materials in the existing quotation');assert(d.lines,400,'Enter the reviewed materials');await tx.query('UPDATE commerce_requests SET lines=$2 WHERE id=$1',[id,json(d.lines)]);}
    if (d.action === "CREATE_DRAFT") {
      assert(!quotationId, 409, "This request already has a draft");
      assert(
        r.lines.length,
        400,
        "Add or match attachment materials in the quotation workspace first",
      );
      const settings = (await one(tx, "SELECT data FROM settings WHERE id=1"))!
        .data;
      const requestedAccount = await one(
        tx,
        "SELECT * FROM customer_accounts WHERE id=$1",
        [r.account_id],
      );
      const inputs = [];
      for (const l of r.lines) {
        if (!l.productId) {
          inputs.push({
            type: "CUSTOM",
            partNumber: l.partNumber,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unitPriceExcl: l.quotedPrice||"0",
            discount: "0",
          });
          continue;
        }
        const product = toInput((await getProduct(tx, l.productId))!);
        const resolved = await resolvePrice(
          tx,
          l.productId,
          l.quantity,
          requestedAccount,
        );
        const levels = sellingLevels(product).filter((x) => x.active);
        assert(
          levels.length,
          400,
          "Add a selling level before quoting this item",
        );
        const target =
          resolved.price === null ? null : new Decimal(resolved.price);
        const level =
          levels.find(
            (x) => target !== null && levelPrice(product, x).gte(target),
          ) || levels[0];
        const base = levelPrice(product, level);
        assert(
          target === null || target.lte(base),
          400,
          "Company price exceeds the available selling levels. Review the product pricing before drafting the quote.",
        );
        inputs.push({
          type: "CATALOG",
          productId: l.productId,
          quantity: l.quantity,
          sellingLevel: level.code,
          discount:
            target !== null && !base.isZero()
              ? base
                  .sub(target)
                  .div(base)
                  .mul(100)
                  .toDecimalPlaces(6)
                  .toString()
              : "0",
        });
      }
      const draft = await quotes.saveDraft(
        tx,
        actor,
        {
          customer: {
            name: r.name,
            reference: r.number,
            notes: r.notes.slice(0, 1000),
          },
          lines: inputs,
        },
        settings,
      );
      quotationId = draft.id;
    } else if (d.action === "SHARE") {
      quotationId = d.quotationId || quotationId;
      assert(quotationId, 400, "Enter the issued quotation ID");
      const proposal=await quotes.getQuote(tx,actor,quotationId);
      assert(proposal.lines.every((l:any)=>l.price&&new Decimal(l.price.finalExcl).gt(0)),400,'Review and enter a positive price for every requested material before sharing');
      let supplyRequired=false;
      for(const l of proposal.lines){if(!l.productId){supplyRequired=true;continue;}const balance=await one(tx,"SELECT COALESCE(sum(quantity),0)::text n FROM inventory_movements WHERE product_id=$1 AND kind NOT IN ('RESERVE','RELEASE')",[l.productId]);if(new Decimal(balance!.n).lt(l.price.quantity))supplyRequired=true;}
      assert(!supplyRequired||d.leadTime.trim(),400,'Enter supply lead time for custom or unavailable materials');
      if (r.quotation_id && r.quotation_id !== quotationId) {
        const revision = await one(
          tx,
          "SELECT COALESCE(parent_quotation_id,id) root FROM quotations WHERE id=$1",
          [quotationId],
        );
        assert(
          revision?.root === (await one(tx,"SELECT COALESCE(parent_quotation_id,id) root FROM quotations WHERE id=$1",[r.quotation_id]))?.root,
          400,
          "Select a revision of this request quotation",
        );
      }
      const link = await lifecycle.createCustomerLink(
        tx,
        actor,
        quotationId,
        d.days,
      );
      token = link.token;
    }
    await tx.query(
      "UPDATE commerce_requests SET status=$2,quotation_id=$3,customer_token=$4,lead_time=$5,version=version+1 WHERE id=$1",
      [
        id,
        d.action === "SHARE" ? "QUOTED" : "REVIEW",
        quotationId,
        token,
        d.leadTime,
      ],
    );
    await audit(
      tx,
      actor.id,
      "COMMERCE_REQUIREMENTS_" + d.action,
      "commerce_requests",
      id,
      null,
      d,
    );
    await event(tx, {
      requestId: id,
      companyId: r.company_id,
      accountId: r.account_id,
      kind: d.action,
      message:
        d.action === "SHARE"
          ? "Your quotation is ready to review."
          : "Your requirements are being reviewed.",
    });
    return { quotationId };
  });
}
