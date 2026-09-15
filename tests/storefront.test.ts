import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, PERMISSIONS } from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
import {
  saveWarehouse,
  stockAdjustment,
  stockBalances,
  listOnlineOrders,
  approveOnlineOrder,
} from "../backend/commercial/service";
import * as store from "../backend/storefront/service";
import { handle } from "../backend/api/router";

test("storefront routing, publication, pricing, verification and reliable checkout", async (t) => {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.SETUP_TOKEN = "storefront-test-setup-token-1234567890";
  process.env.APP_ORIGIN = "http://localhost:18180";
  const db = await embedded();
  t.after(() => db.close?.());
  await migrate(db);
  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "storeadmin",
    password: "StoreTest123456!",
    name: "Store Admin",
    companyName: "AMT Electric",
  });
  const user = (await one(
    db,
    "SELECT id FROM users WHERE username='storeadmin'",
  ))!;
  const actor: any = {
    id: user.id,
    username: "storeadmin",
    name: "Store Admin",
    role: "ADMIN",
    permissions: [...PERMISSIONS],
    maxDiscount: "100",
    csrf: "",
  };
  const p = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "TEST-1",
      description: "Electrical switch",
      brand: "AMT",
      category: "Switches",
      method: "COST_MARKUP",
      cost: "10.005",
      markup: "0",
      unit: "pcs",
      quantityPrecision: 0,
      details: {
        manufacturer: "AMT",
        specifications: [{ label: "Voltage", value: "240V" }],
      },
    }),
  );
  const p2 = await db.transaction((tx) =>
    saveProduct(tx, actor, {
      partNumber: "TEST-2",
      description: "Cable",
      brand: "AMT",
      category: "Cables",
      method: "COST_MARKUP",
      cost: "30",
      markup: "0",
    }),
  );
  const warehouse = await saveWarehouse(db, actor, undefined, {
    code: "SHOP",
    name: "Main pickup",
    active: true,
    pickupEnabled: true,
    allowNegativeStock: true,
  });
  await stockAdjustment(db,actor,{warehouseId:warehouse.id,productId:p.id,quantity:'100',unitCost:'10.005',reason:'Opening stock for checkout tests',idempotencyKey:randomUUID()});
  async function otp(destination = "0500000010") {
    const challenge = await store.requestOtp(db, {
      destination,
      channel: destination.includes("@") ? "EMAIL" : "SMS",
    });
    const verified = await store.verifyOtp(db, {
      id: challenge.id,
      code: challenge.testCode,
    });
    return {
      verificationId: challenge.id,
      verificationToken: verified.verificationToken,
    };
  }
  const base = {
    lines: [{ productId: p.id, quantity: "2" }],
    fulfillmentMethod: "PICKUP",
    warehouseId: warehouse.id,
    paymentMethod: "BANK_TRANSFER",
    contact: { name: "Buyer", mobile: "0500000010" },
  };
  await t.test(
    "disabled catalog returns the specific 404 and configuration stays readable",
    async () => {
      for (const prefix of ["/api/v1", "/amt_price_list/api/v1"]) {
        const r = await handle(
          new Request(`http://localhost:18180${prefix}/storefront/catalog?q=`),
          db,
        );
        assert.equal(r.status, 404);
        assert.equal((await r.json()).error, "Online store is not available");
      }
      assert.equal(((await store.configuration(db)) as any).enabled, false);
      await store.saveConfiguration(db, actor, {
        enabled: true,
        version: 1,
        companyName: "AMT Electric",
        deliveryEnabled: true,
        pickupEnabled: true,
      });
      assert.equal((await store.catalog(db, {})).total, 0);
    },
  );
  await t.test(
    "publication, filtered counts, sorting, pagination and rounded prices",
    async () => {
      for (const product of [p, p2])
        await store.publishProduct(db, actor, product.id, {
          published: true,
          version: product.version,
        });
      const c = await store.catalog(db, { pageSize: 1, sort: "price-desc" });
      assert.equal(c.total, 2);
      assert.equal(c.totalPages, 2);
      assert.equal(c.items[0].id, p2.id);
      assert.equal(
        (await store.catalog(db, { page: 2, pageSize: 1, sort: "price-desc" }))
          .items[0].id,
        p.id,
      );
      assert.equal(
        (await store.catalog(db, { category: "Switches" })).total,
        1,
      );
      const detail = await store.productDetail(db, p.id);
      assert.equal(detail.priceIncl, "11.51");
      assert.equal(detail.content.manufacturer, "AMT");
      assert.equal("cost" in detail, false);
      const quote = await store.preview(db, {
        ...base,
        lines: [{ productId: p.id, quantity: "1" }],
      });
      assert.equal(quote.totals.total, detail.priceIncl);
      await db.query(
        "UPDATE product_selling_levels SET active=false WHERE product_id=$1",
        [p2.id],
      );
      assert.equal((await store.catalog(db, {})).total, 2);
      assert.equal((await store.productDetail(db,p2.id)).priceIncl,null);
      await db.query(
        "UPDATE product_selling_levels SET active=true WHERE product_id=$1",
        [p2.id],
      );
      await assert.rejects(store.publicImage(db, randomUUID()), /unavailable/);
    },
  );
  await t.test("wrong OTP attempts persist and expire", async () => {
    const challenge = await store.requestOtp(db, {
      destination: "0500000011",
      channel: "SMS",
    });
    for (let i = 0; i < 5; i++)
      await assert.rejects(
        store.verifyOtp(db, { id: challenge.id, code: "000000" }),
        /incorrect/,
      );
    assert.equal(
      (
        await one(db, "SELECT attempts FROM otp_challenges WHERE id=$1", [
          challenge.id,
        ])
      )?.attempts,
      5,
    );
    await assert.rejects(
      store.verifyOtp(db, { id: challenge.id, code: challenge.testCode }),
      /Too many/,
    );
    const expired = await otp("0500000012");
    await db.query(
      "UPDATE otp_challenges SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [expired.verificationId],
    );
    await assert.rejects(
      store.checkout(db, { ...base, ...expired, idempotencyKey: randomUUID() }),
      /expired/,
    );
  });
  await t.test(
    "preview validates quantities, fulfillment and delivery fee thresholds",
    async () => {
      await assert.rejects(
        store.preview(db, {
          ...base,
          lines: [{ productId: p.id, quantity: "0" }],
        }),
        /quantity/,
      );
      await assert.rejects(
        store.preview(db, {
          ...base,
          lines: [{ productId: p.id, quantity: "0.5" }],
        }),
        /quantity/,
      );
      await assert.rejects(
        store.preview(db, { ...base, lines: [...base.lines, ...base.lines] }),
        /Duplicate/,
      );
      await assert.rejects(
        store.preview(db, { ...base, fulfillmentMethod: "DELIVERY" }),
        /zone/,
      );
      const zone = await store.saveZone(db, actor, {
        name: "Riyadh",
        active: true,
        fee: "12",
        freeAbove: "100",
      });
      const delivery = {
        ...base,
        fulfillmentMethod: "DELIVERY",
        zoneId: zone.id,
        address: { text: "Test street" },
      };
      assert.equal(
        (await store.preview(db, delivery)).totals.deliveryFee,
        "12.00",
      );
      assert.equal(
        (
          await store.preview(db, {
            ...delivery,
            lines: [{ productId: p.id, quantity: "10" }],
          })
        ).totals.deliveryFee,
        "0.00",
      );
      await db.query(
        "UPDATE storefront_settings SET data=data||'{\"pickupEnabled\":false}'::jsonb WHERE id=1",
      );
      await assert.rejects(store.preview(db, base), /Pickup is unavailable/);
      await db.query(
        "UPDATE storefront_settings SET data=data||'{\"pickupEnabled\":true}'::jsonb WHERE id=1",
      );
    },
  );
  await t.test(
    "atomic verification consumption, duplicate retries, changed quotes and protected status",
    async () => {
      const verified = await otp();
      const quote = await store.preview(db, base),
        body = {
          ...base,
          ...verified,
          quoteHash: quote.quoteHash,
          idempotencyKey: randomUUID(),
        };
      await assert.rejects(
        store.checkout(db, {
          ...body,
          contact: { name: "Other", mobile: "0509999999" },
        }),
        /Verify/,
      );
      await assert.rejects(
        store.checkout(db, { ...body, quoteHash: "changed" }),
        /Prices changed/,
      );
      const orders = await Promise.all([
        store.checkout(db, body),
        store.checkout(db, body),
      ]);
      assert.equal(orders[0].orderNumber, orders[1].orderNumber);
      assert.equal(
        (await one(db, "SELECT count(*)::int n FROM ecommerce_orders"))?.n,
        1,
      );
      await assert.rejects(
        store.checkout(db, { ...body, idempotencyKey: randomUUID() }),
        /Verify/,
      );
      await assert.rejects(
        store.checkout(db, {
          ...body,
          lines: [{ productId: p.id, quantity: "3" }],
        }),
        /different details/,
      );
      await assert.rejects(
        store.orderStatus(db, orders[0].orderId, {}),
        /denied/,
      );
      assert.equal(
        (
          await store.orderStatus(db, orders[0].orderId, {
            verificationToken: verified.verificationToken,
          })
        ).status,
        "PENDING_REVIEW",
      );
    },
  );
  await t.test(
    "approved business pricing, credit limits and business order customer conversion",
    async () => {
      const signup = await store.requestOtp(db,{destination:"0500000099",channel:"WHATSAPP",purpose:"SIGNUP"});
      const verified=await store.verifyOtp(db,{id:signup.id,code:signup.testCode});
      const verification={verificationId:signup.id,verificationToken:verified.verificationToken};
      const registered = await store.registerAccount(db, {
        ...verification,
        name: "Business Buyer",
        email: "business@example.com",
        mobile: "0500000099",
        password: "Business123456!",
      });
      assert.equal(registered.companyStatus,"PENDING");
      assert.ok((await store.loginAccount(db,{login:"business@example.com",password:"Business123456!"})).token);
      await store.updateAccount(db, actor, registered.id, {
        status: "ACTIVE",
        priceLevel: "WHOLESALE",
        creditEnabled: true,
        creditLimit: "30",
      });
      const login = await store.loginAccount(db, {
        login: "business@example.com",
        password: "Business123456!",
      });
      const account = await store.authenticateAccount(
        db,
        new Request("http://localhost", {
          headers: { cookie: store.accountSessionCookie(login.token) },
        }),
      );
      assert.equal(account?.price_level, "WHOLESALE");
      const body = {
        ...base,
        paymentMethod: "CREDIT_TERMS",
        idempotencyKey: randomUUID(),
      };
      const order = await store.checkout(db, body, account);
      await assert.rejects(
        store.checkout(db, { ...body, idempotencyKey: randomUUID() }, account),
        /credit limit/,
      );
      assert.equal(
        (await listOnlineOrders(db, actor, {})).items.find(
          (r: any) => r.id === order.orderId,
        )!.guest_contact.name,
        "Business Buyer",
      );
      const sales = await approveOnlineOrder(db, actor, order.orderId, {
        warehouseId: warehouse.id,
      });
      assert.equal(sales!.customer.name, "Business Buyer");
      await assert.rejects(
        approveOnlineOrder(db, actor, order.orderId, {
          warehouseId: warehouse.id,
        }),
        /already processed/,
      );
      await store.updateAccount(db, actor, registered.id, {
        status: "BLOCKED",
        priceLevel: "WHOLESALE",
        creditEnabled: false,
        creditLimit: null,
      });
      assert.equal(
        await store.authenticateAccount(
          db,
          new Request("http://localhost", {
            headers: { cookie: store.accountSessionCookie(login.token) },
          }),
        ),
        undefined,
      );
    },
  );
  await t.test(
    "card payments reserve an idempotent provider ID and verify server-side",
    async () => {
      const oldFetch = globalThis.fetch;
      process.env.MOYASAR_PUBLISHABLE_KEY = "pk_test";
      process.env.MOYASAR_SECRET_KEY = "sk_test";
      process.env.PUBLIC_URL = "https://example.test/amt_price_list";
      const verification = await otp("0500000013");
      const body = {
        ...base,
        contact: { name: "Card buyer", mobile: "0500000013" },
        ...verification,
        paymentMethod: "MOYASAR",
        moyasarToken: "test_token",
        idempotencyKey: randomUUID(),
      };
      let remote: any;
      let posts = 0;
      globalThis.fetch = async (input: any, init: any) => {
        if (init?.method === "POST") {
          posts++;
          const data = JSON.parse(init.body);
          assert.equal(
            data.callback_url,
            "https://example.test/amt_price_list/store?payment=return",
          );
          remote = {
            id: data.given_id,
            amount: data.amount,
            currency: data.currency,
            metadata: data.metadata,
            status: "initiated",
            source: { transaction_url: "https://example.test/challenge" },
          };
          return Response.json(remote);
        }
        assert.match(String(input), new RegExp(remote.id));
        return Response.json(remote);
      };
      try {
        const result = await store.checkout(db, body);
        assert.equal(result.status, "PENDING_PAYMENT");
        assert.equal(posts, 1);
        const retry = await store.checkout(db, body);
        assert.equal(retry.paymentReference, result.paymentReference);
        assert.equal(posts, 1);
        remote.status = "paid";
        assert.equal(
          (await store.confirmMoyasarPayment(db, result.paymentReference))
            .status,
          "CONFIRMED",
        );
        remote.amount++;
        await assert.rejects(
          store.confirmMoyasarPayment(db, result.paymentReference),
          /does not match/,
        );
      } finally {
        globalThis.fetch = oldFetch;
        delete process.env.MOYASAR_PUBLISHABLE_KEY;
        delete process.env.MOYASAR_SECRET_KEY;
        delete process.env.PUBLIC_URL;
      }
    },
  );
  await t.test(
    "public mutations reject other origins and stock pagination reaches every row",
    async () => {
      const r = await handle(
        new Request(
          "http://localhost:18180/amt_price_list/api/v1/storefront/preview",
          {
            method: "POST",
            headers: {
              origin: "https://evil.test",
              "content-type": "application/json",
            },
            body: JSON.stringify(base),
          },
        ),
        db,
      );
      assert.equal(r.status, 403);
      const first = await stockBalances(db, actor, { pageSize: 1 }),
        second = await stockBalances(db, actor, { pageSize: 1, page: 2 });
      assert.equal(first.total, 2);
      assert.notEqual(first.items[0].product_id, second.items[0].product_id);
      assert.equal(
        (await stockBalances(db, actor, { query: "TEST-2" })).items[0]
          .product_id,
        p2.id,
      );
    },
  );
  await t.test("storefront suggestions returns live search dropdown matches", async () => {
    // 1. Partial part search
    const sug1 = await store.suggestions(db, { q: "TEST" });
    assert(sug1.items.length >= 2);
    assert(sug1.items.some((i: any) => i.part_number === "TEST-1"));
    assert(sug1.items.some((i: any) => i.part_number === "TEST-2"));
    assert.equal(sug1.items[0].inStock, true);
    assert(typeof sug1.items[0].priceIncl === "string");

    // 2. Exact / normalized part search
    const sug2 = await store.suggestions(db, { q: "test1" });
    assert.equal(sug2.items[0].part_number, "TEST-1");

    // 3. API endpoint integration check via router handle()
    const req = new Request("http://localhost:18180/amt_price_list/api/v1/storefront/suggestions?q=TEST-1", {
      method: "GET",
    });
    const res = await handle(req, db);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].part_number, "TEST-1");

    // 4. Empty query returns empty list
    const emptySug = await store.suggestions(db, { q: "" });
    assert.equal(emptySug.items.length, 0);
  });
});
