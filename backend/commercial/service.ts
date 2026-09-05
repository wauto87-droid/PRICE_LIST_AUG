import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "../core/db";
import { one } from "../core/db";
import { assert } from "../core/errors";
import { audit, json } from "../core/audit";
import type { Actor } from "../auth/service";
import { requirePermission } from "../auth/service";
import Decimal from "decimal.js";
const d = (value: unknown) => new Decimal(String(value ?? 0));

const pageInput = z.object({
  query: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  active: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
});

const warehouseInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().max(120).default(""),
  address: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
  allowNegativeStock: z.boolean().default(false),
  pickupEnabled: z.boolean().default(false),
  version: z.number().int().positive().optional(),
});

const supplierInput = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(160),
  taxNumber: z.string().trim().max(30).default(""),
  contacts: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
  paymentTerms: z.string().trim().max(200).default(""),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .default("SAR"),
  leadTimeDays: z.number().int().min(0).max(3650).default(0),
  active: z.boolean().default(true),
  version: z.number().int().positive().optional(),
});

export async function dashboard(db: DB, actor: Actor) {
  requirePermission(actor, "COMMERCIAL_VIEW");
  const [quotes, orders, stock, purchasing, storefront] = await Promise.all([
    one(
      db,
      `SELECT count(*) FILTER(WHERE status='PENDING_APPROVAL')::int pending_approvals,
      count(*) FILTER(WHERE status='ACCEPTED')::int accepted_quotes FROM quotations WHERE status<>'DELETED'`,
    ),
    one(
      db,
      `SELECT count(*) FILTER(WHERE status NOT IN ('DELIVERED','CANCELLED','CLOSED'))::int open_orders,
      count(*) FILTER(WHERE status='PARTIALLY_DELIVERED')::int partial_orders FROM sales_orders`,
    ),
    one(
      db,
      `SELECT count(*)::int warehouses,
      count(*) FILTER(WHERE active)::int active_warehouses FROM warehouses`,
    ),
    one(
      db,
      `SELECT count(*) FILTER(WHERE status IN ('APPROVED','PARTIALLY_RECEIVED'))::int incoming_pos,
      count(*) FILTER(WHERE status='DRAFT')::int draft_pos FROM purchase_orders`,
    ),
    one(db, `SELECT enabled,data,version FROM storefront_settings WHERE id=1`),
  ]);
  return {
    quotations: quotes,
    salesOrders: orders,
    inventory: stock,
    purchasing,
    storefront,
  };
}

export async function warehouses(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "INVENTORY_VIEW");
  const input = pageInput.parse(raw);
  const where = [
    `($1='' OR code ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%' OR name_ar ILIKE '%'||$1||'%')`,
  ];
  const args: unknown[] = [input.query];
  if (input.active !== "ALL") {
    args.push(input.active === "ACTIVE");
    where.push(`active=$${args.length}`);
  }
  const count = Number(
    (
      await one(
        db,
        `SELECT count(*) n FROM warehouses WHERE ${where.join(" AND ")}`,
        args,
      )
    )?.n ?? 0,
  );
  args.push(input.pageSize, (input.page - 1) * input.pageSize);
  const items = (
    await db.query(
      `SELECT w.*,
    COALESCE((SELECT count(*) FROM warehouse_bins b WHERE b.warehouse_id=w.id AND b.active),0)::int bin_count,
    COALESCE((SELECT count(DISTINCT product_id) FROM inventory_movements m WHERE m.warehouse_id=w.id),0)::int product_count
    FROM warehouses w WHERE ${where.join(" AND ")} ORDER BY active DESC,code LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )
  ).rows;
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / input.pageSize)),
  };
}

export async function saveWarehouse(
  db: DB,
  actor: Actor,
  id: string | undefined,
  raw: unknown,
) {
  requirePermission(actor, "INVENTORY_MANAGE");
  const data = warehouseInput.parse(raw);
  return db.transaction(async (tx) => {
    if (id) {
      const before = await one(
        tx,
        "SELECT * FROM warehouses WHERE id=$1 FOR UPDATE",
        [id],
      );
      assert(before, 404, "Warehouse not found");
      assert(
        data.version === before.version,
        409,
        "Warehouse changed. Reload and try again",
      );
      const row = (
        await tx.query(
          `UPDATE warehouses SET code=$2,name=$3,name_ar=$4,address=$5,active=$6,
        allow_negative_stock=$7,pickup_enabled=$8,updated_by=$9,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
          [
            id,
            data.code,
            data.name,
            data.nameAr,
            json(data.address),
            data.active,
            data.allowNegativeStock,
            data.pickupEnabled,
            actor.id,
          ],
        )
      ).rows[0];
      await audit(
        tx,
        actor.id,
        "WAREHOUSE_UPDATE",
        "warehouses",
        id,
        before,
        row,
      );
      return row;
    }
    const nextId = randomUUID();
    const row = (
      await tx.query(
        `INSERT INTO warehouses(id,code,name,name_ar,address,active,allow_negative_stock,pickup_enabled,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [
          nextId,
          data.code,
          data.name,
          data.nameAr,
          json(data.address),
          data.active,
          data.allowNegativeStock,
          data.pickupEnabled,
          actor.id,
        ],
      )
    ).rows[0];
    await audit(
      tx,
      actor.id,
      "WAREHOUSE_CREATE",
      "warehouses",
      nextId,
      null,
      row,
    );
    return row;
  });
}

export async function stockBalances(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "INVENTORY_VIEW");
  const input = pageInput
    .extend({ warehouseId: z.string().uuid().optional() })
    .parse(raw);
  const args: unknown[] = [input.query];
  const where = [
    `($1='' OR p.part_number ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%')`,
  ];
  if (input.warehouseId) {
    args.push(input.warehouseId);
    where.push(`w.id=$${args.length}`);
  }
  const base = `FROM warehouses w CROSS JOIN products p
    LEFT JOIN (SELECT warehouse_id,product_id,sum(quantity) quantity FROM inventory_movements WHERE kind NOT IN ('RESERVE','RELEASE') GROUP BY warehouse_id,product_id) m
      ON m.warehouse_id=w.id AND m.product_id=p.id
    LEFT JOIN (SELECT warehouse_id,product_id,sum(quantity) quantity FROM stock_reservations WHERE status='ACTIVE' GROUP BY warehouse_id,product_id) r
      ON r.warehouse_id=w.id AND r.product_id=p.id
    WHERE w.active AND p.active AND ${where.join(" AND ")}`;
  const count = Number(
    (await one(db, `SELECT count(*) n FROM (SELECT p.id ${base}) q`, args))
      ?.n ?? 0,
  );
  args.push(input.pageSize, (input.page - 1) * input.pageSize);
  const items = (
    await db.query(
      `SELECT w.id warehouse_id,w.code warehouse_code,w.name warehouse_name,p.id product_id,p.part_number,p.description,
    COALESCE(m.quantity,0)::text on_hand,COALESCE(r.quantity,0)::text reserved,
    (COALESCE(m.quantity,0)-COALESCE(r.quantity,0))::text available ${base}
    ORDER BY p.part_number,w.code LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )
  ).rows;
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / input.pageSize)),
  };
}

export async function suppliers(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "PURCHASE_MANAGE");
  const input = pageInput.parse(raw);
  const args: unknown[] = [input.query];
  const where = [
    `($1='' OR code ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%' OR tax_number ILIKE '%'||$1||'%')`,
  ];
  if (input.active !== "ALL") {
    args.push(input.active === "ACTIVE");
    where.push(`active=$${args.length}`);
  }
  const total = Number(
    (
      await one(
        db,
        `SELECT count(*) n FROM suppliers WHERE ${where.join(" AND ")}`,
        args,
      )
    )?.n ?? 0,
  );
  args.push(input.pageSize, (input.page - 1) * input.pageSize);
  const items = (
    await db.query(
      `SELECT * FROM suppliers WHERE ${where.join(" AND ")} ORDER BY active DESC,name LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    )
  ).rows;
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function saveSupplier(
  db: DB,
  actor: Actor,
  id: string | undefined,
  raw: unknown,
) {
  requirePermission(actor, "PURCHASE_MANAGE");
  const data = supplierInput.parse(raw);
  return db.transaction(async (tx) => {
    if (id) {
      const before = await one(
        tx,
        "SELECT * FROM suppliers WHERE id=$1 FOR UPDATE",
        [id],
      );
      assert(before, 404, "Supplier not found");
      assert(
        data.version === before.version,
        409,
        "Supplier changed. Reload and try again",
      );
      const row = (
        await tx.query(
          `UPDATE suppliers SET code=$2,name=$3,tax_number=$4,contacts=$5,payment_terms=$6,currency=$7,
        lead_time_days=$8,active=$9,updated_by=$10,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *`,
          [
            id,
            data.code,
            data.name,
            data.taxNumber,
            json(data.contacts),
            data.paymentTerms,
            data.currency,
            data.leadTimeDays,
            data.active,
            actor.id,
          ],
        )
      ).rows[0];
      await audit(
        tx,
        actor.id,
        "SUPPLIER_UPDATE",
        "suppliers",
        id,
        before,
        row,
      );
      return row;
    }
    const nextId = randomUUID();
    const row = (
      await tx.query(
        `INSERT INTO suppliers(id,code,name,tax_number,contacts,payment_terms,currency,lead_time_days,active,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [
          nextId,
          data.code,
          data.name,
          data.taxNumber,
          json(data.contacts),
          data.paymentTerms,
          data.currency,
          data.leadTimeDays,
          data.active,
          actor.id,
        ],
      )
    ).rows[0];
    await audit(
      tx,
      actor.id,
      "SUPPLIER_CREATE",
      "suppliers",
      nextId,
      null,
      row,
    );
    return row;
  });
}

const quantity = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    const n = new Decimal(String(v));
    if (!n.isFinite() || n.lte(0) || n.decimalPlaces() > 6) throw new Error();
    return n.toFixed();
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Enter a positive quantity with up to 6 decimal places",
    });
    return z.NEVER;
  }
});

