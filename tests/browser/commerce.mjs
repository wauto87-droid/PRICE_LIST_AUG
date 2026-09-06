import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import sharp from "sharp";
const origin = process.env.COMMERCE_TEST_ORIGIN || "http://127.0.0.1:18182",
  base = origin + "/amt_price_list";
assert(
  origin.includes("127.0.0.1") || origin.includes("localhost"),
  "Use an isolated local commerce test server",
);
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let csrf = "";
const api = async (path, method = "GET", data) => {
  const r = await context.request.fetch(base + "/api/v1/" + path, {
    method,
    data,
    headers: { origin, "X-CSRF-Token": csrf },
    timeout: 120000,
  });
  const b = await r.json();
  assert.ok(r.ok(), path + ": " + JSON.stringify(b));
  return b;
};
try {
  if ((await api("setup")).required)
    await api("setup", "POST", {
      token: "commerce-browser-test-setup-123456789012345",
      username: "commerceqa",
      name: "Commerce QA",
      password: "CommerceQA123456!",
      companyName: "AMT Electric",
    });
  await api("auth/login", "POST", {
    username: "commerceqa",
    password: "CommerceQA123456!",
  });
  csrf = (await api("auth/me")).user.csrf;
  const settings = await api("storefront-admin");
  await api("storefront-admin", "PUT", {
    version: settings.version,
    enabled: true,
    companyName: "AMT Electric",
    businessEnabled: true,
    operationsEnabled: true,
  });
  let product = (await api("storefront-admin/management?q=QA-SWITCH"))
    .products[0];
  if (!product)
    product = await api("products", "POST", {
      partNumber: "QA-SWITCH",
      description: "Industrial safety switch",
      brand: "AMT",
      category: "Switches",
      method: "COST_MARKUP",
      cost: "40",
      markup: "25",
      unit: "pcs",
      quantityPrecision: 0,
    });
  await api("storefront-admin/products/" + product.id, "PUT", {
    version: product.version,
    published: true,
    slug: "qa-safety-switch",
    content: {
      description: "Reliable electrical protection for your next project.",
      seoTitle: "Industrial safety switch | AMT",
      seoDescription:
        "Shop industrial safety switches with retail and company pricing.",
    },
  });
  let warehouse = (await api("warehouses?pageSize=100")).items.find(
    (w) => w.code === "QA",
  );
  if (!warehouse)
    warehouse = await api("warehouses", "POST", {
      code: "QA",
      name: "QA warehouse",
      pickupEnabled: true,
    });
  const balance = await api("inventory/balances?query=QA-SWITCH");
  if (!balance.items.some((b) => Number(b.on_hand) > 0))
    await api("inventory/adjustments", "POST", {
      warehouseId: warehouse.id,
      productId: product.id,
      quantity: "50",
      unitCost: "40",
      kind: "OPENING",
      reason: "QA opening stock",
      idempotencyKey: crypto.randomUUID(),
    });
  await page.goto(base);
  await page.getByRole("button", { name: "Commercial", exact: true }).click();
  await page
    .locator(".commercial-tabs button")
    .filter({ hasText: /Storefront|Online store/ })
    .click();
  await page
    .getByRole("heading", { name: "Store management", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Products", exact: true }).click();
  assert.ok(await page.getByRole("button",{name:"Publish selected",exact:true}).isDisabled());
  await page.getByRole("button",{name:"Select all matching",exact:true}).click();
  await page.getByRole("button",{name:"Publish selected",exact:true}).waitFor();
  await page.getByRole("button",{name:"Publish selected",exact:true}).click();
  await page.getByText(/Updated:/).waitFor();
  await page.getByRole("link",{name:"Bulk import workspace",exact:true}).click();
  await page.getByRole("heading",{name:"Catalog Management",exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log("PASS bulk publishing visibility, all-matching selection and import deep link");
  await page.goto(base);
  await page.getByRole("button",{name:"Commercial",exact:true}).click();
  await page.locator(".commercial-tabs button").filter({hasText:/Storefront|Online store/}).click();
  await page.getByRole("button",{name:"Products",exact:true}).click();
  await page.getByText("Bulk product images",{exact:true}).click();
  const png=await sharp({create:{width:80,height:80,channels:3,background:'#175b44'}}).png().toBuffer();
  await page.getByLabel("Choose product images",{exact:true}).setInputFiles({name:"QA-SWITCH.png",mimeType:"image/png",buffer:png});
  await page.getByRole("cell",{name:"READY",exact:true}).waitFor();
  await page.getByRole("button",{name:"Upload reviewed matches",exact:true}).click();
  await page.getByRole("cell",{name:"UPLOADED",exact:true}).waitFor();
  console.log("PASS bulk image matching and upload");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page
    .getByLabel("Part number", { exact: true })
    .fill("QA-FORM-" + Date.now());
  await page
    .getByLabel("Description", { exact: true })
    .fill("Browser-created component");
  await page
    .getByRole("button", { name: "Preview changes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm & publish", exact: true })
    .click();
  await page.locator(".modal").waitFor({ state: "hidden" });
  console.log("PASS product creation from store admin");
  await page
    .getByRole("button", { name: "Inventory & stock", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Stock management", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "QA warehouse", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Homepage", exact: true }).click();
  await page.getByRole("button", { name: "Add BANNER", exact: true }).click();
  await page
    .locator("input[name=title]")
    .fill("Project essentials, better prices");
  await page
    .locator("input[name=text]")
    .fill("Quality electrical supplies for your business and home.");
  await page
    .locator("input[name=link]")
    .fill("/amt_price_list/store?category=Switches");
  await page.locator("select[name=status]").selectOption("PUBLISHED");
  await page
    .getByRole("button", { name: "Save campaign", exact: true })
    .click();
  await page.getByText("Saved successfully", { exact: true }).waitFor();
  console.log("PASS banner editor publishes content");
  for (const name of [
    "Companies",
    "Company prices",
    "Requirements & quotes",
    "Orders & payments",
    "Returns & refunds",
    "Promotions",
    "Store settings",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForTimeout(180);
  }
  await page.goto(base + "/store");
  await page
    .getByRole("heading", { name: "Project essentials, better prices" })
    .first()
    .waitFor();
  await page.screenshot({
    path: "test-results/commerce-store-desktop.png",
    fullPage: true,
  });
  await page.goto(base + "/store/products/qa-safety-switch");
  await page
    .getByRole("heading", { name: "Industrial safety switch", exact: true })
    .waitFor();
  assert.match(await page.title(), /Industrial safety switch/);
  assert.match(
    await page.locator('script[type="application/ld+json"]').textContent(),
    /"priceCurrency":"SAR"/,
  );
  console.log("PASS public product page and metadata");
  const seo=await api("storefront-admin/category-seo");
  await api("storefront-admin/category-seo","PUT",{categoryId:seo.categories.find(c=>c.name==="Switches").id,version:seo.version,title:"Switches for projects | AMT",description:"Project switches and electrical supplies",titleAr:"مفاتيح المشاريع",descriptionAr:"مستلزمات كهربائية للمشاريع"});
  await page.goto(base + "/store/categories/Switches");
  assert.equal(await page.title(),"Switches for projects | AMT");
  await page.getByText("مفاتيح المشاريع",{exact:true}).waitFor();
  console.log("PASS editable category SEO and Arabic content");
  await page.getByRole("heading", { name: "Switches", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/store");
  await page.locator(".sf-product").first().waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Mobile storefront overflows",
  );
  await page.screenshot({
    path: "test-results/commerce-store-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "العربية", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  console.log("PASS mobile layout and Arabic direction");
  assert.deepEqual(errors, []);
  console.log("PASS no browser runtime errors");
} catch (e) {
  await page.screenshot({
    path: "test-results/commerce-failure.png",
    fullPage: true,
  });
  console.error("Browser errors:", errors);
  throw e;
} finally {
  await browser.close();
}
