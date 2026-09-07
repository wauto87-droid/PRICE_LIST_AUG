import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin = process.env.COMMERCE_TEST_ORIGIN || "http://127.0.0.1:18182";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const base = origin + "/amt_price_list";
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", e => errors.push(e.message));
try {
  const login = await context.request.post(base + "/api/v1/auth/login", {data: {username:"commerceqa",password:"CommerceQA123456!"}, headers:{origin}});
  assert.equal(login.status(), 200);
  const response = await context.request.get(base + "/api/v1/storefront/catalog");
  const product = (await response.json()).items[0];
  await page.goto(base + "/store/products/" + (product.slug || product.id));
  await page.getByRole("link", {name:"Edit product · تعديل المنتج"}).click();
  await page.locator(".modal").waitFor();
  assert.equal(await page.getByLabel("Part number", {exact:true}).inputValue(), product.part_number);
  await page.locator(".modal").getByRole("button", {name:"Cancel",exact:true}).click();
  for (const name of ["Homepage","Companies","Company prices","Requirements & quotes","Orders & payments","Returns & refunds","Promotions","Store settings","Delivery zones","Business accounts","Inventory & stock","Products"]) {
    await page.getByRole("button", {name,exact:true}).click();
    await page.waitForLoadState("networkidle");
    assert.deepEqual(await page.locator('[aria-label="Store management"] [role=alert]').allTextContents(), [], name);
  }
  await page.getByRole("button", {name:"Promotions",exact:true}).click();
  await page.reload();
  await page.getByRole("button", {name:"Promotions",exact:true}).waitFor();
  assert.match(await page.getByRole("button", {name:"Promotions",exact:true}).getAttribute("class"), /primary/);
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(base + "/store/products/" + (product.slug || product.id));
  await guestPage.waitForLoadState("networkidle");
  assert.equal(await guestPage.getByRole("link", {name:"Edit product · تعديل المنتج"}).count(), 0);
  assert.equal((await guest.request.get(base + "/api/v1/products/" + product.id)).status(),401);
  assert.equal((await guestPage.goto(base + "/store/categories/does-not-exist")).status(),404);
  await guest.close();
  assert.deepEqual(errors, []);
  console.log("PASS exact-product shortcut, all admin tabs, refresh persistence, customer isolation and category 404");
} finally { await browser.close(); }
