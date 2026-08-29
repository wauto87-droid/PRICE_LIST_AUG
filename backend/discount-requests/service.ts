import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { type DB, one } from "../core/db";
import { audit, json } from "../core/audit";
import { assert } from "../core/errors";
import {
  type Actor,
  has,
  requirePermission,
} from "../auth/service";
import {
  calculate,
  levelCode,
  levelPrice,
  lineInput,
  money,
  selectedLevel,
} from "../pricing/engine";
import { getProduct, toInput } from "../products/service";

const requestInput = z
  .object({
    productId: z.string().uuid(),
    sellingLevel: levelCode.optional(),
    quantity: z.string(),
    discount: z.string(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

const decisionInput = z
  .object({
    note: z.string().trim().min(1).max(500),
  })
  .strict();

function requestPermissions(actor: Actor) {
  assert(
    has(actor, "ADMIN_VIEW") || has(actor, "OVERRIDE_MINIMUM_PRICE"),
    403,
    "You do not have permission for this action",
  );
}

export async function createRequest(db: DB, actor: Actor, input: unknown) {
  requirePermission(actor, "PRODUCT_VIEW");
  const data = requestInput.parse(input);
  const requestLine = lineInput.parse({
    productId: data.productId,
    sellingLevel: data.sellingLevel,
    quantity: data.quantity,
    discount: data.discount,
    override: false,
    reason: "",
  });
  return db.transaction(async (tx) => {
    const product = await getProduct(tx, data.productId);
    assert(product.active, 409, "Product is archived");
    const productInput = toInput(product);
    const protectedPrice = calculate(
      productInput,
      { maxDiscount: actor.maxDiscount, canOverride: false },
      requestLine,
    );
    assert(
      protectedPrice.minimumReached,
      409,
      "This price does not require below-minimum approval",
    );
    const level = selectedLevel(productInput, requestLine.sellingLevel);
    const requestedFinalPrice = money(
      levelPrice(productInput, level).mul(
        new Decimal(1).sub(new Decimal(requestLine.discount).div(100)),
      ),
    );
    const id = randomUUID();
    const snapshot = {
      description: product.part_number ? product.description : "",
      brand: product.brand,
      category: product.category,
      unit: product.unit,
      quantityPrecision: product.quantity_precision,
      defaultLevel: product.default_level,
    };
    const created = {
      id,
      status: "PENDING",
      partNumber: product.part_number,
      productId: product.id,
      productDescription: product.description,
      requestedBy: actor.name,
      requestedById: actor.id,
      sellingLevel: protectedPrice.sellingLevel,
      quantity: protectedPrice.quantity,
      requestedDiscount: requestLine.discount,
      requestedFinalPrice,
      protectedPrice: protectedPrice.finalExcl,
      reason: data.reason,
      createdAt: new Date().toISOString(),
    };
    await tx.query(
      `INSERT INTO discount_requests(
         id,product_id,requested_by,part_number,product_snapshot,selling_level,
         quantity,requested_discount,requested_final_price,protected_price,reason
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        product.id,
        actor.id,
        product.part_number,
        json(snapshot),
        protectedPrice.sellingLevel,
        protectedPrice.quantity,
        requestLine.discount,
        requestedFinalPrice,
        protectedPrice.finalExcl,
        data.reason,
      ],
    );
    await tx.query(
      "INSERT INTO discount_request_events(id,request_id,actor_id,action,note,snapshot) VALUES($1,$2,$3,'CREATED',$4,$5)",
      [
        randomUUID(),
        id,
        actor.id,
        data.reason,
        json({
          sellingLevel: protectedPrice.sellingLevel,
          quantity: protectedPrice.quantity,
          requestedDiscount: requestLine.discount,
          requestedFinalPrice,
          protectedPrice: protectedPrice.finalExcl,
        }),
      ],
    );
    await audit(
      tx,
      actor.id,
      "DISCOUNT_REQUEST_CREATE",
      "discount_requests",
      id,
      null,
      {
        partNumber: product.part_number,
        sellingLevel: protectedPrice.sellingLevel,
        quantity: protectedPrice.quantity,
        requestedDiscount: requestLine.discount,
        requestedFinalPrice,
        protectedPrice: protectedPrice.finalExcl,
        status: "PENDING",
      },
      data.reason,
    );
    return created;
  });
}

export async function listRequests(db: DB, actor: Actor) {
  requestPermissions(actor);
  const items = (
    await db.query(
      `SELECT
         r.id,
         r.status,
         r.part_number AS "partNumber",
         r.selling_level AS "sellingLevel",
         r.quantity::text AS quantity,
         r.requested_discount::text AS "requestedDiscount",
         r.requested_final_price::text AS "requestedFinalPrice",
         r.protected_price::text AS "protectedPrice",
         r.reason,
         r.created_at AS "createdAt",
         r.updated_at AS "updatedAt",
         p.description AS "productDescription",
         requester.name AS "requestedBy",
         decider.name AS "decidedBy"
       FROM discount_requests r
       JOIN products p ON p.id=r.product_id
       JOIN users requester ON requester.id=r.requested_by
       LEFT JOIN users decider ON decider.id=r.decided_by
       ORDER BY
         CASE r.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
         r.updated_at DESC,
         r.created_at DESC`,
    )
  ).rows;
  const counts = (
    await one(
      db,
      `SELECT
         count(*) FILTER (WHERE status='PENDING')::int AS pending,
         count(*) FILTER (WHERE status='APPROVED')::int AS approved,
         count(*) FILTER (WHERE status='REJECTED')::int AS rejected
       FROM discount_requests`,
    )
  ) || { pending: 0, approved: 0, rejected: 0 };
  return { items, counts };
}

export async function getRequestDetail(db: DB, actor: Actor, id: string) {
  requestPermissions(actor);
  const request = await one(
    db,
    `SELECT
       r.*,
       r.quantity::text AS quantity,
       r.requested_discount::text AS requested_discount_text,
       r.requested_final_price::text AS requested_final_price_text,
       r.protected_price::text AS protected_price_text,
       p.description AS product_description,
       requester.name AS requested_by_name,
       decider.name AS decided_by_name
     FROM discount_requests r
     JOIN products p ON p.id=r.product_id
     JOIN users requester ON requester.id=r.requested_by
     LEFT JOIN users decider ON decider.id=r.decided_by
     WHERE r.id=$1`,
    [id],
  );
  assert(request, 404, "Discount request not found");
  const history = (
    await db.query(
      `SELECT
         h.id,
         h.created_at,
         h.source,
         h.before_value,
         h.after_value,
         u.name AS actor
       FROM price_history h
       LEFT JOIN users u ON u.id=h.actor_id
       WHERE h.product_id=$1
       ORDER BY h.created_at DESC
       LIMIT 12`,
      [request.product_id],
    )
  ).rows;
  const quotations = (
    await db.query(
      `SELECT
         q.id,
         q.number,
         q.status,
         q.updated_at,
         q.created_at,
         owner.name AS owner,
         q.customer->>'name' AS customer_name,
         line->'price'->>'finalExcl' AS final_price,
         line->'price'->>'quantity' AS quantity,
         line->'price'->>'effectiveDiscount' AS effective_discount
       FROM quotations q
       JOIN users owner ON owner.id=q.owner_id
       CROSS JOIN LATERAL jsonb_array_elements(q.lines) AS line
       WHERE q.status <> 'DELETED' AND line->>'productId' = $1
       ORDER BY q.updated_at DESC
       LIMIT 12`,
      [request.product_id],
    )
  ).rows;
  const events = (
    await db.query(
      `SELECT
         e.id,
         e.action,
         e.note,
         e.snapshot,
         e.created_at,
         u.name AS actor
       FROM discount_request_events e
       LEFT JOIN users u ON u.id=e.actor_id
       WHERE e.request_id=$1
       ORDER BY e.created_at ASC`,
      [id],
    )
  ).rows;
  return {
    id: request.id,
    status: request.status,
    partNumber: request.part_number,
    productId: request.product_id,
    productDescription: request.product_description,
    productSnapshot: request.product_snapshot,
    requestedBy: request.requested_by_name,
    requestedById: request.requested_by,
    decidedBy: request.decided_by_name,
    decidedById: request.decided_by,
    sellingLevel: request.selling_level,
    quantity: request.quantity,
    requestedDiscount: request.requested_discount_text,
    requestedFinalPrice: request.requested_final_price_text,
    protectedPrice: request.protected_price_text,
    reason: request.reason,
    decisionNote: request.decision_note,
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    decidedAt: request.decided_at,
    history,
    quotations,
    events,
  };
}

async function decide(
  db: DB,
  actor: Actor,
  id: string,
  status: "APPROVED" | "REJECTED",
  input: unknown,
) {
  requirePermission(actor, "OVERRIDE_MINIMUM_PRICE");
  const data = decisionInput.parse(input);
  return db.transaction(async (tx) => {
    const request = await one(
      tx,
      "SELECT * FROM discount_requests WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(request, 404, "Discount request not found");
    assert(request.status === "PENDING", 409, "This discount request is already closed");
    await tx.query(
      `UPDATE discount_requests
       SET status=$2, decision_note=$3, decided_by=$4, decided_at=now(), updated_at=now()
       WHERE id=$1`,
      [id, status, data.note, actor.id],
    );
    await tx.query(
      "INSERT INTO discount_request_events(id,request_id,actor_id,action,note,snapshot) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        id,
        actor.id,
        status === "APPROVED" ? "APPROVED" : "REJECTED",
        data.note,
        json({
          status,
          decisionNote: data.note,
        }),
      ],
    );
    await audit(
      tx,
      actor.id,
      status === "APPROVED"
        ? "DISCOUNT_REQUEST_APPROVE"
        : "DISCOUNT_REQUEST_REJECT",
      "discount_requests",
      id,
      { status: request.status },
      { status, decisionNote: data.note },
      data.note,
    );
    return { ok: true };
  });
}

export async function approveRequest(db: DB, actor: Actor, id: string, input: unknown) {
  return decide(db, actor, id, "APPROVED", input);
}

export async function rejectRequest(db: DB, actor: Actor, id: string, input: unknown) {
  return decide(db, actor, id, "REJECTED", input);
}