async function documentNumber(db: DB, kind: string, prefix: string) {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const row = await one(
    db,
    `INSERT INTO document_sequences(day,kind,counter) VALUES($1,$2,1)
    ON CONFLICT(day,kind) DO UPDATE SET counter=document_sequences.counter+1 RETURNING counter`,
    [day, kind],
  );
  return `${prefix}-${day}-${String(row!.counter).padStart(4, "0")}`;
}

const orderLineSnapshot = (line: any, index: number) => ({
  key: String(index + 1),
  source: line.source,
  productId: line.productId ?? null,
  partNumber: line.partNumber,
  description: line.description,
  unit: line.unit,
  quantity: String(line.input?.quantity ?? line.price?.quantity ?? "1"),
  reservedQuantity: "0",
  deliveredQuantity: "0",
  price: line.price,
  input: line.input,
});

export async function convertAcceptedQuotation(
  db: DB,
  actor: Actor,
  quotationId: string,
  raw: unknown,
) {
  requirePermission(actor, "SALES_ORDER_MANAGE");
  const data = z
    .object({
      warehouseId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const previous = await one(
      tx,
      "SELECT * FROM sales_orders WHERE quotation_id=$1",
      [quotationId],
    );
    if (previous) return previous;
    const q = await one(tx, "SELECT * FROM quotations WHERE id=$1 FOR UPDATE", [
      quotationId,
    ]);
    assert(
      q && q.status === "ACCEPTED",
      409,
      "Only an accepted quotation can become a Sales Order",
    );
    const warehouse: any = await one(
      tx,
      "SELECT * FROM warehouses WHERE id=$1 AND active FOR UPDATE",
      [data.warehouseId],
    );
    assert(warehouse, 400, "Choose an active warehouse");
    const lines = q.lines.map(orderLineSnapshot);
    const id = randomUUID(),
      number = await documentNumber(tx, "SALES_ORDER", "SO");
    await tx.query(
      `INSERT INTO sales_orders(id,number,quotation_id,customer,status,lines,totals,warehouse_id,created_by)
      VALUES($1,$2,$3,$4,'CONFIRMED',$5,$6,$7,$8)`,
      [
        id,
        number,
        quotationId,
        json(q.customer),
        json(lines),
        json(q.totals),
        data.warehouseId,
        actor.id,
      ],
    );
    await audit(tx, actor.id, "SALES_ORDER_CREATE", "sales_orders", id, null, {
      number,
      quotationId,
      warehouseId: data.warehouseId,
    });
    return one(tx, "SELECT * FROM sales_orders WHERE id=$1", [id]);
  });
}

async function availableForUpdate(
  db: DB,
  warehouseId: string,
  productId: string,
) {
  await db.query("SELECT id FROM warehouses WHERE id=$1 FOR UPDATE", [
    warehouseId,
  ]);
  await db.query("SELECT id FROM products WHERE id=$1 FOR UPDATE", [productId]);
  const row = await one(
    db,
    `SELECT
    COALESCE((SELECT sum(quantity) FROM inventory_movements WHERE warehouse_id=$1 AND product_id=$2 AND kind NOT IN ('RESERVE','RELEASE')),0)
    -COALESCE((SELECT sum(quantity) FROM stock_reservations WHERE warehouse_id=$1 AND product_id=$2 AND status='ACTIVE'),0) available`,
    [warehouseId, productId],
  );
  return new Decimal(String(row!.available));
}

