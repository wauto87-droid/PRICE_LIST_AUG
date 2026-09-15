import { randomUUID, createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import { type Actor, requirePermission } from "../auth/service";
import { event, companyFor, amount, feature } from "./commerce";
import { stockAdjustment } from "../commercial/service";

export async function reviewReturn(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  await feature(db, "operationsEnabled");
  const d = z
    .object({
      version: z.number().int(),
      action: z.enum(["APPROVED", "REJECTED", "INSPECTED", "REFUNDED"]),
      inspection: z.string().max(2000).default(""),
      restock: z.boolean().default(false),
      amount: amount.default("0"),
      reference: z.string().max(200).default(""),
    })
    .parse(raw);
  let remote: any;
  if (d.action === "REFUNDED") {
    const p = await one(
      db,
      "SELECT p.provider_reference FROM commerce_returns r JOIN payment_transactions p ON p.ecommerce_order_id=r.order_id WHERE r.id=$1 AND p.provider='MOYASAR'",
      [id],
    );
    if (p) {
      assert(
        process.env.MOYASAR_SECRET_KEY,
        503,
        "Configure payment verification",
      );
      const res = await fetch(
        "https://api.moyasar.com/v1/payments/" +
          encodeURIComponent(p.provider_reference),
        {
          signal: AbortSignal.timeout(10000),
          headers: {
            authorization:
              "Basic " +
              Buffer.from(process.env.MOYASAR_SECRET_KEY + ":").toString(
                "base64",
              ),
          },
        },
      );
      assert(res.ok, 502, "Unable to verify the provider refund");
      remote = await res.json();
      assert(
        remote.id === p.provider_reference && remote.currency === "SAR",
        409,
        "Refund payment mismatch",
      );
    }
  }
  return db.transaction(async (tx) => {
    const r = await one(
      tx,
      "SELECT * FROM commerce_returns WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(r, 404, "Return not found");
    if (r.status === d.action && d.action === "REFUNDED") return { ok: true };
    assert(r.version === d.version, 409, "Return changed. Reload");
    const o = await one(
      tx,
      "SELECT * FROM ecommerce_orders WHERE id=$1 FOR UPDATE",
      [r.order_id],
    );
    assert(o, 404, "Order not found");
    const transitions: Record<string, string[]> = {
      REQUESTED: ["APPROVED", "REJECTED"],
      APPROVED: ["INSPECTED"],
      INSPECTED: ["REFUNDED"],
    };
    assert(
      transitions[r.status]?.includes(d.action),
      409,
      "Invalid return transition",
    );
    if (d.action === "REJECTED" || d.action === "INSPECTED")
      assert(d.inspection.trim(), 400, "Enter a decision or inspection note");
    if (d.action === "INSPECTED" && d.restock) {
      requirePermission(actor, "INVENTORY_MANAGE");
      for (const l of r.lines) {
        const cost = await one(
          tx,
          "SELECT round(sum(c.quantity*c.unit_cost)/NULLIF(sum(c.quantity),0),6)::text cost FROM fifo_consumptions c JOIN inventory_movements m ON m.id=c.movement_id WHERE m.reference_type='SALES_ORDER' AND m.reference_id=$1 AND m.product_id=$2",
          [o.sales_order_id, l.productId],
        );
        await stockAdjustment(tx, actor, {
          warehouseId: o.warehouse_id,
          productId: l.productId,
          quantity: l.quantity,
          unitCost: cost?.cost || "0",
          reason: "Inspected return " + id,
          idempotencyKey: randomUUID(),
        });
      }
    }
    if (d.action === "REFUNDED") {
      const total = r.lines.reduce((n: Decimal, l: any) => {
        const original = o.lines.find((x: any) => x.productId === l.productId);
        return n.add(
          new Decimal(original.lineTotal)
            .mul(l.quantity)
            .div(original.quantity),
        );
      }, new Decimal(0));
      assert(
        new Decimal(d.amount).gt(0) && new Decimal(d.amount).lte(total),
        400,
        "Refund exceeds returned item value",
      );
      const prior = await one(
        tx,
        "SELECT COALESCE(sum(refund_amount),0)::text n FROM commerce_returns WHERE order_id=$1 AND status='REFUNDED'",
        [o.id],
      );
      assert(
        new Decimal(prior!.n).add(d.amount).lte(o.totals.total),
        400,
        "Refund exceeds order value",
      );
      if(o.status==='CANCELLED')assert(new Decimal(prior!.n).add(d.amount).lte(o.paid_amount),400,'Cancellation refund exceeds the amount paid');
      if (o.payment_method === "MOYASAR") {
        assert(
          remote &&
            new Decimal(remote.refunded || 0).gte(
              new Decimal(prior!.n).add(d.amount).mul(100),
            ),
          409,
          "Complete the refund in Moyasar first, then verify it here",
        );
      } else if (o.payment_method === "BANK_TRANSFER")
        assert(d.reference, 400, "Enter the verified bank refund reference");
      if (o.payment_method === "CREDIT_TERMS") {
        await tx.query(
          "SELECT id FROM commerce_companies WHERE id=$1 FOR UPDATE",
          [o.company_id],
        );
        const balance = await one(
          tx,
          "SELECT COALESCE(sum(amount),0)::text n FROM commerce_credit_entries WHERE order_id=$1",
          [o.id],
        );
        const adjustment = Decimal.min(d.amount, Decimal.max(0, balance!.n));
        assert(
          adjustment.eq(d.amount) || d.reference,
          400,
          "Enter the verified reference for any refund exceeding unpaid credit",
        );
        await tx.query(
          "INSERT INTO commerce_credit_entries(id,company_id,order_id,amount,kind,idempotency_key) VALUES($1,$2,$3,$4,'REFUND',$5)",
          [
            randomUUID(),
            o.company_id,
            o.id,
            adjustment.neg().toFixed(2),
            "RETURN:" + id,
          ],
        );
      }
    }
    await tx.query(
      "UPDATE commerce_returns SET status=$2,inspection=$3,refund_amount=$4,refund_reference=$5,version=version+1 WHERE id=$1",
      [
        id,
        d.action,
        d.inspection || r.inspection,
        d.action === "REFUNDED" ? d.amount : r.refund_amount,
        d.reference || remote?.id || null,
      ],
    );
    await event(tx, {
      orderId: o.id,
      companyId: o.company_id,
      accountId: r.account_id,
      kind: "RETURN_" + d.action,
      message: "Return " + d.action.toLowerCase() + ". " + d.inspection,
    });
    await audit(
      tx,
      actor.id,
      "COMMERCE_RETURN_" + d.action,
      "commerce_returns",
      id,
      r,
      d,
    );
    return { ok: true };
  });
}

export async function available(
  db: DB,
  warehouseId: string,
  productId: string,
) {
  const r = await one(
    db,
    `SELECT COALESCE((SELECT sum(quantity) FROM inventory_movements WHERE warehouse_id=$1 AND product_id=$2 AND kind NOT IN ('RESERVE','RELEASE')),0)-COALESCE((SELECT sum(quantity) FROM stock_reservations WHERE warehouse_id=$1 AND product_id=$2 AND status='ACTIVE'),0)-COALESCE((SELECT sum(quantity) FROM commerce_holds WHERE warehouse_id=$1 AND product_id=$2 AND status='ACTIVE'),0) n`,
    [warehouseId, productId],
  );
  return new Decimal(r!.n);
}
// Lock warehouses in stable order, matching the commercial inventory writer lock.
export async function allocation(db: DB, lines: any[], warehouseId?: string) {
  const warehouses = (
    await db.query(
      "SELECT id FROM warehouses WHERE active AND ($1::uuid IS NULL OR id=$1) ORDER BY id FOR UPDATE",
      [warehouseId || null],
    )
  ).rows;
  for (const w of warehouses) {
    let fits = true;
    for (const l of lines)
      if ((await available(db, w.id, l.productId)).lt(l.quantity)) {
        fits = false;
        break;
      }
    if (fits) return w.id;
  }
  assert(
    false,
    409,
    "Requested quantities are unavailable at an eligible location. Request a quote or reduce quantities.",
  );
}
export async function reserveCheckout(
  db: DB,
  orderId: string,
  lines: any[],
  warehouseId: string | undefined,
  method: string,
) {
  const warehouse = await allocation(db, lines, warehouseId);
  const s = await one(db, "SELECT data FROM storefront_settings WHERE id=1");
  const minutes =
    method === "MOYASAR"
      ? s?.data?.onlineHoldMinutes || 15
      : method === "BANK_TRANSFER"
        ? s?.data?.bankHoldMinutes || 1440
        : null;
  for (const l of lines)
    await db.query(
      "INSERT INTO commerce_holds(id,order_id,product_id,warehouse_id,quantity) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), orderId, l.productId, warehouse, l.quantity],
    );
  await db.query(
    "UPDATE ecommerce_orders SET warehouse_id=$2,hold_expires_at=CASE WHEN $3::int IS NULL THEN NULL ELSE now()+($3||' minutes')::interval END WHERE id=$1",
    [orderId, warehouse, minutes],
  );
  return warehouse;
}
export async function releaseCredit(db: DB, order: any, kind = "RELEASE") {
  if (order.payment_method !== "CREDIT_TERMS" || !order.company_id) return;
  await db.query("SELECT id FROM commerce_companies WHERE id=$1 FOR UPDATE", [
    order.company_id,
  ]);
  const r = await one(
    db,
    "SELECT COALESCE(sum(amount),0)::text n FROM commerce_credit_entries WHERE order_id=$1",
    [order.id],
  );
  if (new Decimal(r!.n).gt(0))
    await db.query(
      "INSERT INTO commerce_credit_entries(id,company_id,order_id,amount,kind,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        order.company_id,
        order.id,
        new Decimal(r!.n).neg().toFixed(2),
        kind,
        `${kind}:${order.id}`,
      ],
    );
}
export async function expireHolds(db: DB) {
  await db.query("UPDATE commerce_requests r SET status='EXPIRED',version=version+1 WHERE r.status='QUOTED' AND r.quotation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quotation_access_tokens a WHERE a.quotation_id=r.quotation_id AND a.revoked_at IS NULL AND a.expires_at>now())");
  const ids = (
    await db.query(
      "SELECT id FROM ecommerce_orders WHERE hold_expires_at<=now() AND status IN ('PENDING_PAYMENT','PENDING_REVIEW') AND sales_order_id IS NULL ORDER BY id LIMIT 100",
    )
  ).rows;
  for (const { id } of ids)
    await db.transaction(async (tx) => {
      const o = await one(
        tx,
        "SELECT * FROM ecommerce_orders WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (
        !o ||
        !["PENDING_PAYMENT", "PENDING_REVIEW"].includes(o.status) ||
        new Date(o.hold_expires_at) > new Date()
      )
        return;
      await tx.query(
        "UPDATE commerce_holds SET status='RELEASED' WHERE order_id=$1 AND status='ACTIVE'",
        [id],
      );
      await releaseCredit(tx, o);
      await tx.query(
        "UPDATE ecommerce_orders SET status=$2,hold_expires_at=NULL,fulfillment_data=fulfillment_data||$3::jsonb,version=version+1,updated_at=now() WHERE id=$1",
        [
          id,
          new Decimal(o.paid_amount).gt(0) ? "PENDING_REVIEW" : "CANCELLED",
          json(
            new Decimal(o.paid_amount).gt(0)
              ? {
                  paymentReview:
                    "Partial payment received; hold expired. Allocate stock or arrange refund.",
                }
              : {},
          ),
        ],
      );
      await event(tx, {
        orderId: id,
        companyId: o.company_id,
        accountId: o.customer_account_id,
        kind: "HOLD_EXPIRED",
        message: "Payment review time expired; stock was released.",
      });
    });
}
export async function settlePayment(db: DB, orderId: string, paid: boolean) {
  const o = await one(
    db,
    "SELECT * FROM ecommerce_orders WHERE id=$1 FOR UPDATE",
    [orderId],
  );
  if (!o) return;
  if (paid) {
    if (o.sales_order_id) return;
    let review = o.status === "CANCELLED";
    const hold = await one(
      db,
      "SELECT id FROM commerce_holds WHERE order_id=$1 AND status='ACTIVE' LIMIT 1",
      [orderId],
    );
    if (!hold) {
      // Keep a captured late payment visible for staff; never claim unavailable stock.
      review = true;
    }
    await db.query(
      "UPDATE ecommerce_orders SET paid_amount=(totals->>'total')::numeric,status=$2,hold_expires_at=NULL,version=version+1,fulfillment_data=fulfillment_data||$3::jsonb WHERE id=$1",
      [
        orderId,
        review ? "PENDING_REVIEW" : "CONFIRMED",
        json(
          review
            ? {
                paymentReview:
                  "Payment received after stock release; allocate stock or refund.",
              }
            : {},
        ),
      ],
    );
  } else if (o.status === "PENDING_PAYMENT") {
    await db.query(
      "UPDATE commerce_holds SET status='RELEASED' WHERE order_id=$1 AND status='ACTIVE'",
      [orderId],
    );
    await db.query(
      "UPDATE ecommerce_orders SET status='FAILED',version=version+1 WHERE id=$1",
      [orderId],
    );
  }
}
export async function orderAction(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  await feature(db, "operationsEnabled");
  const d = z
    .object({
      action: z.enum(["CANCEL", "PAYMENT", "TRACKING", "CONFIRM", "PROCESSING", "DELIVER"]),
      version: z.number().int(),
      amount: amount.optional(),
      reference: z.string().max(200).default(""),
      carrier: z.string().max(100).default(""),
      tracking: z.string().max(200).default(""),
      warehouseId: z.string().uuid().optional(),
      notes: z.string().max(1000).default(""),
      idempotencyKey: z.string().uuid(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const o = await one(
      tx,
      "SELECT * FROM ecommerce_orders WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(o, 404, "Order not found");
    const previous = await one(
      tx,
      "SELECT * FROM payment_transactions WHERE request_key=$1",
      [d.idempotencyKey],
    );
    if (previous) {
      assert(
        previous.ecommerce_order_id === id &&
          d.amount &&
          new Decimal(previous.amount).eq(d.amount) &&
          previous.provider_reference === d.reference,
        409,
        "Payment retry has different details",
      );
      return { ok: true };
    }
    assert(o.version === d.version, 409, "Order changed. Reload");
    if (d.action === "CANCEL") {
      assert(!['CANCELLED','FAILED'].includes(o.status),409,'Order is already cancelled or failed');
      if(o.sales_order_id){requirePermission(actor,'SALES_ORDER_MANAGE');const sales=await one(tx,'SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE',[o.sales_order_id]);assert(sales&&sales.lines.every((l:any)=>new Decimal(l.deliveredQuantity||0).isZero()),409,'Delivered orders require a return request');await tx.query("UPDATE stock_reservations SET status='RELEASED',updated_at=now() WHERE sales_order_id=$1 AND status='ACTIVE'",[sales.id]);await tx.query("UPDATE sales_orders SET status='CANCELLED',version=version+1 WHERE id=$1",[sales.id]);}
      if(new Decimal(o.paid_amount).gt(0)){await tx.query("INSERT INTO commerce_returns(id,order_id,account_id,lines,reason,status,inspection) VALUES($1,$2,$3,$4,'Order cancelled before delivery','INSPECTED','No goods delivered; refund required, no inventory receipt')",[randomUUID(),id,o.customer_account_id,json(o.lines.map((l:any)=>({productId:l.productId,quantity:l.quantity})))]);}
      await tx.query(
        "UPDATE commerce_holds SET status='RELEASED' WHERE order_id=$1 AND status='ACTIVE'",
        [id],
      );
      await releaseCredit(tx, o);
      await tx.query(
        "UPDATE ecommerce_orders SET status='CANCELLED',version=version+1 WHERE id=$1",
        [id],
      );
    } else if (d.action === "PAYMENT") {
      assert(
        ["BANK_TRANSFER", "CREDIT_TERMS"].includes(o.payment_method),
        400,
        "Online payments are verified through the payment provider",
      );
      assert(
        !["CANCELLED", "FAILED"].includes(o.status),
        409,
        "Order cannot receive payment",
      );
      assert(
        d.amount && new Decimal(d.amount).gt(0) && d.reference,
        400,
        "Enter a positive payment and verified bank reference",
      );
      const paid = new Decimal(o.paid_amount).add(d.amount);
      assert(
        paid.lte(o.totals.total),
        400,
        "Payment exceeds the outstanding amount",
      );
      assert(
        !(await one(
          tx,
          "SELECT id FROM payment_transactions WHERE ecommerce_order_id=$1 AND provider='BANK_TRANSFER' AND provider_reference=$2",
          [id, d.reference],
        )),
        409,
        "This bank reference has already been recorded for the order",
      );
      await tx.query(
        "INSERT INTO payment_transactions(id,ecommerce_order_id,provider,provider_reference,status,amount,request_key) VALUES($1,$2,'BANK_TRANSFER',$3,'PAID',$4,$5)",
        [randomUUID(), id, d.reference, d.amount, d.idempotencyKey],
      );
      if (o.company_id) {
        await tx.query(
          "SELECT id FROM commerce_companies WHERE id=$1 FOR UPDATE",
          [o.company_id],
        );
        await tx.query(
          "INSERT INTO commerce_credit_entries(id,company_id,order_id,amount,kind,idempotency_key) VALUES($1,$2,$3,$4,'PAYMENT',$5)",
          [
            randomUUID(),
            o.company_id,
            id,
            o.payment_method === "CREDIT_TERMS"
              ? new Decimal(d.amount).neg().toFixed(2)
              : "0",
            d.idempotencyKey,
          ],
        );
      }
      await tx.query(
        "UPDATE ecommerce_orders SET paid_amount=$2,hold_expires_at=CASE WHEN $2::numeric=(totals->>'total')::numeric THEN NULL ELSE hold_expires_at END,version=version+1 WHERE id=$1",
        [id, paid.toFixed(2)],
      );
    } else if (d.action === "CONFIRM") {
      assert(!["CANCELLED", "FAILED"].includes(o.status), 409, "Cancelled or failed orders cannot be confirmed");
      await tx.query(
        "UPDATE ecommerce_orders SET status='CONFIRMED',warehouse_id=COALESCE($2,warehouse_id),fulfillment_data=fulfillment_data||$3::jsonb,version=version+1 WHERE id=$1",
        [id, d.warehouseId || null, json({ confirmedAt: new Date().toISOString(), fulfillmentStatus: 'CONFIRMED' })],
      );
    } else if (d.action === "PROCESSING") {
      assert(!["CANCELLED", "FAILED"].includes(o.status), 409, "Cancelled or failed orders cannot be processed");
      await tx.query(
        "UPDATE ecommerce_orders SET status=CASE WHEN status IN ('PENDING_REVIEW','PENDING_PAYMENT') THEN 'CONFIRMED' ELSE status END,warehouse_id=COALESCE($2,warehouse_id),fulfillment_data=fulfillment_data||$3::jsonb,version=version+1 WHERE id=$1",
        [id, d.warehouseId || null, json({ processingAt: new Date().toISOString(), fulfillmentStatus: 'PROCESSING' })],
      );
    } else if (d.action === "DELIVER") {
      assert(!["CANCELLED", "FAILED"].includes(o.status), 409, "Cancelled or failed orders cannot be delivered");
      await tx.query(
        "UPDATE ecommerce_orders SET fulfillment_data=fulfillment_data||$2::jsonb,version=version+1 WHERE id=$1",
        [id, json({ deliveredAt: new Date().toISOString(), fulfillmentStatus: 'DELIVERED' })],
      );
    } else {
      await tx.query(
        "UPDATE ecommerce_orders SET fulfillment_data=fulfillment_data||$2::jsonb,version=version+1 WHERE id=$1",
        [id, json({ carrier: d.carrier, tracking: d.tracking, shippedAt: new Date().toISOString(), fulfillmentStatus: 'SHIPPED' })],
      );
    }
    await event(tx, {
      orderId: id,
      companyId: o.company_id,
      accountId: o.customer_account_id,
      kind: d.action,
      message:
        d.action === "PAYMENT"
          ? `Payment recorded: ${d.amount} SAR. Reference: ${d.reference}`
          : d.action === "TRACKING"
            ? `Shipment updated: ${d.carrier} ${d.tracking}`
            : d.action === "CONFIRM"
              ? "Order confirmed by store admin."
              : d.action === "PROCESSING"
                ? "Order is being prepared in warehouse."
                : d.action === "DELIVER"
                  ? "Order marked as delivered."
                  : "Order cancelled.",
    });
    await audit(
      tx,
      actor.id,
      "COMMERCE_ORDER_" + d.action,
      "ecommerce_orders",
      id,
      null,
      d,
    );
    return { ok: true };
  });
}
export async function requestReturn(db: DB, account: any, raw: unknown) {
  await feature(db, "operationsEnabled");
  const c = account ? await companyFor(db, account) : null;
  const d = z
    .object({
      verificationToken: z.string().optional(),
      orderId: z.string().uuid(),
      reason: z.string().trim().min(3).max(2000),
      lines: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: z
              .string()
              .regex(/^\d+(?:\.\d{1,6})?$/)
              .refine((v) => new Decimal(v).gt(0)),
          }),
        )
        .min(1)
        .max(100),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const o = await one(
      tx,
      "SELECT o.*,s.lines delivered_lines FROM ecommerce_orders o LEFT JOIN sales_orders s ON s.id=o.sales_order_id WHERE o.id=$1 FOR UPDATE OF o",
      [d.orderId],
    );
    assert(o, 404, "Order not found");
    if (c)
      assert(
        o.company_id === c.company_id &&
          (c.company_role === "OWNER" || o.customer_account_id === account.id),
        404,
        "Order not found",
      );
    else {
      const otp = await one(
        tx,
        "SELECT verification_token_hash FROM otp_challenges WHERE id=$1",
        [o.verification_id],
      );
      assert(
        !o.customer_account_id &&
          d.verificationToken &&
          otp?.verification_token_hash ===
            createHash("sha256").update(d.verificationToken).digest("hex"),
        403,
        "Order access denied",
      );
    }
    assert(
      new Set(d.lines.map((l) => l.productId)).size === d.lines.length,
      400,
      "Duplicate return products",
    );
    const previous = (
      await tx.query(
        "SELECT lines FROM commerce_returns WHERE order_id=$1 AND status<>'REJECTED'",
        [o.id],
      )
    ).rows;
    for (const l of d.lines) {
      const delivered = (o.delivered_lines || []).find(
        (x: any) => x.productId === l.productId,
      );
      const used = previous
        .flatMap((r) => r.lines)
        .filter((x: any) => x.productId === l.productId)
        .reduce((n: Decimal, x: any) => n.add(x.quantity), new Decimal(0));
      assert(
        delivered &&
          new Decimal(delivered.deliveredQuantity).gte(used.add(l.quantity)),
        400,
        "Return quantity exceeds delivered quantity",
      );
    }
    const id = randomUUID();
    await tx.query(
      "INSERT INTO commerce_returns(id,order_id,account_id,lines,reason) VALUES($1,$2,$3,$4,$5)",
      [id, o.id, account?.id || null, json(d.lines), d.reason],
    );
    await event(tx, {
      orderId: o.id,
      companyId: c?.company_id,
      accountId: account?.id,
      kind: "RETURN_REQUESTED",
      message: "Return request submitted for review.",
    });
    return { id };
  });
}
export async function dispatchNotifications(db: DB) {
  await db.query(
    "UPDATE commerce_notifications SET status='FAILED',error='Delivery interrupted; retry with the same notification ID' WHERE status='SENDING' AND updated_at<now()-interval '5 minutes'",
  );
  if (!process.env.COMMERCE_NOTIFICATION_URL) return;
  const rows = (
    await db.query(
      "UPDATE commerce_notifications SET status='SENDING',attempts=attempts+1,updated_at=now() WHERE id IN (SELECT id FROM commerce_notifications WHERE status='QUEUED' ORDER BY updated_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *",
    )
  ).rows;
  for (const n of rows)
    try {
      const e = await one(
        db,
        "SELECT message,kind FROM commerce_events WHERE id=$1",
        [n.event_id],
      );
      const r = await fetch(process.env.COMMERCE_NOTIFICATION_URL, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.COMMERCE_NOTIFICATION_TOKEN || ""}`,
          "Idempotency-Key": n.id,
        },
        body: JSON.stringify({ to: n.destination, ...e }),
      });
      assert(r.ok, 502, "Notification provider failed");
      await db.query(
        "UPDATE commerce_notifications SET status='SENT',error=NULL,updated_at=now() WHERE id=$1",
        [n.id],
      );
    } catch {
      await db.query(
        "UPDATE commerce_notifications SET status='FAILED',error='Delivery failed; retry from commerce admin',updated_at=now() WHERE id=$1",
        [n.id],
      );
    }
}
