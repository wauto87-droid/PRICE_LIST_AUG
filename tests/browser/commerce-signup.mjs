import http from "node:http";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import QRCode from "qrcode";
const origin = process.env.COMMERCE_TEST_ORIGIN || "http://127.0.0.1:18183",
  base = origin + "/amt_price_list";
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use an isolated local test server");
let sentCode = "",
  connected = false,
  deliveryFails = false;
const qr = await QRCode.toDataURL("LOCAL COMMERCE TEST ONLY");
const provider = http.createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  assert.equal(
    req.headers.authorization,
    "Bearer commerce-local-test-only-token-1234567890",
  );
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  if (req.url === "/status")
    return res.end(
      JSON.stringify({
        status: connected ? "READY" : "QR",
        qr: connected ? null : qr,
        number: connected ? "966500000000" : null,
      }),
    );
  if (req.url === "/connect") {
    connected = true;
    return res.end("{}");
  }
  if (req.url === "/disconnect") {
    connected = false;
    return res.end("{}");
  }
  if (!connected || deliveryFails) {
    res.statusCode = 503;
    return res.end("{}");
  }
  sentCode = body.code || sentCode;
  res.end('{"sent":true}');
});
await new Promise((resolve) => provider.listen(3011, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const context = await browser.newContext(),
  page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const request = async (path, method = "GET", data, csrf = "") => {
  const r = await context.request.fetch(base + "/api/v1/" + path, {
    method,
    data,
    headers: { origin, "X-CSRF-Token": csrf },
  });
  const body = await r.json();
  assert.ok(r.ok(), JSON.stringify(body));
  return body;
};
try {
  await request("auth/login", "POST", {
    username: "commerceqa",
    password: "CommerceQA123456!",
  });
  const csrf = (await request("auth/me")).user.csrf;
  await page.goto(base);
  await page.getByRole("button", { name: "Commercial", exact: true }).click();
  await page
    .locator(".commercial-tabs button")
    .filter({ hasText: /Storefront|Online store/ })
    .click();
  await page.getByRole("button", { name: "WhatsApp OTP", exact: true }).click();
  await page.getByAltText("Scan with the company WhatsApp phone").waitFor();
  await page
    .getByRole("button", { name: "Connect / reconnect", exact: true })
    .click();
  await page.getByText(/READY/).waitFor();
  console.log("PASS admin QR display and connection status (stub provider)");
  await page.goto(base + "/store");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const suffix = String(Date.now()).slice(-8),
    mobile = "+9665" + suffix,
    email = "browser-" + suffix + "@example.com";
  await dialog.locator("input[name=name]").fill("Verified retail customer");
  await dialog.locator("input[name=mobile]").fill(mobile);
  await dialog.locator("input[type=email]").fill(email);
  await dialog.locator("input[name=password]").fill("BrowserBuyer123!");
  assert.ok(
    await dialog
      .getByRole("button", { name: "Submit application", exact: true })
      .isDisabled(),
  );
  deliveryFails = true;
  await dialog
    .getByRole("button", { name: "Send verification code", exact: true })
    .click();
  await dialog
    .getByRole("alert")
    .filter({ hasText: /disconnected|failed/ })
    .waitFor();
  assert.ok(
    await dialog
      .getByRole("button", { name: "Submit application", exact: true })
      .isDisabled(),
  );
  deliveryFails = false;
  await dialog
    .getByRole("button", { name: "Send verification code", exact: true })
    .click();
  await dialog.getByLabel("Verification code", { exact: true }).waitFor();
  assert.match(sentCode, /^\d{6}$/);
  await dialog.getByLabel("Verification code", { exact: true }).fill(sentCode);
  await dialog
    .getByRole("button", { name: "Verify code", exact: true })
    .click();
  await dialog.getByText("WhatsApp mobile verified", { exact: true }).waitFor();
  await dialog
    .getByRole("button", { name: "Submit application", exact: true })
    .click();
  await dialog.getByText(/Account created/).waitFor();
  await dialog
    .getByLabel("Sign-in method", { exact: true })
    .selectOption("PASSWORD");
  await dialog.locator("input[name=login]").fill(email);
  await dialog.locator("input[name=password]").fill("BrowserBuyer123!");
  await dialog
    .locator("form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("button", { name: "My account", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS mandatory signup OTP, disconnected delivery, verified retail registration, password login and no browser errors",
  );
} catch (e) {
  await page.screenshot({
    path: "test-results/commerce-signup-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await new Promise((resolve) => provider.close(resolve));
}