export async function reserveSalesOrder(db: DB, actor: Actor, orderId: string) {
  requirePermission(actor, "SALES_ORDER_MANAGE");
  return db.transaction(async (tx) => {
    const order = await one(
      tx,
      "SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE",
      [orderId],
    );
    assert(
      order && ["CONFIRMED", "PARTIALLY_RESERVED"].includes(order.status),
      409,
      "Sales Order cannot be reserved in its current state",
    );
    const warehouse = await one(
      tx,
      "SELECT * FROM warehouses WHERE id=$1 AND active FOR UPDATE",
      [order.warehouse_id],
    );
    assert(warehouse, 409, "Sales Order warehouse is inactive");
    const lines = [...order.lines];
    let fully = true,
      any = false;
    for (const line of lines) {
      if (!line.productId) continue;
      const needed = d(line.quantity)
        .sub(d(line.reservedQuantity))
        .sub(d(line.deliveredQuantity));
      if (needed.lte(0)) continue;
      const available = await availableForUpdate(
        tx,
        order.warehouse_id,
        line.productId,
      );
      const reservable = warehouse.allow_negative_stock
        ? needed
        : Decimal.max(0, Decimal.min(needed, available));
      if (reservable.gt(0)) {
        await tx.query(
          `INSERT INTO stock_reservations(id,sales_order_id,line_key,product_id,warehouse_id,quantity,status)
          VALUES($1,$2,$3,$4,$5,$6,'ACTIVE')`,
          [
            randomUUID(),
            orderId,
            line.key,
            line.productId,
            order.warehouse_id,
            reservable.toString(),
          ],
        );
        line.reservedQuantity = d(line.reservedQuantity)
          .add(reservable)
          .toString();
        any = true;
      }
      if (reservable.lt(needed)) fully = false;
    }
    const status = fully
      ? "RESERVED"
      : any
        ? "PARTIALLY_RESERVED"
        : "CONFIRMED";
    await tx.query(
      "UPDATE sales_orders SET lines=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1",
      [orderId, json(lines), status],
    );
    await audit(
      tx,
      actor.id,
      "SALES_ORDER_RESERVE",
      "sales_orders",
      orderId,
      null,
      { status },
    );
    return one(tx, "SELECT * FROM sales_orders WHERE id=$1", [orderId]);
  });
}

async function consumeFifo(
  db: DB,
  actor: Actor,
  warehouseId: string,
  productId: string,
  movementId: string,
  requested: Decimal,
  allowNegative: boolean,
) {
  let remaining = requested;
  const consumed: { quantity: string; unitCost: string }[] = [];
  const layers = (
    await db.query(
      `SELECT * FROM fifo_layers WHERE warehouse_id=$1 AND product_id=$2 AND remaining_quantity>0 ORDER BY created_at,id FOR UPDATE`,
      [warehouseId, productId],
    )
  ).rows;
  for (const layer of layers) {
    if (remaining.lte(0)) break;
    const used = Decimal.min(remaining, d(layer.remaining_quantity));
    await db.query(
      "UPDATE fifo_layers SET remaining_quantity=remaining_quantity-$2 WHERE id=$1",
      [layer.id, used.toString()],
    );
    await db.query(
      "INSERT INTO fifo_consumptions(id,layer_id,movement_id,quantity,unit_cost) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), layer.id, movementId, used.toString(), layer.unit_cost],
    );
    consumed.push({
      quantity: used.toString(),
      unitCost: String(layer.unit_cost),
    });
    remaining = remaining.sub(used);
  }
  assert(
    allowNegative || remaining.isZero(),
    409,
    "Insufficient FIFO stock to complete delivery",
  );
  if (remaining.gt(0)) {
    const fallback = String(
      (
        await one(
          db,
          "SELECT cost::text cost FROM product_pricing WHERE product_id=$1",
          [productId],
        )
      )?.cost ?? "0",
    );
    consumed.push({ quantity: remaining.toString(), unitCost: fallback });
    await audit(
      db,
      actor.id,
      "NEGATIVE_STOCK_OVERRIDE",
      "inventory_movements",
      movementId,
      null,
      { productId, warehouseId, quantity: remaining.toString() },
      "Warehouse permits negative stock",
    );
  }
  return consumed;
}

export async function deliverSalesOrder(
  db: DB,
  actor: Actor,
  orderId: string,
  raw: unknown,
) {
  requirePermission(actor, "SALES_ORDER_MANAGE");
  const data = z
    .object({
      lines: z.array(z.object({ key: z.string(), quantity })).min(1),
      idempotencyKey: z.string().uuid(),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const existing = await one(
      tx,
      "SELECT * FROM commercial_documents WHERE kind='DELIVERY_NOTE' AND snapshot->>'idempotencyKey'=$1",
      [data.idempotencyKey],
    );
    if (existing) return existing;
    const order = await one(
      tx,
      "SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE",
      [orderId],
    );
    assert(
      order && !["CANCELLED", "CLOSED", "DELIVERED"].includes(order.status),
      409,
      "Sales Order cannot be delivered",
    );
    const warehouse = await one(
      tx,
      "SELECT * FROM warehouses WHERE id=$1 AND active FOR UPDATE",
      [order.warehouse_id],
    );
    assert(warehouse, 409, "Warehouse is inactive");
    const lines = [...order.lines],
      delivered: any[] = [];
    for (const request of data.lines) {
      const line = lines.find((x: any) => x.key === request.key);
      assert(line, 400, `Sales Order line ${request.key} not found`);
      const qty = d(request.quantity),
        remaining = d(line.quantity).sub(d(line.deliveredQuantity));
      assert(
        qty.lte(remaining),
        400,
        `Delivery exceeds remaining quantity for ${line.partNumber}`,
      );
      if (line.productId) {
        const available = await availableForUpdate(
          tx,
          order.warehouse_id,
          line.productId,
        );
        assert(
          warehouse.allow_negative_stock || available.gte(qty),
          409,
          `Insufficient available stock for ${line.partNumber}`,
        );
        const movementId = randomUUID();
        await tx.query(
          `INSERT INTO inventory_movements(id,product_id,warehouse_id,kind,quantity,reference_type,reference_id,idempotency_key,actor_id)
          VALUES($1,$2,$3,'DELIVERY',$4,'SALES_ORDER',$5,$6,$7)`,
          [
            movementId,
            line.productId,
            order.warehouse_id,
            qty.neg().toString(),
            orderId,
            `${data.idempotencyKey}:${line.key}`,
            actor.id,
          ],
        );
        await consumeFifo(
          tx,
          actor,
          order.warehouse_id,
          line.productId,
          movementId,
          qty,
          warehouse.allow_negative_stock,
        );
        const reservations = (
          await tx.query(
            "SELECT * FROM stock_reservations WHERE sales_order_id=$1 AND line_key=$2 AND status='ACTIVE' ORDER BY created_at FOR UPDATE",
            [orderId, line.key],
          )
        ).rows;
        let release = qty;
        for (const reservation of reservations) {
          if (release.lte(0)) break;
          const used = Decimal.min(release, d(reservation.quantity));
          if (used.eq(d(reservation.quantity)))
            await tx.query(
              "UPDATE stock_reservations SET status='FULFILLED',updated_at=now() WHERE id=$1",
              [reservation.id],
            );
          else
            await tx.query(
              "UPDATE stock_reservations SET quantity=quantity-$2,updated_at=now() WHERE id=$1",
              [reservation.id, used.toString()],
            );
          release = release.sub(used);
        }
        line.reservedQuantity = Decimal.max(
          0,
          d(line.reservedQuantity).sub(qty),
        ).toString();
      }
      line.deliveredQuantity = d(line.deliveredQuantity).add(qty).toString();
      delivered.push({ ...line, deliveryQuantity: qty.toString() });
    }
    const complete = lines.every((line: any) =>
      d(line.deliveredQuantity).gte(d(line.quantity)),
    );
    const status = complete ? "DELIVERED" : "PARTIALLY_DELIVERED";
    await tx.query(
      "UPDATE sales_orders SET lines=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1",
      [orderId, json(lines), status],
    );
    const documentId = randomUUID(),
      number = await documentNumber(tx, "DELIVERY_NOTE", "DN");
    const snapshot = {
      idempotencyKey: data.idempotencyKey,
      orderNumber: order.number,
      customer: order.customer,
      warehouseId: order.warehouse_id,
      lines: delivered,
    };
    await tx.query(
      "INSERT INTO commercial_documents(id,kind,number,sales_order_id,status,snapshot,created_by,issued_at) VALUES($1,'DELIVERY_NOTE',$2,$3,'ISSUED',$4,$5,now())",
      [documentId, number, orderId, json(snapshot), actor.id],
    );
    await audit(
      tx,
      actor.id,
      "DELIVERY_NOTE_ISSUE",
      "commercial_documents",
      documentId,
      null,
      { number, orderId, status },
    );
    return one(tx, "SELECT * FROM commercial_documents WHERE id=$1", [
      documentId,
    ]);
  });
}

