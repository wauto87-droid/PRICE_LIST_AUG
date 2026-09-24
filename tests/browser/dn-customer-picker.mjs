import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const customers = Array.from({ length: 55 }, (_, i) => ({
  customer_key: `CODE:${String(i + 1).padStart(3, "0")}`,
  customer:
    i === 30
      ? "شركة الاختبار العربية"
      : `Company ${String(i + 1).padStart(2, "0")}`,
  customer_code: String(i + 1).padStart(3, "0"),
}));
const bundle = await build({
  stdin: {
    contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import CustomerSelectionTable from './frontend/dn-tracker/CustomerSelectionTable';
const customers=${JSON.stringify(customers)};const ar=new URLSearchParams(location.search).has('ar');const t=(en,arabic)=>ar?arabic:en;
function App(){const [value,setValue]=useState(['MISSING:OLD']);return <><CustomerSelectionTable label={t('Group customers','عملاء المجموعة')} customers={customers} value={value} onChange={setValue} t={t}/><output hidden>{JSON.stringify(value)}</output></>};createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  platform: "browser",
});
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.TEST_BROWSER ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
try {
  for (const ar of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: ar ? 390 : 1440, height: 900 },
    });
    page.on("dialog", () => {
      throw new Error("Native browser dialog invoked");
    });
    await page.route("http://picker.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html dir="${ar ? "rtl" : "ltr"}"><body><div id="root"></div></body></html>`,
      }),
    );
    await page.goto(`http://picker.test/${ar ? "?ar" : ""}`);
    await page.addStyleTag({
      content:
        (await fs.readFile("app/globals.css", "utf8")) +
        "\n" +
        (await fs.readFile("frontend/dn-tracker/tracker.css", "utf8")),
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const search = page.getByLabel(ar ? "بحث الشركات" : "Search companies");
    await search.fill(ar ? "الاختبار" : "Company 3");
    await page
      .getByRole("button", {
        name: ar ? "تحديد نتائج البحث" : "Select search results",
      })
      .click();
    const output = () => page.locator("output").textContent();
    assert.match(await output(), /MISSING:OLD/);
    assert.match(await output(), ar ? /CODE:031/ : /CODE:030/);
    await page
      .getByRole("button", { name: ar ? "مسح التحديد" : "Clear selection" })
      .click();
    assert.equal(await output(), "[]");
    await search.fill("");
    await page
      .getByRole("button", {
        name: ar ? "تحديد كل الشركات" : "Select all companies",
      })
      .click();
    assert.equal(JSON.parse(await output()).length, 55);
    await page
      .getByRole("button", { name: ar ? "المحدد فقط" : "Selected only" })
      .click();
    await page.getByRole("button", { name: ar ? "التالي" : "Next" }).click();
    assert.ok(await page.getByLabel("Company 26").isVisible());
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    );
    await page.close();
  }
  console.log(
    "PASS: company search, bulk selection, selected-only paging, unavailable preservation, English desktop and Arabic mobile",
  );
} finally {
  await browser.close();
}
