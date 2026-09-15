import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { embedded, migrate, one } from "../backend/core/db";
import { setup, PERMISSIONS } from "../backend/auth/service";
import { saveProduct } from "../backend/products/service";
import * as admin from "../backend/admin/service";
import { handle } from "../backend/api/router";

test("staff phone management, bot price search and numbered language selection", async (t) => {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.SETUP_TOKEN = "test-token-bot-phone-1234567890123456";
  process.env.APP_ORIGIN = "http://localhost:18180";
  const db = await embedded();
  t.after(() => db.close?.());
  await migrate(db);

  await setup(db, {
    token: process.env.SETUP_TOKEN,
    username: "superadmin",
    password: "Password123!",
    name: "Super Admin",
    companyName: "AMT Electric",
  });

  const adminUser = (await one(db, "SELECT id FROM users WHERE username='superadmin'"))!;
  const adminActor: any = {
    id: adminUser.id,
    username: "superadmin",
    name: "Super Admin",
    role: "ADMIN",
    permissions: [...PERMISSIONS],
    maxDiscount: "100",
    csrf: "",
  };

  // 1. Create a staff user with a phone number
  const staffSave = await admin.saveUser(db, adminActor, {
    username: "salesstaff",
    name: "Ahmed Sales",
    role: "STAFF",
    permissions: ["PRODUCT_VIEW"],
    maxDiscount: "20",
    disabled: false,
    password: "StaffPassword123!",
    phone: "+966501234567",
  });
  assert(staffSave.id, "Staff user should be created");

  const staffInDb = await one(db, "SELECT phone, max_discount FROM users WHERE id=$1", [staffSave.id]);
  assert.equal(staffInDb?.phone, "+966501234567");

  // 2. Create a test product with pricing
  const product = await db.transaction((tx) =>
    saveProduct(tx, adminActor, {
      partNumber: "LC1D09M7",
      description: "Schneider Contactor 9A 220V",
      brand: "Schneider Electric",
      category: "Contactors",
      method: "COST_MARKUP",
      cost: "100",
      markup: "25",
      minimumEnabled: true,
      minimum: "110",
      aliases: ["CONTACTOR-9A"],
    })
  );
  assert(product.id);

  // 3. Test bot/price endpoint: Unauthorized phone number
  const unauthReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "LC1D09M7",
      senderPhone: "966599999999", // not a staff phone
      discount: 10,
    }),
  });
  const unauthRes = await handle(unauthReq, db);
  const unauthData = await unauthRes.json();
  assert.equal(unauthData.authorized, false);
  assert.equal(unauthData.error, "UNAUTHORIZED_STAFF");

  // 4. Test bot/price endpoint: Authorized staff phone (e.g. sent as 966501234567)
  const authReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "LC1D09M7",
      senderPhone: "966501234567", // matches +966501234567
      discount: 10,
    }),
  });
  const authRes = await handle(authReq, db);
  const authData = await authRes.json();
  assert.equal(authData.authorized, true);
  assert.equal(authData.found, true);
  assert.equal(authData.partNumber, "LC1D09M7");
  assert.equal(authData.staff.name, "Ahmed Sales");
  assert.equal(authData.priceExcl, "125.00"); // 100 cost + 25% markup
  assert.equal(authData.requestedDiscount, 10);
  assert.equal(authData.discountAllowed, true); // within 20% max discount
  assert.equal(authData.discountedPrice, "112.50"); // 125 * 0.90
  assert.equal(authData.vat, 15);
  assert.equal(authData.vatAmount, "16.88"); // 112.50 * 0.15
  assert.equal(authData.finalPrice, "129.38"); // 112.50 + 16.88

  // 5. Test bot/price endpoint: Alias lookup (CONTACTOR-9A)
  const aliasReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "CONTACTOR-9A",
      senderPhone: "0501234567", // local format matches +966501234567
      discount: 5,
    }),
  });
  const aliasRes = await handle(aliasReq, db);
  const aliasData = await aliasRes.json();
  assert.equal(aliasData.authorized, true);
  assert.equal(aliasData.found, true);
  assert.equal(aliasData.partNumber, "LC1D09M7");

  // 6. Test bot/price endpoint: Non-existent product
  const missingReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "DOES-NOT-EXIST-999",
      senderPhone: "966501234567",
    }),
  });
  const missingRes = await handle(missingReq, db);
  const missingData = await missingRes.json();
  assert.equal(missingData.authorized, true);
  assert.equal(missingData.found, false);

  // 7. Test Session Preservation: Updating phone number does NOT invalidate session
  const fakeSessionToken = "session-token-staff-123";
  await db.query(
    "INSERT INTO sessions(token_hash, user_id, csrf, expires_at) VALUES($1, $2, 'csrf-secret-123', now() + interval '1 day')",
    [fakeSessionToken, staffSave.id]
  );
  const sessionBefore = await one(db, "SELECT token_hash FROM sessions WHERE user_id=$1", [staffSave.id]);
  assert.ok(sessionBefore, "Session should exist before phone update");

  // Admin updates staff user's phone number
  await admin.saveUser(db, adminActor, {
    username: "salesstaff",
    name: "Ahmed Sales",
    role: "STAFF",
    permissions: ["PRODUCT_VIEW"],
    maxDiscount: "20",
    disabled: false,
    phone: "+966509876543", // updated phone
  }, staffSave.id);

  // Session MUST still exist (no session logout on phone/name edit)
  const sessionAfterPhoneUpdate = await one(db, "SELECT token_hash FROM sessions WHERE user_id=$1", [staffSave.id]);
  assert.ok(sessionAfterPhoneUpdate, "Active session MUST remain valid when updating phone number");

  // Admin changes password -> session MUST be invalidated
  await admin.saveUser(db, adminActor, {
    username: "salesstaff",
    name: "Ahmed Sales",
    role: "STAFF",
    permissions: ["PRODUCT_VIEW"],
    maxDiscount: "20",
    disabled: false,
    password: "NewPassword12345!", // password change
    phone: "+966509876543",
  }, staffSave.id);
  const sessionAfterPasswordChange = await one(db, "SELECT token_hash FROM sessions WHERE user_id=$1", [staffSave.id]);
  assert.equal(sessionAfterPasswordChange, undefined, "Session MUST be deleted when password changes");

  // 8. Test Cost Markup vs List Discount Price Calculations from App Database
  // Create a LIST_DISCOUNT product
  const discProduct = await db.transaction((tx) =>
    saveProduct(tx, adminActor, {
      partNumber: "ABB-32A-MCB",
      description: "ABB Miniature Circuit Breaker 32A",
      brand: "ABB",
      category: "Breakers",
      method: "LIST_DISCOUNT",
      listPrice: "200",
      baseDiscount: "20",
      cost: "120",
      minimumEnabled: false,
      minimum: "0",
    })
  );
  assert(discProduct.id);

  // 8a. Cost Markup item (LC1D09M7) with custom markup % (e.g. 30%)
  const markupReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "LC1D09M7",
      senderPhone: "+966509876543",
      percent: 30,
      percentType: "MARKUP",
    }),
  });
  const markupRes = await handle(markupReq, db);
  const markupData = await markupRes.json();
  assert.equal(markupData.authorized, true);
  assert.equal(markupData.found, true);
  assert.equal(markupData.method, "COST_MARKUP");
  assert.equal(markupData.cost, "100.00");
  assert.equal(markupData.markupPercent, 30);
  assert.equal(markupData.priceExcl, "130.00"); // 100 * 1.30
  assert.equal(markupData.vatAmount, "19.50"); // 130 * 0.15
  assert.equal(markupData.finalPrice, "149.50");

  // 8b. Cost Markup item (LC1D09M7) with stored markup % (no % number passed, e.g. LC1D09M7 %)
  const storedMarkupReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "LC1D09M7 %",
      senderPhone: "+966509876543",
    }),
  });
  const storedMarkupRes = await handle(storedMarkupReq, db);
  const storedMarkupData = await storedMarkupRes.json();
  assert.equal(storedMarkupData.authorized, true);
  assert.equal(storedMarkupData.found, true);
  assert.equal(storedMarkupData.method, "COST_MARKUP");
  assert.equal(storedMarkupData.markupPercent, 25); // stored database markup
  assert.equal(storedMarkupData.priceExcl, "125.00"); // 100 * 1.25
  assert.equal(storedMarkupData.vatAmount, "18.75");
  assert.equal(storedMarkupData.finalPrice, "143.75");

  // 8c. List Discount item (ABB-32A-MCB) with custom discount % (e.g. 15%)
  const discReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "ABB-32A-MCB",
      senderPhone: "+966509876543",
      percent: 15,
      percentType: "DISCOUNT",
    }),
  });
  const discRes = await handle(discReq, db);
  const discData = await discRes.json();
  assert.equal(discData.authorized, true);
  assert.equal(discData.found, true);
  assert.equal(discData.method, "LIST_DISCOUNT");
  assert.equal(discData.listPrice, "200.00");
  assert.equal(discData.discountPercent, 15);
  assert.equal(discData.discountedPrice, "170.00"); // 200 * 0.85
  assert.equal(discData.vatAmount, "25.50");
  assert.equal(discData.finalPrice, "195.50");

  // 8d. List Discount item with stored discount % (e.g. ABB-32A-MCB %)
  const storedDiscReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "ABB-32A-MCB %",
      senderPhone: "+966509876543",
    }),
  });
  const storedDiscRes = await handle(storedDiscReq, db);
  const storedDiscData = await storedDiscRes.json();
  assert.equal(storedDiscData.authorized, true);
  assert.equal(storedDiscData.found, true);
  assert.equal(storedDiscData.method, "LIST_DISCOUNT");
  assert.equal(storedDiscData.discountPercent, 20); // stored database discount
  assert.equal(storedDiscData.discountedPrice, "160.00"); // 200 * 0.80
  assert.equal(storedDiscData.vatAmount, "24.00");
  assert.equal(storedDiscData.finalPrice, "184.00");

  // 9. Test Order Tracking Endpoint: WEB-... and carrier/tracking details
  await db.query(`
    INSERT INTO ecommerce_orders(
      id, number, status, fulfillment_method, payment_method, totals, lines, fulfillment_data
    ) VALUES (
      'e1111111-2222-3333-4444-555555555555',
      'WEB-20260915-A1B2C3D4',
      'CONFIRMED',
      'DELIVERY',
      'CASH_ON_DELIVERY',
      '{"total":"345.00","subtotal":"300.00","vat":"45.00"}'::jsonb,
      '[{"productId":"${product.id}","quantity":"2"}]'::jsonb,
      '{"fulfillmentStatus":"SHIPPED","carrier":"SMSA Express","tracking":"SMSA-99887766","shippedAt":"2026-09-15T10:00:00Z"}'::jsonb
    )
  `);

  const trackReq = new Request("http://localhost/amt_price_list/api/v1/storefront/bot/track-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "#WEB-20260915-A1B2C3D4" }),
  });
  const trackRes = await handle(trackReq, db);
  const trackData = await trackRes.json();
  assert.equal(trackData.found, true);
  assert.equal(trackData.number, "WEB-20260915-A1B2C3D4");
  assert.equal(trackData.fulfillmentStatus, "SHIPPED");
  assert.equal(trackData.carrier, "SMSA Express");
  assert.equal(trackData.tracking, "SMSA-99887766");
  assert.equal(trackData.totals.total, "345.00");

  // 10. Test WhatsApp Bot Numbered Language Selection and Message Flow
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const urlStr = typeof input === "string" ? input : input.url;
    if (urlStr.includes("/storefront/bot/")) {
      const req = new Request(urlStr, init);
      return handle(req, db);
    }
    return originalFetch(input, init);
  }) as any;

  try {
    const { handleBotMessage } = createRequire(import.meta.url)("../scripts/whatsapp-service.cjs");
    
    // Test User A: selects Option 1 (Arabic)
    const sentA: { to: string; text: string }[] = [];
    const clientA = {
      sendMessage: async (to: string, text: string) => { sentA.push({ to, text }); },
    };
    const senderA = "966599000001@c.us";

  // First message with unknown text -> should prompt with Option 1 & 2
  await handleBotMessage({ from: senderA, body: "hello", fromMe: false }, clientA);
  assert.equal(sentA.length, 1);
  assert.match(sentA[0].text, /الرجاء اختيار اللغة/);
  assert.match(sentA[0].text, /1️⃣\s+العربية/);
  assert.match(sentA[0].text, /2️⃣\s+English/);

  // Reply "1" -> should confirm Arabic and deliver Arabic menu
  await handleBotMessage({ from: senderA, body: "1", fromMe: false }, clientA);
  assert(sentA.length >= 3);
  assert.match(sentA[1].text, /تم اختيار اللغة العربية/);
  assert.match(sentA[2].text, /أهلاً بك في شركة إيه إم تي للمواد الكهربائية/);

  // User A selects Option 3 (Track Order) -> bot prompts for order number
  await handleBotMessage({ from: senderA, body: "3", fromMe: false }, clientA);
  assert.match(sentA[sentA.length - 1].text, /تتبع حالة الطلب/);
  assert.match(sentA[sentA.length - 1].text, /يرجى إرسال رقم الطلب/);

  // User A replies with their order number WEB-20260915-A1B2C3D4
  await handleBotMessage({ from: senderA, body: "WEB-20260915-A1B2C3D4", fromMe: false }, clientA);
  const trackReply = sentA[sentA.length - 1].text;
  assert.match(trackReply, /تفاصيل الطلب: WEB-20260915-A1B2C3D4/);
  assert.match(trackReply, /SMSA Express/);
  assert.match(trackReply, /SMSA-99887766/);
  assert.match(trackReply, /345\.00 SAR/);

  // Test User B: selects Option 2 (English)
  const sentB: { to: string; text: string }[] = [];
  const clientB = {
    sendMessage: async (to: string, text: string) => { sentB.push({ to, text }); },
  };
  const senderB = "966599000002@c.us";

  // First message -> language prompt
  await handleBotMessage({ from: senderB, body: "start", fromMe: false }, clientB);
  assert.match(sentB[0].text, /Please select your language/);

  // Reply "2" -> should confirm English and deliver English menu
  await handleBotMessage({ from: senderB, body: "2", fromMe: false }, clientB);
  assert(sentB.length >= 3);
  assert.match(sentB[1].text, /Language has been set to English/);
  assert.match(sentB[2].text, /Welcome to AMT Electrical Supplies/);

  // Switching language via "lang"
  await handleBotMessage({ from: senderB, body: "lang", fromMe: false }, clientB);
  assert.match(sentB[sentB.length - 1].text, /Please select your language/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