export async function stockAdjustment(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "INVENTORY_MANAGE");
  const data = z
    .object({
      warehouseId: z.string().uuid(),
      productId: z.string().uuid(),
      quantity: z.union([z.string(), z.number()]),
      unitCost: z.union([z.string(), z.number()]).default("0"),
      reason: z.string().trim().min(3).max(500),
      idempotencyKey: z.string().uuid(),
    })
    .parse(raw);
  const qty = d(data.quantity),
    cost = d(data.unitCost);
  assert(
    qty.isFinite() && !qty.isZero() && qty.decimalPlaces() <= 6,
    400,
    "Enter a non-zero adjustment quantity",
  );
  assert(
    cost.isFinite() && cost.gte(0) && cost.decimalPlaces() <= 6,
    400,
    "Enter a valid unit cost",
  );
  return db.transaction(async (tx) => {
    const existing = await one(
      tx,
      "SELECT * FROM inventory_movements WHERE idempotency_key=$1",
      [data.idempotencyKey],
    );
    if (existing) return existing;
    const warehouse = await one(
      tx,
      "SELECT * FROM warehouses WHERE id=$1 AND active FOR UPDATE",
      [data.warehouseId],
    );
    assert(warehouse, 400, "Warehouse not found or inactive");
    assert(
      await one(
        tx,
        "SELECT id FROM products WHERE id=$1 AND active FOR UPDATE",
        [data.productId],
      ),
      400,
      "Product not found or inactive",
    );
    if (qty.lt(0)) {
      const available = await availableForUpdate(
        tx,
        data.warehouseId,
        data.productId,
      );
      assert(
        warehouse.allow_negative_stock || available.gte(qty.abs()),
        409,
        "Adjustment would create negative stock",
      );
    }
    const id = randomUUID();
    await tx.query(
      `INSERT INTO inventory_movements(id,product_id,warehouse_id,kind,quantity,unit_cost,idempotency_key,reason,actor_id)
      VALUES($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7,$8)`,
      [
        id,
        data.productId,
        data.warehouseId,
        qty.toString(),
        cost.toString(),
        data.idempotencyKey,
        data.reason,
        actor.id,
      ],
    );
    if (qty.gt(0))
      await tx.query(
        "INSERT INTO fifo_layers(id,product_id,warehouse_id,source_movement_id,received_quantity,remaining_quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$5,$6)",
        [
          randomUUID(),
          data.productId,
          data.warehouseId,
          id,
          qty.toString(),
          cost.toString(),
        ],
      );
    else
      await consumeFifo(
        tx,
        actor,
        data.warehouseId,
        data.productId,
        id,
        qty.abs(),
        warehouse.allow_negative_stock,
      );
    await audit(
      tx,
      actor.id,
      "INVENTORY_ADJUSTMENT",
      "inventory_movements",
      id,
      null,
      { ...data, quantity: qty.toString(), unitCost: cost.toString() },
      data.reason,
    );
    return one(tx, "SELECT * FROM inventory_movements WHERE id=$1", [id]);
  });
}

export async function listSalesOrders(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "COMMERCIAL_VIEW");
  const input = pageInput.parse(raw);
  const args: any[] = [input.query];
  const where = [
    `($1='' OR number ILIKE '%'||$1||'%' OR customer->>'name' ILIKE '%'||$1||'%' OR customer->>'number' ILIKE '%'||$1||'%')`,
  ];
  const total = Number(
    (
      await one(
        db,
        `SELECT count(*) n FROM sales_orders WHERE ${where.join(" AND ")}`,
        args,
      )
    )?.n ?? 0,
  );
  args.push(input.pageSize, (input.page - 1) * input.pageSize);
  const items = (
    await db.query(
      `SELECT so.*,w.code warehouse_code FROM sales_orders so LEFT JOIN warehouses w ON w.id=so.warehouse_id WHERE ${where.join(" AND ")} ORDER BY so.created_at DESC LIMIT $2 OFFSET $3`,
      args,
    )
  ).rows;
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

const purchaseOrderInput = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  currency: z.string().trim().length(3).default("SAR"),
  exchangeRate: z.union([z.string(), z.number()]).default("1"),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity,
        unitCost: z.union([z.string(), z.number()]),
      }),
    )
    .min(1)
    .max(500),
});

