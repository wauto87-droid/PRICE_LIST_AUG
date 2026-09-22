import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const bundle = await build({ stdin: { contents: `
import React from 'react';
import { createRoot } from 'react-dom/client';
import CustomLineForm from './frontend/CustomLineForm';
const ar = new URLSearchParams(location.search).has('ar');
createRoot(document.getElementById('root')).render(<CustomLineForm vat="15" t={(en, arabic) => ar ? arabic : en} onAdd={() => {}} />);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, jsx: "automatic", platform: "browser" });
const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
try {
  for (const ar of [false, true]) {
    const page = await browser.newPage({ viewport: { width: ar ? 390 : 1440, height: 900 } });
    await page.route("http://custom.test/**", route => route.fulfill({ contentType: "text/html", body: `<html dir="${ar ? "rtl" : "ltr"}"><body><div id="root"></div></body></html>` }));
    await page.goto("http://custom.test/" + (ar ? "?ar" : ""));
    await page.addStyleTag({ content: await fs.readFile("app/globals.css", "utf8") });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: ar ? "+ إضافة صنف مخصص" : "+ Add custom item" }).click();
    await page.getByLabel(ar ? "سعر الوحدة الأساسي قبل الضريبة" : "Base unit price excl. VAT", { exact: true }).fill("100");
    await page.getByLabel(ar ? "الخصم % (اختياري)" : "Discount % (optional)", { exact: true }).fill("20");
    assert.match(await page.locator(".custom-price-preview").innerText(), /80.00/);
    await page.getByLabel(ar ? "التعديل" : "Adjustment", { exact: true }).selectOption("MARKUP");
    assert.equal(await page.getByLabel(ar ? "الزيادة % (اختياري)" : "Markup % (optional)", { exact: true }).inputValue(), "20");
    assert.match(await page.locator(".custom-price-preview").innerText(), /120.00/);
    assert.match(await page.locator(".custom-price-preview").innerText(), /138.00/);
    await page.getByLabel(ar ? "التعديل" : "Adjustment", { exact: true }).selectOption("DISCOUNT");
    assert.match(await page.locator(".custom-price-preview").innerText(), /80.00/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.close();
  }
  console.log("PASS custom adjustment preview, mode switching, English desktop and Arabic mobile");
} finally { await browser.close(); }
