import { chromium } from "playwright";
import fs from "node:fs/promises";
import http from "node:http";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:18180",
  base = origin + "/amt_price_list";
let otpCode = "";
const provider = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  otpCode = JSON.parse(raw).code;
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
});
await new Promise((resolve) => provider.listen(18181, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await ctx.newPage();
page.setDefaultTimeout(15000);
let errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base + "/store");
  await page.locator(".sf-logo img").waitFor();
  assert.equal(
    await page.locator(".sf-logo img").evaluate((e) => e.naturalWidth > 0),
    true,
  );
  console.log("PASS closed store and logo");
  const credentials = JSON.parse(
    await fs.readFile(".data/dev-access.json", "utf8"),
  );
  let response = await ctx.request.post(base + "/api/v1/auth/login", {
    data: { username: credentials.username, password: credentials.password },
    headers: { origin },
  });
  assert.equal(response.status(), 200);
  const session = await (
    await ctx.request.get(base + "/api/v1/auth/me")
  ).json();
  const headers = { origin, "X-CSRF-Token": session.user.csrf };
  const api = async (path, method = "GET", data) => {
    const r = await ctx.request.fetch(base + "/api/v1/" + path, {
      method,
      data,
      headers,
    });
    const b = await r.json();
    if (!r.ok()) throw new Error(path + ": " + JSON.stringify(b));
    return b;
  };
  const config = await api("storefront-admin");
  await api("storefront-admin", "PUT", {
    version: config.version,
    enabled: true,
    companyName: "AMT Electric",
    deliveryEnabled: true,
    pickupEnabled: true,
  });
  const management = await api("storefront-admin/management");
  for (const p of management.products)
    if (!p.storefront_published)
      await api("storefront-admin/products/" + p.id, "PUT", {
        published: true,
        version: p.version,
      });
  if (!management.zones.some((z) => z.name === "Local test delivery"))
    await api("storefront-admin/zones", "PUT", {
      name: "Local test delivery",
      fee: "12",
      freeAbove: null,
      active: true,
    });
  if (!(await api("warehouses?query=QA")).items.length)
    await api("warehouses", "POST", {
      code: "QA",
      name: "Local test pickup",
      active: true,
      pickupEnabled: true,
      allowNegativeStock: true,
    });
  await page.reload();
  await page.locator(".sf-product").first().waitFor();
  assert.equal(await page.locator(".sf-product").count(), 4);
  await page.screenshot({
    path: ".data/storefront-desktop.png",
    fullPage: true,
  });
  console.log("PASS published catalog");
  await page.getByRole("searchbox").count();
  await page
    .getByRole("textbox", { name: "Search products", exact: true })
    .fill("Contactor");
  await page.locator(".sf-search button").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".sf-product").length === 1,
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".sf-product").length === 4,
  );
  console.log("PASS search/reset");
  await page.locator(".sf-product-title").first().click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.locator(".sf-add").first().click();
  await page.reload();
  await page.locator(".sf-count").filter({ hasText: "1" }).waitFor();
  await page.locator(".sf-header-actions button").last().click();
  await page
    .getByRole("button", { name: "Continue to checkout", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Full name", exact: true })
    .fill("Local QA Customer");
  await page
    .getByRole("textbox", { name: "Mobile number", exact: true })
    .fill("050123" + String(Date.now()).slice(-4));
  await page
    .getByRole("button", { name: "Send verification code", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Verification code", exact: true })
    .waitFor();
  assert.match(otpCode, /^\d{6}$/);
  await page
    .getByRole("textbox", { name: "Verification code", exact: true })
    .fill(otpCode);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  console.log("PASS OTP verified");
  await page.locator(".sf-form select").first().selectOption("DELIVERY");
  await page.locator(".sf-form select").nth(1).selectOption({ index: 1 });
  await page
    .getByLabel("Full delivery address", { exact: true })
    .fill("Local QA test address");
  await page
    .getByRole("button", { name: "Review order & total", exact: true })
    .click();
  await page.getByText("Total to pay", { exact: true }).waitFor();
  assert.match(await page.locator(".sf-totals").innerText(), /12.00/);
  await page.screenshot({
    path: ".data/storefront-checkout.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  await page
    .getByRole("heading", { name: "Order received", exact: true })
    .waitFor();
  console.log(
    "PASS persisted cart, real OTP, delivery preview and guest order",
  );
  await page
    .getByRole("button", { name: "Continue shopping", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".data/storefront-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  await page.screenshot({
    path: ".data/storefront-arabic.png",
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  console.log("PASS mobile English/Arabic without overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await page.getByRole("button", { name: "Commercial", exact: true }).click();
  await page.getByRole("button", { name: "Online store", exact: true }).click();
  await page
    .getByRole("heading", { name: "Store management", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Save store settings", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".data/storefront-management.png",
    fullPage: true,
  });
  console.log("PASS management is accessible");
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await page
    .getByRole("button", { name: "Published · Unpublish", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Stock", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "Search all stock products", exact: true })
    .fill("LC1D09M7");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "LC1D09M7", exact: true }).click();
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .waitFor();
  console.log("PASS stock search and full product details");

  assert.deepEqual(errors, []);
  console.log("PASS no browser runtime errors");
} catch (e) {
  await page.screenshot({
    path: ".data/storefront-qa-error.png",
    fullPage: true,
  });
  console.error(String(e));
  throw e;
} finally {
  await browser.close();
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
}
