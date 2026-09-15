import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, PERMISSIONS } from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
import { saveWarehouse, stockAdjustment } from "../backend/commercial/service";
import * as store from "../backend/storefront/service";
import * as commerce from "../backend/storefront/commerce";
import * as operations from "../backend/storefront/operations";

test("storefront admin: orders lifecycle, customer contact resolution and unified products management", async (t) => {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.SETUP_TOKEN = "orders-lifecycle-token-9876543210";
  process.env.APP_ORIGIN = "http://localhost:18180";
  const db = await embedded();
  t.after(() => db.close?.());
  await migrate(db);

  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "orderadmin",
    password: "OrderPass123456!",
    name: "Store Admin",
    companyName: "AMT",
  });

  const user = await one(
    db,
    "SELECT * FROM users WHERE username='orderadmin'",
  );
  const actor: any = {
    id: user!.id,
    permissions: [...PERMISSIONS],
    role: "ADMIN",
    name: "Store Admin",
    username: "orderadmin",
    maxDiscount: (await one(
      db,
      "SELECT max_discount::text n FROM roles WHERE id='ADMIN'",
    ))!.n,
    csrf: "",
  };

  await db.query("UPDATE storefront_settings SET enabled=true, data=data||'{\"operationsEnabled\":true}'::jsonb WHERE id=1");

  const wh = await saveWarehouse(db, actor, undefined, {
    code: "WH-RIYADH",
    name: "Riyadh Main Distribution Center",
    active: true,
  });

  const product = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "LC1D12M7",
      description: "TeSys D contactor 3P 12A AC-3 220V",
      brand: "Schneider Electric",
      category: "Contactors",
      method: "COST_MARKUP",
      cost: "100.00",
      markup: "25.00",
      unit: "PCS",
      quantityPrecision: 0,
    }),
  );

  await stockAdjustment(db, actor, {
    warehouseId: wh.id,
    productId: product.id,
    quantity: "50",
    reason: "Initial inventory receiving",
    idempotencyKey: randomUUID(),
  });

  // 1. Test Customer Contact Resolution in Orders Query
  await t.test("orders query resolves customer accounts and contact details", async () => {
    // Create a customer and customer account (registered storefront buyer)
    const custId = randomUUID();
    await db.query(
      "INSERT INTO customers(id, number, name, mobile) VALUES($1, 'CUST-0099', 'Mohammed Al-Otaibi', '0551234567')",
      [custId],
    );

    const accountId = randomUUID();
    await db.query(
      "INSERT INTO customer_accounts(id, customer_id, email, mobile, status) VALUES($1, $2, 'otaibi@example.com', '0551234567', 'ACTIVE')",
      [accountId, custId],
    );

    const orderId = randomUUID();
    const orderNumber = "WEB-20260915-OTAIBI1";

    // Insert order placed by registered customer (guest_contact is NULL, like real checkout)
    await db.query(
      `INSERT INTO ecommerce_orders(
        id, number, customer_account_id, guest_contact, status, fulfillment_method, warehouse_id, address, lines, totals, payment_method, idempotency_key
      ) VALUES($1, $2, $3, NULL, 'PENDING_REVIEW', 'DELIVERY', $4, $5, $6, $7, 'BANK_TRANSFER', $8)`,
      [
        orderId,
        orderNumber,
        accountId,
        wh.id,
        JSON.stringify({ city: "Riyadh", district: "Al-Olaya", street: "King Fahd Road" }),
        JSON.stringify([{ productId: product.id, partNumber: "LC1D12M7", description: "Contactor", quantity: "2", lineTotal: "287.50" }]),
        JSON.stringify({ subtotal: "250.00", vat: "37.50", delivery: "0.00", total: "287.50" }),
        randomUUID(),
      ],
    );

    const dashboard = await commerce.dashboard(db, actor);
    const foundOrder = dashboard.orders.find((o: any) => o.id === orderId);
    assert.ok(foundOrder, "Order should be present in commerce dashboard");
    assert.equal(foundOrder.customer_name, "Mohammed Al-Otaibi");
    assert.equal(foundOrder.account_email, "otaibi@example.com");
    assert.equal(foundOrder.account_mobile, "0551234567");
    assert.equal(foundOrder.customer_number, "CUST-0099");
    assert.equal(foundOrder.warehouse_name, "Riyadh Main Distribution Center");
  });

  // 2. Test Order Lifecycle: CONFIRM -> PROCESSING -> TRACKING -> DELIVER
  await t.test("order lifecycle transitions: CONFIRM, PROCESSING, TRACKING, and DELIVER", async () => {
    const orderId = randomUUID();
    const orderNumber = "WEB-20260915-LIFECYCLE";

    await db.query(
      `INSERT INTO ecommerce_orders(
        id, number, status, fulfillment_method, warehouse_id, address, lines, totals, payment_method, idempotency_key
      ) VALUES($1, $2, 'PENDING_REVIEW', 'DELIVERY', $3, $4, $5, $6, 'MOYASAR', $7)`,
      [
        orderId,
        orderNumber,
        wh.id,
        JSON.stringify({ city: "Jeddah", district: "Al-Safa", street: "Prince Majed St" }),
        JSON.stringify([{ productId: product.id, partNumber: "LC1D12M7", quantity: "1", lineTotal: "143.75" }]),
        JSON.stringify({ subtotal: "125.00", vat: "18.75", delivery: "0.00", total: "143.75" }),
        randomUUID(),
      ],
    );

    // Step 1: CONFIRM
    let currentOrder = await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [orderId]);
    assert.ok(currentOrder);
    await operations.orderAction(db, actor, orderId, {
      action: "CONFIRM",
      version: currentOrder.version,
      idempotencyKey: randomUUID(),
    });

    currentOrder = await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [orderId]);
    assert.ok(currentOrder);
    assert.equal(currentOrder.status, "CONFIRMED");
    assert.equal(currentOrder.fulfillment_data?.fulfillmentStatus, "CONFIRMED");
    assert.ok(currentOrder.fulfillment_data?.confirmedAt);

    // Step 2: PROCESSING (Warehouse preparation)
    await operations.orderAction(db, actor, orderId, {
      action: "PROCESSING",
      version: currentOrder.version,
      idempotencyKey: randomUUID(),
    });

    currentOrder = await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [orderId]);
    assert.ok(currentOrder);
    assert.equal(currentOrder.fulfillment_data?.fulfillmentStatus, "PROCESSING");
    assert.ok(currentOrder.fulfillment_data?.processingAt);

    // Step 3: TRACKING (Shipment dispatch with Carrier and Tracking #)
    await operations.orderAction(db, actor, orderId, {
      action: "TRACKING",
      carrier: "SMSA Express",
      tracking: "2901837465",
      version: currentOrder.version,
      idempotencyKey: randomUUID(),
    });

    currentOrder = await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [orderId]);
    assert.ok(currentOrder);
    assert.equal(currentOrder.fulfillment_data?.carrier, "SMSA Express");
    assert.equal(currentOrder.fulfillment_data?.tracking, "2901837465");
    assert.equal(currentOrder.fulfillment_data?.fulfillmentStatus, "SHIPPED");
    assert.ok(currentOrder.fulfillment_data?.shippedAt);

    // Step 4: DELIVER
    await operations.orderAction(db, actor, orderId, {
      action: "DELIVER",
      version: currentOrder.version,
      idempotencyKey: randomUUID(),
    });

    currentOrder = await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [orderId]);
    assert.ok(currentOrder);
    assert.equal(currentOrder.fulfillment_data?.fulfillmentStatus, "DELIVERED");
    assert.ok(currentOrder.fulfillment_data?.deliveredAt);
  });

  // 3. Test Unified Products Management: Quick Price update and Enriched Management Query
  await t.test("quick price update and enriched products management query", async () => {
    // Test quick price update
    await store.quickUpdatePricing(db, actor, product.id, {
      cost: "110.00",
      markup: "30.00",
      method: "COST_MARKUP",
      defaultLevel: "RETAIL",
    });

    const m = await store.management(db, actor, "LC1D12M7");
    assert.ok(m.products.length > 0, "Product should be found in management");
    const p = m.products[0];

    assert.equal(p.part_number, "LC1D12M7");
    assert.equal(p.brand_name, "Schneider Electric");
    assert.equal(p.category_name, "Contactors");
    assert.equal(Number(p.cost), 110);
    assert.equal(Number(p.markup), 30);
    // Available stock should equal the 50 adjusted earlier
    assert.equal(Number(p.available), 50);
    assert.ok(Array.isArray(p.levels));
  });
});