export async function listPurchaseOrders(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "PURCHASE_MANAGE");
  const input = pageInput.parse(raw);
  const args: any[] = [input.query];
  const where = [
    `($1='' OR po.number ILIKE '%'||$1||'%' OR s.name ILIKE '%'||$1||'%' OR s.code ILIKE '%'||$1||'%')`,
  ];
  const total = Number(
    (
      await one(
        db,
        `SELECT count(*) n FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE ${where.join(" AND ")}`,
        args,
      )
    )?.n ?? 0,
  );
  args.push(input.pageSize, (input.page - 1) * input.pageSize);
  const items = (
    await db.query(
      `SELECT po.*,s.name supplier_name,w.code warehouse_code FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id JOIN warehouses w ON w.id=po.warehouse_id WHERE ${where.join(" AND ")} ORDER BY po.created_at DESC LIMIT $2 OFFSET $3`,
      args,
    )
  ).rows;
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function createPurchaseOrder(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "PURCHASE_MANAGE");
  const data = purchaseOrderInput.parse(raw),
    rate = d(data.exchangeRate);
  assert(
    rate.isFinite() && rate.gt(0) && rate.decimalPlaces() <= 8,
    400,
    "Enter a valid exchange rate",
  );
  return db.transaction(async (tx) => {
    assert(
      await one(tx, "SELECT id FROM suppliers WHERE id=$1 AND active", [
        data.supplierId,
      ]),
      400,
      "Choose an active supplier",
    );
    assert(
      await one(tx, "SELECT id FROM warehouses WHERE id=$1 AND active", [
        data.warehouseId,
      ]),
      400,
      "Choose an active warehouse",
    );
    const ids = [...new Set(data.lines.map((x) => x.productId))];
    const products = (
      await tx.query(
        "SELECT id,part_number,description,unit FROM products WHERE id=ANY($1::uuid[]) AND active",
        [ids],
      )
    ).rows;
    assert(
      products.length === ids.length,
      400,
      "One or more purchase products are unavailable",
    );
    const map = new Map(products.map((p: any) => [p.id, p]));
    const lines = data.lines.map((line, index) => {
      const cost = d(line.unitCost);
      assert(
        cost.isFinite() && cost.gte(0) && cost.decimalPlaces() <= 6,
        400,
        `Invalid unit cost on line ${index + 1}`,
      );
      const p = map.get(line.productId)!;
      return {
        key: String(index + 1),
        productId: p.id,
        partNumber: p.part_number,
        description: p.description,
        unit: p.unit,
        quantity: line.quantity,
        unitCost: cost.toFixed(6),
        receivedQuantity: "0",
        lineTotal: cost.mul(line.quantity).toFixed(2),
      };
    });
    const subtotal = lines.reduce(
      (sum, line) => sum.add(line.lineTotal),
      new Decimal(0),
    );
    const id = randomUUID(),
      number = await documentNumber(tx, "PURCHASE_ORDER", "PO");
    await tx.query(
      `INSERT INTO purchase_orders(id,number,supplier_id,warehouse_id,status,currency,exchange_rate,lines,totals,created_by)
      VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9)`,
      [
        id,
        number,
        data.supplierId,
        data.warehouseId,
        data.currency.toUpperCase(),
        rate.toString(),
        json(lines),
        json({ subtotal: subtotal.toFixed(2), total: subtotal.toFixed(2) }),
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      "PURCHASE_ORDER_CREATE",
      "purchase_orders",
      id,
      null,
      { number, total: subtotal.toFixed(2) },
    );
    return one(tx, "SELECT * FROM purchase_orders WHERE id=$1", [id]);
  });
}

export async function approvePurchaseOrder(
  db: DB,
  actor: Actor,
  id: string,
  version: number,
) {
  requirePermission(actor, "PURCHASE_MANAGE");
  return db.transaction(async (tx) => {
    const po = await one(
      tx,
      "SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      po && ["DRAFT", "PENDING_APPROVAL"].includes(po.status),
      409,
      "Purchase Order cannot be approved",
    );
    assert(
      po.version === version,
      409,
      "Purchase Order changed. Reload and try again",
    );
    await tx.query(
      "UPDATE purchase_orders SET status='APPROVED',approved_by=$2,version=version+1,updated_at=now() WHERE id=$1",
      [id, actor.id],
    );
    await audit(tx, actor.id, "PURCHASE_ORDER_APPROVE", "purchase_orders", id);
    return one(tx, "SELECT * FROM purchase_orders WHERE id=$1", [id]);
  });
}

const receiptInput = z.object({
  lines: z.array(z.object({ key: z.string(), quantity })).min(1),
  supplierInvoiceReference: z.string().trim().max(100).default(""),
  landedCosts: z
    .array(
      z.object({
        kind: z.string().trim().min(1).max(60),
        amount: z.union([z.string(), z.number()]),
      }),
    )
    .max(30)
    .default([]),
  manualAllocations: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .optional(),
  idempotencyKey: z.string().uuid(),
});

export async function createGoodsReceipt(
  db: DB,
  actor: Actor,
  poId: string,
  raw: unknown,
) {
  requirePermission(actor, "PURCHASE_MANAGE");
  const data = receiptInput.parse(raw);
  return db.transaction(async (tx) => {
    const previous = await one(
      tx,
      "SELECT * FROM goods_receipts WHERE allocations->>'idempotencyKey'=$1",
      [data.idempotencyKey],
    );
    if (previous) return previous;
    const po = await one(
      tx,
      "SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE",
      [poId],
    );
    assert(
      po && ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status),
      409,
      "Purchase Order is not open for receiving",
    );
    const lines = data.lines.map((request, index) => {
      const line = po.lines.find((x: any) => x.key === request.key);
      assert(line, 400, `Purchase Order line ${request.key} not found`);
      const remaining = d(line.quantity).sub(d(line.receivedQuantity));
      const qty = d(request.quantity);
      assert(
        qty.lte(remaining),
        400,
        `Receipt exceeds remaining quantity for ${line.partNumber}`,
      );
      return {
        ...line,
        receiptQuantity: qty.toString(),
        baseValue: d(line.unitCost)
          .mul(qty)
          .mul(po.exchange_rate)
          .toDecimalPlaces(6)
          .toString(),
      };
    });
    const costs = data.landedCosts.map((x, index) => {
      const amount = d(x.amount);
      assert(
        amount.isFinite() && amount.gte(0) && amount.decimalPlaces() <= 6,
        400,
        `Invalid landed cost ${index + 1}`,
      );
      return { kind: x.kind, amount: amount.toString() };
    });
    const totalCost = costs.reduce((s, x) => s.add(x.amount), new Decimal(0));
    const totalValue = lines.reduce(
      (s, x) => s.add(x.baseValue),
      new Decimal(0),
    );
    const allocations: any[] = [];
    let allocated = new Decimal(0);
    lines.forEach((line, index) => {
      let amount: Decimal;
      if (data.manualAllocations) {
        amount = d(data.manualAllocations[line.key] ?? 0);
      } else
        amount =
          index === lines.length - 1
            ? totalCost.sub(allocated)
            : totalValue.isZero()
              ? totalCost.div(lines.length).toDecimalPlaces(6)
              : totalCost
                  .mul(d(line.baseValue))
                  .div(totalValue)
                  .toDecimalPlaces(6);
      allocated = allocated.add(amount);
      allocations.push({ lineKey: line.key, amount: amount.toString() });
    });
    assert(
      allocated.eq(totalCost),
      400,
      "Manual landed-cost allocations must equal the total landed costs",
    );
    const id = randomUUID(),
      number = await documentNumber(tx, "GOODS_RECEIPT", "GRN");
    await tx.query(
      `INSERT INTO goods_receipts(id,number,purchase_order_id,warehouse_id,status,supplier_invoice_reference,lines,landed_costs,allocations,created_by)
      VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9)`,
      [
        id,
        number,
        poId,
        po.warehouse_id,
        data.supplierInvoiceReference,
        json(lines),
        json(costs),
        json({ idempotencyKey: data.idempotencyKey, lines: allocations }),
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      "GOODS_RECEIPT_CREATE",
      "goods_receipts",
      id,
      null,
      { number, poId },
    );
    return one(tx, "SELECT * FROM goods_receipts WHERE id=$1", [id]);
  });
}

