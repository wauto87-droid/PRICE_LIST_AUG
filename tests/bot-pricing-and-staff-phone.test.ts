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

  // 7. Test WhatsApp Bot Numbered Language Selection
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
  assert.match(sentB[3].text, /Please select your language/);
});
