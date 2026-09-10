import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin =
  process.env.PRICE_HISTORY_TEST_ORIGIN || "http://127.0.0.1:18183";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.TEST_BROWSER ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(45000);
const base = origin + "/amt_price_list";
try {
  const login = await context.request.post(base + "/api/v1/auth/login", {
    data: { username: "historyqa", password: "HistoryQA123!" },
    headers: { origin },
  });
  assert.equal(login.status(), 200);
  await page.goto(base);
  await page.getByRole("combobox").first().fill("HISTORY-QA");
  await page
    .getByRole("option")
    .filter({ hasText: "HISTORY-QA" })
    .first()
    .click();
  const history = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Recent lookup history",
        exact: true,
      }),
    });
  await history
    .locator("tbody tr")
    .filter({ hasText: "HISTORY-QA" })
    .first()
    .waitFor();
  const before = await history.locator("tbody tr").count();
  const quantity = page.getByLabel(/^QUANTITY ·/);
  await quantity.fill("9");
  await page.waitForFunction(
    async ({ base, before }) => {
      const r = await fetch(base + "/api/v1/price-watcher/history");
      return (await r.json()).total > before;
    },
    { base, before },
  );
  await history
    .locator("tbody tr")
    .filter({ hasText: "9.00" })
    .first()
    .waitFor();
  const captured = await (
    await context.request.get(base + "/api/v1/price-watcher/history")
  ).json();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(600);
  assert.equal(
    (
      await (
        await context.request.get(base + "/api/v1/price-watcher/history")
      ).json()
    ).total,
    captured.total,
  );
  await history.getByRole("button", { name: /Date \/ time/ }).click();
  await history.locator('th[aria-sort="ascending"]').waitFor();
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.locator(".admin-menu-toggle").click();
  await page
    .getByRole("button", { name: "Price Watcher", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Individual pricing activity", exact: true })
    .waitFor();
  await page.getByLabel("Date order", { exact: true }).selectOption("asc");
  await page.getByLabel("View", { exact: true }).selectOption("GROUPS");
  await page
    .getByRole("heading", {
      name: "Item and staff price comparison",
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Details", exact: true })
    .first()
    .click();
  await page.locator(".watcher-detail tbody tr").first().waitFor();
  await page
    .locator(".watcher-detail")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.screenshot({
    path: "tmp/price-history-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "tmp/price-history-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
    true,
    "page should not overflow on mobile",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS lookup snapshots, recalculation, focus deduplication, sorting, comparison, detail and mobile layout",
  );
} finally {
  await browser.close();
}