export async function postGoodsReceipt(
  db: DB,
  actor: Actor,
  id: string,
  version: number,
) {
  requirePermission(actor, "PURCHASE_MANAGE");
  return db.transaction(async (tx) => {
    const receipt = await one(
      tx,
      "SELECT * FROM goods_receipts WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      receipt && receipt.status === "DRAFT",
      409,
      "Goods Receipt is not a draft",
    );
    assert(
      receipt.version === version,
      409,
      "Goods Receipt changed. Reload and try again",
    );
    const po = await one(
      tx,
      "SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE",
      [receipt.purchase_order_id],
    );
    assert(
      po && ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status),
      409,
      "Purchase Order is no longer receivable",
    );
    const allocations = new Map(
      (receipt.allocations?.lines ?? []).map((x: any) => [
        x.lineKey,
        d(x.amount),
      ]),
    );
    const poLines = [...po.lines];
    for (const line of receipt.lines) {
      const qty = d(line.receiptQuantity),
        landed =
          (allocations.get(line.key) as Decimal | undefined) ?? new Decimal(0),
        unitCost = d(line.baseValue).add(landed).div(qty).toDecimalPlaces(6);
      const movementId = randomUUID();
      await tx.query(
        `INSERT INTO inventory_movements(id,product_id,warehouse_id,kind,quantity,unit_cost,reference_type,reference_id,idempotency_key,actor_id)
      VALUES($1,$2,$3,'RECEIPT',$4,$5,'GOODS_RECEIPT',$6,$7,$8)`,
        [
          movementId,
          line.productId,
          receipt.warehouse_id,
          qty.toString(),
          unitCost.toString(),
          id,
          `goods-receipt:${id}:${line.key}`,
          actor.id,
        ],
      );
      await tx.query(
        "INSERT INTO fifo_layers(id,product_id,warehouse_id,source_movement_id,received_quantity,remaining_quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$5,$6)",
        [
          randomUUID(),
          line.productId,
          receipt.warehouse_id,
          movementId,
          qty.toString(),
          unitCost.toString(),
        ],
      );
      const poLine = poLines.find((x: any) => x.key === line.key);
      poLine.receivedQuantity = d(poLine.receivedQuantity).add(qty).toString();
    }
    const complete = poLines.every((x: any) =>
      d(x.receivedQuantity).gte(d(x.quantity)),
    );
    await tx.query(
      "UPDATE purchase_orders SET lines=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1",
      [po.id, json(poLines), complete ? "RECEIVED" : "PARTIALLY_RECEIVED"],
    );
    await tx.query(
      "UPDATE goods_receipts SET status='POSTED',posted_by=$2,posted_at=now(),version=version+1 WHERE id=$1",
      [id, actor.id],
    );
    await audit(
      tx,
      actor.id,
      "GOODS_RECEIPT_POST",
      "goods_receipts",
      id,
      null,
      {
        purchaseOrderId: po.id,
        purchaseOrderStatus: complete ? "RECEIVED" : "PARTIALLY_RECEIVED",
      },
    );
    return one(tx, "SELECT * FROM goods_receipts WHERE id=$1", [id]);
  });
}

export async function transferStock(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "INVENTORY_MANAGE");
  const data = z
    .object({
      fromWarehouseId: z.string().uuid(),
      toWarehouseId: z.string().uuid(),
      lines: z
        .array(z.object({ productId: z.string().uuid(), quantity }))
        .min(1)
        .max(500),
      reason: z.string().trim().min(3).max(500),
      idempotencyKey: z.string().uuid(),
    })
    .parse(raw);
  assert(
    data.fromWarehouseId !== data.toWarehouseId,
    400,
    "Choose two different warehouses",
  );
  return db.transaction(async (tx) => {
    const prior = await one(
      tx,
      "SELECT * FROM inventory_transfers WHERE lines->>'idempotencyKey'=$1",
      [data.idempotencyKey],
    );
    if (prior) return prior;
    const warehouses = (
      await tx.query(
        "SELECT * FROM warehouses WHERE id=ANY($1::uuid[]) AND active ORDER BY id FOR UPDATE",
        [[data.fromWarehouseId, data.toWarehouseId]],
      )
    ).rows;
    assert(warehouses.length === 2, 400, "Both warehouses must be active");
    const source = warehouses.find((w: any) => w.id === data.fromWarehouseId)!;
    const id = randomUUID(),
      number = await documentNumber(tx, "INVENTORY_TRANSFER", "TR");
    const savedLines: any[] = [];
    for (const line of data.lines) {
      const available = await availableForUpdate(
          tx,
          data.fromWarehouseId,
          line.productId,
        ),
        qty = d(line.quantity);
      assert(
        source.allow_negative_stock || available.gte(qty),
        409,
        "Transfer exceeds available stock",
      );
      const outId = randomUUID(),
        inId = randomUUID();
      await tx.query(
        `INSERT INTO inventory_movements(id,product_id,warehouse_id,kind,quantity,reference_type,reference_id,idempotency_key,reason,actor_id) VALUES($1,$2,$3,'TRANSFER_OUT',$4,'INVENTORY_TRANSFER',$5,$6,$7,$8)`,
        [
          outId,
          line.productId,
          data.fromWarehouseId,
          qty.neg().toString(),
          id,
          `${data.idempotencyKey}:out:${line.productId}`,
          data.reason,
          actor.id,
        ],
      );
      const costs = await consumeFifo(
        tx,
        actor,
        data.fromWarehouseId,
        line.productId,
        outId,
        qty,
        source.allow_negative_stock,
      );
      const total = costs.reduce(
          (s, x) => s.add(d(x.quantity).mul(x.unitCost)),
          new Decimal(0),
        ),
        average = total.div(qty).toDecimalPlaces(6);
      await tx.query(
        `INSERT INTO inventory_movements(id,product_id,warehouse_id,kind,quantity,unit_cost,reference_type,reference_id,idempotency_key,reason,actor_id) VALUES($1,$2,$3,'TRANSFER_IN',$4,$5,'INVENTORY_TRANSFER',$6,$7,$8,$9)`,
        [
          inId,
          line.productId,
          data.toWarehouseId,
          qty.toString(),
          average.toString(),
          id,
          `${data.idempotencyKey}:in:${line.productId}`,
          data.reason,
          actor.id,
        ],
      );
      for (const cost of costs)
        await tx.query(
          "INSERT INTO fifo_layers(id,product_id,warehouse_id,source_movement_id,received_quantity,remaining_quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$5,$6)",
          [
            randomUUID(),
            line.productId,
            data.toWarehouseId,
            inId,
            cost.quantity,
            cost.unitCost,
          ],
        );
      savedLines.push({
        ...line,
        quantity: qty.toString(),
        unitCost: average.toString(),
      });
    }
    await tx.query(
      "INSERT INTO inventory_transfers(id,number,from_warehouse_id,to_warehouse_id,status,lines,reason,created_by,posted_by,posted_at) VALUES($1,$2,$3,$4,'POSTED',$5,$6,$7,$7,now())",
      [
        id,
        number,
        data.fromWarehouseId,
        data.toWarehouseId,
        json({ idempotencyKey: data.idempotencyKey, items: savedLines }),
        data.reason,
        actor.id,
      ],
    );
    await audit(
      tx,
      actor.id,
      "INVENTORY_TRANSFER_POST",
      "inventory_transfers",
      id,
      null,
      {
        number,
        from: data.fromWarehouseId,
        to: data.toWarehouseId,
        lines: savedLines.length,
      },
      data.reason,
    );
    return one(tx, "SELECT * FROM inventory_transfers WHERE id=$1", [id]);
  });
}

