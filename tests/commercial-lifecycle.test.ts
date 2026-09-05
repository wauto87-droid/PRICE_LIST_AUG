import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import * as lifecycle from "../backend/quotations/lifecycle";
import * as quotations from "../backend/quotations/service";
import * as commercial from "../backend/commercial/service";
import * as storefront from "../backend/storefront/service";

test("quotation approval, issue, customer view and acceptance form one guarded lifecycle", async () => {
  const db = await embedded();
  await migrate(db);
  const userId = randomUUID();
  const permissions = [
    "PRODUCT_VIEW",
    "QUOTE_CREATE",
    "QUOTE_EDIT",
    "QUOTE_ISSUE",
    "QUOTE_APPROVE",
    "COMMERCIAL_VIEW",
    "SALES_ORDER_MANAGE",
    "INVENTORY_VIEW",
    "INVENTORY_MANAGE",
    "PURCHASE_MANAGE",
  ];
  await db.query(
    "INSERT INTO roles(id,permissions,max_discount) VALUES('TEST_MANAGER',$1,100)",
    [permissions],
  );
  await db.query(
    "INSERT INTO users(id,username,name,password_hash,role_id) VALUES($1,'manager','Manager','unused','TEST_MANAGER')",
    [userId],
  );
  const actor: any = {
    id: userId,
    username: "manager",
    name: "Manager",
    role: "TEST_MANAGER",
    permissions,
    maxDiscount: (await one(
      db,
      "SELECT max_discount::text value FROM roles WHERE id='TEST_MANAGER'",
    ))!.value,
    csrf: "test",
  };
  const settings = (await one(db, "SELECT data FROM settings WHERE id=1"))!
    .data;
  const draft = await quotations.saveDraft(
    db,
    actor,
    {
      customer: {
        name: "Customer A",
        number: "C-001",
        mobile: "",
        reference: "",
        notes: "",
      },
      lines: [
        {
          type: "CUSTOM",
          partNumber: "SPECIAL-1",
          description: "Special item",
          unit: "pcs",
          quantity: "1",
          unitPriceExcl: "100",
          discount: "0",
          vat: "15",
        },
      ],
    },
    settings,
  );
  await lifecycle.saveRule(db, actor, undefined, {
    name: "All quotations",
    active: true,
    priority: 1,
    tier: 1,
    approverRole: "TEST_MANAGER",
    approverUserId: null,
    allowSelfApproval: true,
    conditions: {
      roleIds: [],
      minimumDiscount: "0",
      minimumTotal: "0",
      brandIds: [],
      categoryIds: [],
    },
  });
  const submitted = await lifecycle.submitForApproval(
    db,
    actor,
    draft.id,
    settings,
  );
  assert.equal(submitted.status, "PENDING_APPROVAL");
  const queue = await lifecycle.approvalQueue(db, actor);
  assert.equal(queue.length, 1);
  const decided = await lifecycle.decide(
    db,
    actor,
    queue[0].id,
    "APPROVED",
    "Approved for test",
  );
  assert.equal(decided.status, "APPROVED");
  const review = await quotations.reviewIssue(db, actor, draft.id, settings);
  const issued = await quotations.issue(
    db,
    actor,
    draft.id,
    review.token,
    settings,
  );
  assert.equal(issued.status, "ISSUED");
  const access = await lifecycle.createCustomerLink(db, actor, draft.id, 7);
  const viewed = await lifecycle.customerView(db, access.token);
  assert.equal(viewed.number, issued.number);
  const accepted = await lifecycle.customerRespond(db, access.token, {
    decision: "ACCEPTED",
    note: "Proceed",
  });
  assert.equal(accepted.status, "ACCEPTED");
  await assert.rejects(
    () =>
      lifecycle.customerRespond(db, access.token, {
        decision: "DECLINED",
        note: "Changed",
      }),
    /already recorded/,
  );
  assert.equal(
    (await one(db, "SELECT status FROM quotations WHERE id=$1", [draft.id]))!
      .status,
    "ACCEPTED",
  );
  const productId = randomUUID();
  await db.query(
    "INSERT INTO products(id,part_number,normalized_part,description,quantity_precision,created_by,updated_by) VALUES($1,'STOCK-1','STOCK-1','Stock item',0,$2,$2)",
    [productId, userId],
  );
  await db.query(
    "INSERT INTO product_selling_levels(product_id,code,method,markup) VALUES($1,'END_CUSTOMER','COST_MARKUP',25)",
    [productId],
  );
  await db.query(
    "INSERT INTO product_pricing(product_id,method,cost,markup,list_price,base_discount,master_excl,vat,minimum_enabled,minimum) VALUES($1,'COST_MARKUP',40,25,0,0,50,15,false,0)",
    [productId],
  );
  await db.query("UPDATE quotations SET lines=$2 WHERE id=$1", [
    draft.id,
    JSON.stringify([
      {
        source: "CATALOG",
        productId,
        partNumber: "STOCK-1",
        description: "Stock item",
        unit: "pcs",
        input: { quantity: "3" },
        price: { quantity: "3", finalExcl: "50" },
      },
    ]),
  ]);
  const warehouse = await commercial.saveWarehouse(db, actor, undefined, {
    code: "MAIN",
    name: "Main Warehouse",
    nameAr: "",
    address: {},
    active: true,
    allowNegativeStock: false,
    pickupEnabled: true,
  });
  await commercial.stockAdjustment(db, actor, {
    warehouseId: warehouse.id,
    productId,
    quantity: "5",
    unitCost: "40",
    reason: "Opening balance",
    idempotencyKey: randomUUID(),
  });
  const order = await commercial.convertAcceptedQuotation(db, actor, draft.id, {
    warehouseId: warehouse.id,
    idempotencyKey: randomUUID(),
  });
  assert.ok(order);
  const reserved = await commercial.reserveSalesOrder(db, actor, order.id);
  assert.ok(reserved);
  assert.equal(reserved.status, "RESERVED");
  const delivery = await commercial.deliverSalesOrder(db, actor, order.id, {
    lines: [{ key: "1", quantity: "2" }],
    idempotencyKey: randomUUID(),
  });
  assert.ok(delivery);
  assert.equal(delivery.kind, "DELIVERY_NOTE");
  const balances = await commercial.stockBalances(db, actor, {
    query: "STOCK-1",
    page: 1,
    pageSize: 20,
    active: "ALL",
  });
  assert.equal(balances.items[0].on_hand, "3.000000");
  assert.equal(balances.items[0].reserved, "1.000000");
  assert.equal(balances.items[0].available, "2.000000");
  const supplier = await commercial.saveSupplier(db, actor, undefined, {
    code: "SUP-1",
    name: "Supplier One",
    taxNumber: "",
    contacts: [],
    paymentTerms: "Net 30",
    currency: "SAR",
    leadTimeDays: 7,
    active: true,
  });
  const po = await commercial.createPurchaseOrder(db, actor, {
    supplierId: supplier.id,
    warehouseId: warehouse.id,
    currency: "SAR",
    exchangeRate: "1",
    lines: [{ productId, quantity: "4", unitCost: "42" }],
  });
  assert.ok(po);
  const approvedPo = await commercial.approvePurchaseOrder(
    db,
    actor,
    po.id,
    po.version,
  );
  assert.ok(approvedPo);
  const receipt = await commercial.createGoodsReceipt(db, actor, po.id, {
    lines: [{ key: "1", quantity: "4" }],
    supplierInvoiceReference: "INV-1",
    landedCosts: [{ kind: "Freight", amount: "8" }],
    idempotencyKey: randomUUID(),
  });
  assert.ok(receipt);
  const posted = await commercial.postGoodsReceipt(
    db,
    actor,
    receipt.id,
    receipt.version,
  );
  assert.ok(posted);
  assert.equal(posted.status, "POSTED");
  const afterReceipt = await commercial.stockBalances(db, actor, {
    query: "STOCK-1",
    page: 1,
    pageSize: 20,
    active: "ALL",
  });
  assert.equal(afterReceipt.items[0].on_hand, "7.000000");
  const newestLayer = await one(
    db,
    "SELECT unit_cost::text unit_cost FROM fifo_layers WHERE source_movement_id IN (SELECT id FROM inventory_movements WHERE reference_id=$1) ORDER BY created_at DESC LIMIT 1",
    [receipt.id],
  );
  assert.equal(newestLayer!.unit_cost, "44.000000");
  await db.query(
    "UPDATE products SET storefront_published=true,storefront_slug='stock-1' WHERE id=$1",
    [productId],
  );
  await db.query("UPDATE storefront_settings SET enabled=true WHERE id=1");
  const onlineCatalog = await storefront.catalog(db, {
    q: "STOCK-1",
    page: 1,
    pageSize: 24,
  });
  assert.equal(onlineCatalog.items[0].priceIncl, "57.50");
  const otp = await storefront.requestOtp(db, {
    destination: "0500000000",
    channel: "SMS",
  });
  assert.ok(otp.testCode);
  const verification = await storefront.verifyOtp(db, {
    id: otp.id,
    code: otp.testCode!,
  });
  const webOrder = await storefront.checkout(db, {
    verificationId: otp.id,
    verificationToken: verification.verificationToken,
    contact: { name: "Web Customer", mobile: "0500000000" },
    lines: [{ productId, quantity: "2" }],
    fulfillmentMethod: "PICKUP",
    warehouseId: warehouse.id,
    paymentMethod: "BANK_TRANSFER",
    idempotencyKey: randomUUID(),
  });
  assert.equal(webOrder.status, "PENDING_REVIEW");
  await db.close?.();
});
