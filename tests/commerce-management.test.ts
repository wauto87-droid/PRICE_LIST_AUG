import * as quotations from "../backend/quotations/service";
import * as lifecycle from "../backend/quotations/lifecycle";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, PERMISSIONS } from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
import {
  saveWarehouse,
  stockAdjustment,
  approveOnlineOrder,
  stockBalances,
  deliverSalesOrder,
} from "../backend/commercial/service";
import * as store from "../backend/storefront/service";
import * as commerce from "../backend/storefront/commerce";
import * as requirements from "../backend/storefront/requirements";
import * as operations from "../backend/storefront/operations";
import { handle } from "../backend/api/router";

test("commerce management: company isolation, shared prices, stock holds and operations", async (t) => {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.SETUP_TOKEN = "commerce-test-setup-token-123456789012345";
  process.env.APP_ORIGIN = "http://localhost:18180";
  const db = await embedded();
  t.after(() => db.close?.());
  await migrate(db);
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "commerceadmin",
    password: "Commerce123456!",
    name: "Commerce admin",
    companyName: "AMT",
  });
  const user = await one(
    db,
    "SELECT * FROM users WHERE username='commerceadmin'",
  );
  const actor: any = {
    id: user!.id,
    permissions: [...PERMISSIONS],
    role: "ADMIN",
    name: "Admin",
    username: "commerceadmin",
    maxDiscount: (await one(
      db,
      "SELECT max_discount::text n FROM roles WHERE id='ADMIN'",
    ))!.n,
    csrf: "",
  };
  const p = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "COM-100",
      description: "Commerce switch",
      brand: "AMT",
      category: "Switches",
      method: "COST_MARKUP",
      cost: "100",
      markup: "0",
      unit: "pcs",
      quantityPrecision: 0,
    }),
  );
  const p2 = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "COM-200",
      description: "Commerce cable",
      brand: "AMT",
      category: "Cables",
      method: "COST_MARKUP",
      cost: "200",
      markup: "0",
      unit: "pcs",
      quantityPrecision: 0,
    }),
  );
  const w = await saveWarehouse(db, actor, undefined, {
    code: "SHOP",
    name: "Shop",
    pickupEnabled: true,
  });
  await stockAdjustment(db, actor, {
    warehouseId: w.id,
    productId: p.id,
    quantity: "10",
    unitCost: "100",
    reason: "Opening inventory",
    idempotencyKey: randomUUID(),
  });
  await store.saveConfiguration(db, actor, {
    version: 1,
    enabled: true,
    companyName: "AMT",
    businessEnabled: true,
    operationsEnabled: true,
  });
  for (const x of [p, p2])
    await store.publishProduct(db, actor, x.id, {
      published: true,
      version: x.version,
    });
  async function account(email: string) {
    const otp = await store.requestOtp(db, {
      destination: email,
      channel: "EMAIL",
    });
    const verification = await store.verifyOtp(db, {
      id: otp.id,
      code: otp.testCode,
    });
    const a = await store.registerAccount(db, {
      name: email,
      email,
      mobile:
        "+9665" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"),
      password: "Buyer123456!",
      verificationId: otp.id,
      verificationToken: verification.verificationToken,
    });
    await store.updateAccount(db, actor, a.id, {
      status: "ACTIVE",
      creditEnabled: true,
      creditLimit: "1000",
    });
    return (await one(db, "SELECT * FROM customer_accounts WHERE id=$1", [
      a.id,
    ]))!;
  }
  const owner = await account("owner@example.com"),
    other = await account("other@example.com");
  const buyerId = randomUUID();
  await db.query(
    "INSERT INTO customer_accounts(id,email,status,company_id,company_role) VALUES($1,'buyer@example.com','ACTIVE',$2,'BUYER')",
    [buyerId, owner.company_id],
  );
  const buyer = (await one(db, "SELECT * FROM customer_accounts WHERE id=$1", [
    buyerId,
  ]))!;
  await t.test(
    "public prices never use an internal level; unpriced products remain requestable",
    async () => {
      await db.query(
        "UPDATE product_selling_levels SET active=false WHERE product_id=$1 AND code IN ('RETAIL','END_CUSTOMER')",
        [p2.id],
      );
      const detail = await store.productDetail(db, p2.id);
      assert.equal(detail.priceIncl, null);
      assert.equal(detail.purchasable, false);
      assert.equal((await store.catalog(db, {})).total, 2);
      await assert.rejects(
        store.preview(
          db,
          {
            lines: [{ productId: p2.id, quantity: "1" }],
            fulfillmentMethod: "PICKUP",
            warehouseId: w.id,
          },
          owner,
        ),
        /quotation/,
      );
    },
  );
  await t.test(
    "company overrides, tiers and sorted catalog use the same prices",
    async () => {
      await commerce.savePrice(db, actor, {
        companyId: owner.company_id,
        productId: p.id,
        minQuantity: "1",
        price: "80",
      });
      await commerce.savePrice(db, actor, {
        companyId: owner.company_id,
        productId: p.id,
        minQuantity: "5",
        price: "70",
      });
      assert.equal(
        (await commerce.resolvePrice(db, p.id, "5", buyer)).price,
        "70.00",
      );
      assert.equal(
        (await store.productDetail(db, p.id, buyer)).priceExcl,
        "80.00",
      );
      assert.equal(
        (await store.productDetail(db, p.id, other)).priceExcl,
        "100.00",
      );
      const quoted = await store.preview(
        db,
        {
          lines: [{ productId: p.id, quantity: "5" }],
          fulfillmentMethod: "PICKUP",
          warehouseId: w.id,
        },
        buyer,
      );
      assert.equal(quoted.lines[0].unitExcl, "70.00");
    },
  );
  let request: any;
  await t.test(
    "private requirements and attachments are isolated by company and buyer",
    async () => {
      request = await requirements.submit(db, buyer, {
        lines: [{ productId: p.id, description: "Switch", quantity: "2" }],
        notes: "Please offer best price",
      });
      await assert.rejects(
        requirements.ownedRequest(db, other, request.id),
        /not found/,
      );
      await requirements.ownedRequest(db, owner, request.id);
      await assert.rejects(
        commerce.invite(db, buyer, { email: "invite@example.com" }),
        /owner/,
      );
      const file = await requirements.upload(
        db,
        buyer,
        request.id,
        "materials.pdf",
        Buffer.from("%PDF-1.4\nmaterials"),
      );
      await assert.rejects(
        requirements.attachment(db, file.id, other),
        /not found/,
      );
      assert.equal(
        (await requirements.attachment(db, file.id, owner)).name,
        "materials.pdf",
      );
      await assert.rejects(
        requirements.upload(
          db,
          buyer,
          request.id,
          "fake.pdf",
          Buffer.from("not PDF"),
        ),
        /Invalid/,
      );
      const draft = await requirements.review(db, actor, request.id, {
        version: 1,
        action: "CREATE_DRAFT",
      });
      assert.ok(draft.quotationId);
    },
  );
  await t.test(
    "campaign scheduling, audience, permissions and version conflicts",
    async () => {
      const c = await commerce.saveCampaign(db, actor, {
        kind: "BANNER",
        title: "Offer",
        status: "PUBLISHED",
        audience: "BUSINESS",
        data: {},
      });
      assert.ok(
        (await commerce.activeCampaigns(db, owner)).some((x) => x.id === c!.id),
      );
      assert.ok(
        !(await commerce.activeCampaigns(db)).some((x) => x.id === c!.id),
      );
      await assert.rejects(
        commerce.saveCampaign(db, actor, {
          id: c!.id,
          version: 0,
          kind: "BANNER",
          title: "Stale",
          status: "DRAFT",
          data: {},
        }),
        /changed/,
      );
      await assert.rejects(
        commerce.saveCampaign(
          db,
          { ...actor, permissions: [] },
          { kind: "BANNER", title: "No", status: "DRAFT", data: {} },
        ),
      );
      await assert.rejects(
        commerce.saveCampaign(db, actor, {
          kind: "BANNER",
          title: "Unsafe",
          status: "DRAFT",
          data: { link: "javascript:alert(1)" },
        }),
      );
    },
  );
  const payload = {
    lines: [{ productId: p.id, quantity: "2" }],
    fulfillmentMethod: "PICKUP",
    warehouseId: w.id,
    paymentMethod: "CREDIT_TERMS",
    idempotencyKey: randomUUID(),
  };
  let order: any;
  await t.test(
    "checkout atomically reserves stock and shared credit; retry does not duplicate",
    async () => {
      order = await store.checkout(db, payload, buyer);
      assert.equal(
        (await store.checkout(db, payload, buyer)).orderId,
        order.orderId,
      );
      assert.equal((await operations.available(db, w.id, p.id)).toFixed(), "8");
      assert.equal(
        (await one(
          db,
          "SELECT count(*) n FROM commerce_credit_entries WHERE order_id=$1",
          [order.orderId],
        ))!.n,
        1,
      );
      const balance = await stockBalances(db, actor, {
        warehouseId: w.id,
        query: "COM-100",
      });
      assert.equal(balance.items[0].reserved, "2.000000");
      const big = {
        ...payload,
        lines: [{ productId: p.id, quantity: "20" }],
        idempotencyKey: randomUUID(),
        paymentMethod: "BANK_TRANSFER",
      };
      await assert.rejects(store.checkout(db, big, buyer), /unavailable/);
      assert.equal((await operations.available(db, w.id, p.id)).toFixed(), "8");
    },
  );
  await t.test(
    "unpaid cancellation releases stock and credit exactly once",
    async () => {
      const row = await one(db, "SELECT * FROM ecommerce_orders WHERE id=$1", [
        order.orderId,
      ]);
      await operations.orderAction(db, actor, order.orderId, {
        action: "CANCEL",
        version: row!.version,
        idempotencyKey: randomUUID(),
      });
      assert.equal(
        (await operations.available(db, w.id, p.id)).toFixed(),
        "10",
      );
      assert.equal(
        (await one(
          db,
          "SELECT sum(amount)::text n FROM commerce_credit_entries WHERE order_id=$1",
          [order.orderId],
        ))!.n,
        "0.00",
      );
    },
  );
  await t.test(
    "bank holds expire and late captured payment goes to review",
    async () => {
      const o = await store.checkout(
        db,
        {
          ...payload,
          paymentMethod: "BANK_TRANSFER",
          idempotencyKey: randomUUID(),
        },
        buyer,
      );
      await db.query(
        "UPDATE ecommerce_orders SET hold_expires_at=now()-interval '1 second' WHERE id=$1",
        [o.orderId],
      );
      await operations.expireHolds(db);
      assert.equal(
        (await one(db, "SELECT status FROM ecommerce_orders WHERE id=$1", [
          o.orderId,
        ]))!.status,
        "CANCELLED",
      );
      await db.transaction((tx) =>
        operations.settlePayment(tx, o.orderId, true),
      );
      assert.equal(
        (await one(db, "SELECT status FROM ecommerce_orders WHERE id=$1", [
          o.orderId,
        ]))!.status,
        "PENDING_REVIEW",
      );
      assert.equal(
        (await operations.available(db, w.id, p.id)).toFixed(),
        "10",
      );
    },
  );
  await t.test(
    "coupons do not stack with company pricing and usage limits are transactional",
    async () => {
      await commerce.saveCampaign(db, actor, {
        kind: "COUPON",
        title: "Ten off",
        status: "PUBLISHED",
        data: { code: "TEN", discount: "10", usageLimit: 1 },
      });
      await assert.rejects(
        store.preview(db, { ...payload, coupon: "TEN" }, buyer),
        /negotiated/,
      );
      const o = await store.checkout(
        db,
        {
          ...payload,
          paymentMethod: "BANK_TRANSFER",
          coupon: "TEN",
          idempotencyKey: randomUUID(),
        },
        other,
      );
      assert.equal(
        (await one(db, "SELECT lines FROM ecommerce_orders WHERE id=$1", [
          o.orderId,
        ]))!.lines[0].unitExcl,
        "90.00",
      );
      await assert.rejects(
        store.checkout(
          db,
          {
            ...payload,
            paymentMethod: "BANK_TRANSFER",
            coupon: "TEN",
            idempotencyKey: randomUUID(),
          },
          other,
        ),
        /usage limit/,
      );
    },
  );
  await t.test(
    "fulfillment converts holds without double reservation",
    async () => {
      const o = await store.checkout(
        db,
        { ...payload, idempotencyKey: randomUUID() },
        buyer,
      );
      const sales = await approveOnlineOrder(db, actor, o.orderId, {
        warehouseId: w.id,
      });
      assert.equal(sales!.status, "RESERVED");
      assert.equal(
        (await one(
          db,
          "SELECT count(*) n FROM commerce_holds WHERE order_id=$1 AND status='ACTIVE'",
          [o.orderId],
        ))!.n,
        0,
      );
      assert.equal(sales!.lines[0].reservedQuantity, "2");
    },
  );
  await t.test(
    "accepted quotes preserve company discount and VAT and cannot be purchased twice",
    async () => {
      const r = await one(db, "SELECT * FROM commerce_requests WHERE id=$1", [
        request.id,
      ]);
      const settings = (await one(db, "SELECT data FROM settings WHERE id=1"))!
        .data;
      const reviewed = await quotations.reviewIssue(
        db,
        actor,
        r!.quotation_id,
        settings,
      );
      await quotations.issue(
        db,
        actor,
        r!.quotation_id,
        reviewed.token,
        settings,
      );
      await requirements.review(db, actor, request.id, {
        version: r!.version,
        action: "SHARE",
      });
      const shared = await one(
        db,
        "SELECT * FROM commerce_requests WHERE id=$1",
        [request.id],
      );
      await lifecycle.customerRespond(db, shared!.customer_token, {
        decision: "ACCEPTED",
      });
      const preview = await store.preview(
        db,
        { ...payload, requestId: request.id },
        buyer,
      );
      assert.equal(preview.lines[0].priceSource, "QUOTE");
      assert.equal(preview.lines[0].unitExcl, "80.00");
      assert.equal(preview.lines[0].vat, "24.00");
      assert.equal(preview.totals.total, "184.00");
      const o = await store.checkout(
        db,
        { ...payload, requestId: request.id, idempotencyKey: randomUUID() },
        buyer,
      );
      assert.ok(o.orderId);
      await assert.rejects(
        store.checkout(
          db,
          { ...payload, requestId: request.id, idempotencyKey: randomUUID() },
          buyer,
        ),
        /already has an order/,
      );
    },
  );
  await t.test(
    "returns enforce delivered quantity, inspection and single credit refund",
    async () => {
      const o = await one(
        db,
        "SELECT * FROM ecommerce_orders WHERE customer_account_id=$1 AND sales_order_id IS NOT NULL",
        [buyer.id],
      );
      await assert.rejects(
        operations.requestReturn(db, buyer, {
          orderId: o!.id,
          reason: "Return item",
          lines: [{ productId: p.id, quantity: "1" }],
        }),
        /delivered quantity/,
      );
      await deliverSalesOrder(db, actor, o!.sales_order_id, {
        lines: [{ key: "1", quantity: "2" }],
        idempotencyKey: randomUUID(),
      });
      const before = await operations.available(db, w.id, p.id);
      const r = await operations.requestReturn(db, buyer, {
        orderId: o!.id,
        reason: "Return item",
        lines: [{ productId: p.id, quantity: "1" }],
      });
      await assert.rejects(
        operations.reviewReturn(db, actor, r.id, {
          version: 1,
          action: "REFUNDED",
          amount: "92",
        }),
        /transition/,
      );
      await operations.reviewReturn(db, actor, r.id, {
        version: 1,
        action: "APPROVED",
      });
      assert.equal(
        (await operations.available(db, w.id, p.id)).toString(),
        before.toString(),
      );
      await operations.reviewReturn(db, actor, r.id, {
        version: 2,
        action: "INSPECTED",
        inspection: "Inspected and resalable",
        restock: true,
      });
      assert.equal(
        (await operations.available(db, w.id, p.id)).toString(),
        before.add(1).toString(),
      );
      await operations.reviewReturn(db, actor, r.id, {
        version: 3,
        action: "REFUNDED",
        amount: "92",
      });
      await operations.reviewReturn(db, actor, r.id, {
        version: 3,
        action: "REFUNDED",
        amount: "92",
      });
      assert.equal(
        (await one(
          db,
          "SELECT count(*) n FROM commerce_credit_entries WHERE idempotency_key=$1",
          ["RETURN:" + r.id],
        ))!.n,
        1,
      );
    },
  );
  await t.test(
    "blocked company cannot use existing member sessions",
    async () => {
      await db.query(
        "UPDATE commerce_companies SET status='SUSPENDED' WHERE id=$1",
        [owner.company_id],
      );
      await assert.rejects(
        commerce.resolvePrice(db, p.id, "1", buyer),
        /approved company/,
      );
    },
  );
});