export async function createStockCount(
  db: DB,
  actor: Actor,
  warehouseId: string,
) {
  requirePermission(actor, "INVENTORY_MANAGE");
  return db.transaction(async (tx) => {
    assert(
      await one(
        tx,
        "SELECT id FROM warehouses WHERE id=$1 AND active FOR UPDATE",
        [warehouseId],
      ),
      400,
      "Warehouse not found or inactive",
    );
    assert(
      !(await one(
        tx,
        "SELECT id FROM stock_counts WHERE warehouse_id=$1 AND status IN ('OPEN','COUNTING','REVIEW')",
        [warehouseId],
      )),
      409,
      "This warehouse already has an active stock count",
    );
    const lines = (
      await tx.query(
        `SELECT p.id productId,p.part_number partNumber,p.description,COALESCE(sum(m.quantity),0)::text expectedQuantity,null::text countedQuantity FROM products p LEFT JOIN inventory_movements m ON m.product_id=p.id AND m.warehouse_id=$1 AND m.kind NOT IN ('RESERVE','RELEASE') WHERE p.active GROUP BY p.id,p.part_number,p.description ORDER BY p.part_number`,
        [warehouseId],
      )
    ).rows;
    const id = randomUUID(),
      number = await documentNumber(tx, "STOCK_COUNT", "SC");
    await tx.query(
      "INSERT INTO stock_counts(id,number,warehouse_id,status,lines,created_by) VALUES($1,$2,$3,'OPEN',$4,$5)",
      [id, number, warehouseId, json(lines), actor.id],
    );
    await audit(tx, actor.id, "STOCK_COUNT_CREATE", "stock_counts", id, null, {
      number,
      warehouseId,
      products: lines.length,
    });
    return one(tx, "SELECT * FROM stock_counts WHERE id=$1", [id]);
  });
}

export async function updateStockCount(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  requirePermission(actor, "INVENTORY_MANAGE");
  const data = z
    .object({
      version: z.number().int().positive(),
      counts: z
        .array(
          z.object({
            productId: z.string().uuid(),
            countedQuantity: z.union([z.string(), z.number()]),
          }),
        )
        .min(1),
      submitForReview: z.boolean().default(false),
    })
    .parse(raw);
  return db.transaction(async (tx) => {
    const count = await one(
      tx,
      "SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      count && ["OPEN", "COUNTING"].includes(count.status),
      409,
      "Stock count is not editable",
    );
    assert(
      count.version === data.version,
      409,
      "Stock count changed. Reload and try again",
    );
    const values = new Map(
      data.counts.map((x) => [x.productId, d(x.countedQuantity)]),
    );
    for (const value of values.values())
      assert(
        value.isFinite() && value.gte(0) && value.decimalPlaces() <= 6,
        400,
        "Counted quantities must be zero or positive",
      );
    const lines = count.lines.map((line: any) =>
      values.has(line.productid ?? line.productId)
        ? {
            ...line,
            countedQuantity: values
              .get(line.productid ?? line.productId)!
              .toString(),
          }
        : line,
    );
    const complete = lines.every((line: any) => line.countedQuantity !== null);
    assert(
      !data.submitForReview || complete,
      400,
      "Count every product before submitting for review",
    );
    const status = data.submitForReview ? "REVIEW" : "COUNTING";
    await tx.query(
      "UPDATE stock_counts SET lines=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1",
      [id, json(lines), status],
    );
    await audit(tx, actor.id, "STOCK_COUNT_UPDATE", "stock_counts", id, null, {
      status,
      updated: data.counts.length,
    });
    return one(tx, "SELECT * FROM stock_counts WHERE id=$1", [id]);
  });
}

export async function postStockCount(
  db: DB,
  actor: Actor,
  id: string,
  version: number,
) {
  requirePermission(actor, "INVENTORY_MANAGE");
  return db.transaction(async (tx) => {
    const count = await one(
      tx,
      "SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      count && count.status === "REVIEW",
      409,
      "Stock count must be reviewed before posting",
    );
    assert(
      count.version === version,
      409,
      "Stock count changed. Reload and try again",
    );
    const warehouse: any = await one(
      tx,
      "SELECT * FROM warehouses WHERE id=$1 FOR UPDATE",
      [count.warehouse_id],
    );
    for (const line of count.lines) {
      const productId = line.productid ?? line.productId,
        variance = d(line.countedQuantity).sub(
          d(line.expectedquantity ?? line.expectedQuantity),
        );
      if (variance.isZero()) continue;
      const movementId = randomUUID(),
        cost = String(
          (
            await one(
              tx,
              "SELECT cost::text cost FROM product_pricing WHERE product_id=$1",
              [productId],
            )
          )?.cost ?? "0",
        );
      await tx.query(
        `INSERT INTO inventory_movements(id,product_id,warehouse_id,kind,quantity,unit_cost,reference_type,reference_id,idempotency_key,reason,actor_id) VALUES($1,$2,$3,'ADJUSTMENT',$4,$5,'STOCK_COUNT',$6,$7,'Posted stock-count variance',$8)`,
        [
          movementId,
          productId,
          count.warehouse_id,
          variance.toString(),
          cost,
          id,
          `stock-count:${id}:${productId}`,
          actor.id,
        ],
      );
      if (variance.gt(0))
        await tx.query(
          "INSERT INTO fifo_layers(id,product_id,warehouse_id,source_movement_id,received_quantity,remaining_quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$5,$6)",
          [
            randomUUID(),
            productId,
            count.warehouse_id,
            movementId,
            variance.toString(),
            cost,
          ],
        );
      else
        await consumeFifo(
          tx,
          actor,
          count.warehouse_id,
          productId,
          movementId,
          variance.abs(),
          warehouse.allow_negative_stock,
        );
    }
    await tx.query(
      "UPDATE stock_counts SET status='POSTED',posted_by=$2,posted_at=now(),version=version+1,updated_at=now() WHERE id=$1",
      [id, actor.id],
    );
    await audit(tx, actor.id, "STOCK_COUNT_POST", "stock_counts", id);
    return one(tx, "SELECT * FROM stock_counts WHERE id=$1", [id]);
  });
}

export async function getSalesOrder(db: DB, actor: Actor, id: string) {
  requirePermission(actor, "COMMERCIAL_VIEW");
  const order = await one(
    db,
    `SELECT so.*,w.code warehouse_code,w.name warehouse_name,q.number quotation_number FROM sales_orders so LEFT JOIN warehouses w ON w.id=so.warehouse_id LEFT JOIN quotations q ON q.id=so.quotation_id WHERE so.id=$1`,
    [id],
  );
  assert(order, 404, "Sales Order not found");
  const documents = (
    await db.query(
      "SELECT id,kind,number,status,created_at,issued_at FROM commercial_documents WHERE sales_order_id=$1 ORDER BY created_at",
      [id],
    )
  ).rows;
  return { ...order, documents };
}

export async function issueProforma(
  db: DB,
  actor: Actor,
  orderId: string,
  raw: unknown,
) {
  requirePermission(actor, "SALES_ORDER_MANAGE");
  const data = z.object({ idempotencyKey: z.string().uuid() }).parse(raw);
  return db.transaction(async (tx) => {
    const existing = await one(
      tx,
      "SELECT * FROM commercial_documents WHERE kind='PROFORMA' AND snapshot->>'idempotencyKey'=$1",
      [data.idempotencyKey],
    );
    if (existing) return existing;
    const order = await one(
      tx,
      "SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE",
      [orderId],
    );
    assert(
      order && !["CANCELLED", "CLOSED"].includes(order.status),
      409,
      "Sales Order cannot produce a Proforma Invoice",
    );
    const id = randomUUID(),
      number = await documentNumber(tx, "PROFORMA", "PI");
    const snapshot = {
      idempotencyKey: data.idempotencyKey,
      orderNumber: order.number,
      customer: order.customer,
      lines: order.lines,
      totals: order.totals,
    };
    await tx.query(
      "INSERT INTO commercial_documents(id,kind,number,sales_order_id,status,snapshot,created_by,issued_at) VALUES($1,'PROFORMA',$2,$3,'ISSUED',$4,$5,now())",
      [id, number, orderId, json(snapshot), actor.id],
    );
    await audit(
      tx,
      actor.id,
      "PROFORMA_ISSUE",
      "commercial_documents",
      id,
      null,
      { number, orderId },
    );
    return one(tx, "SELECT * FROM commercial_documents WHERE id=$1", [id]);
  });
}

export async function listGoodsReceipts(db: DB, actor: Actor, poId: string) {
  requirePermission(actor, "PURCHASE_MANAGE");
  return (
    await db.query(
      "SELECT * FROM goods_receipts WHERE purchase_order_id=$1 ORDER BY created_at DESC",
      [poId],
    )
  ).rows;
}

export async function listOnlineOrders(db: DB, actor: Actor, raw: unknown) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  const input = pageInput.parse(raw),
    args: any[] = [input.query];
  const where = `($1='' OR number ILIKE '%'||$1||'%' OR guest_contact->>'name' ILIKE '%'||$1||'%' OR guest_contact->>'mobile' ILIKE '%'||$1||'%')`;
  const total = Number(
    (
      await one(
        db,
        `SELECT count(*) n FROM ecommerce_orders WHERE ${where}`,
        args,
      )
    )?.n ?? 0,
  );
  args.push(input.pageSize, (input.page - 1) * input.pageSize);
  const items = (
    await db.query(
      `SELECT o.*,COALESCE(o.guest_contact,(SELECT jsonb_build_object('name',c.name,'mobile',a.mobile,'email',a.email,'number',c.number) FROM customer_accounts a LEFT JOIN customers c ON c.id=a.customer_id WHERE a.id=o.customer_account_id)) guest_contact FROM ecommerce_orders o WHERE ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      args,
    )
  ).rows;
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function approveOnlineOrder(
  db: DB,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  requirePermission(actor, "STOREFRONT_MANAGE");
  requirePermission(actor, "SALES_ORDER_MANAGE");
  const data = z.object({ warehouseId: z.string().uuid() }).parse(raw);
  const order = await db.transaction(async (tx) => {
    const web = await one(
      tx,
      "SELECT * FROM ecommerce_orders WHERE id=$1 FOR UPDATE",
      [id],
    );
    assert(
      web &&
        ["PENDING_REVIEW", "CONFIRMED"].includes(web.status) &&
        !web.sales_order_id,
      409,
      "Online order was already processed or cancelled",
    );
    assert(
      await one(
        tx,
        "SELECT id FROM warehouses WHERE id=$1 AND active FOR UPDATE",
        [data.warehouseId],
      ),
      400,
      "Choose an active warehouse",
    );
    const salesId = randomUUID(),
      number = await documentNumber(tx, "SALES_ORDER", "SO");
    const lines = web.lines.map((line: any, index: number) => ({
      key: String(index + 1),
      source: "CATALOG",
      productId: line.productId,
      partNumber: line.partNumber,
      description: line.description,
      unit: line.unit,
      quantity: String(line.quantity),
      reservedQuantity: "0",
      deliveredQuantity: "0",
      price: {
        quantity: line.quantity,
        finalExcl: line.unitExcl,
        subtotal: line.lineExcl,
        vat: line.vat,
        total: line.lineTotal,
      },
    }));
    await tx.query(
      "INSERT INTO sales_orders(id,number,customer,status,lines,totals,warehouse_id,source,created_by) VALUES($1,$2,$3,'CONFIRMED',$4,$5,$6,'ECOMMERCE',$7)",
      [
        salesId,
        number,
        json(web.guest_contact ?? (await one(tx,"SELECT c.id,c.name,c.number,a.email,a.mobile FROM customer_accounts a LEFT JOIN customers c ON c.id=a.customer_id WHERE a.id=$1",[web.customer_account_id])) ?? {}),
        json(lines),
        json(web.totals),
        data.warehouseId,
        actor.id,
      ],
    );
    await tx.query(
      "UPDATE ecommerce_orders SET status='CONFIRMED',warehouse_id=$2,sales_order_id=$3,updated_at=now() WHERE id=$1",
      [id, data.warehouseId, salesId],
    );
    await audit(
      tx,
      actor.id,
      "ECOMMERCE_ORDER_APPROVE",
      "ecommerce_orders",
      id,
      null,
      { salesOrderId: salesId, warehouseId: data.warehouseId },
    );
    return one(tx, "SELECT * FROM sales_orders WHERE id=$1", [salesId]);
  });
  assert(order, 500, "Unable to create Sales Order");
  return reserveSalesOrder(db, actor, order.id);
}
