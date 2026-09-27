import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import DeliveryQuoteImport from './frontend/DeliveryQuoteImport';const t=(en)=>en;createRoot(document.getElementById('root')).render(<DeliveryQuoteImport t={t} user={{permissions:[]}} online={true} onImported={()=>{}}/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  platform: "browser",
  loader: { ".css": "empty" },
});

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.TEST_BROWSER ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  const errors = [];
  const urls = [];
  let uploadRequest;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost/**", async (route) => {
    const request = route.request();
    const url = request.url();
    urls.push(url);
    if (!url.includes("/api/v1/")) {
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    }
    if (url.endsWith("/delivery-quote-imports/upload")) {
      uploadRequest = {
        headers: request.headers(),
        body: request.postDataBuffer(),
      };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }),
      });
    }
    if (
      url.includes(
        "/delivery-quote-imports/11111111-1111-4111-8111-111111111111",
      )
    ) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          status: "MAPPING",
          version: 2,
          progress: { phase: "MAPPING", percentage: 42 },
          summary: { columns: [] },
          rows: [],
        }),
      });
    }
    const body = url.includes("scope=converted")
      ? { items: [], page: 0, pageSize: 20, total: 0, totalPages: 1 }
      : [];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.goto("http://localhost/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "Upload / review files" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "delivery sample.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Document No\n01-01-2026,DN-1\n"),
  });

  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Matching products and prices"),
      undefined,
      { timeout: 8000 },
    );
  } catch (error) {
    throw new Error(
      `${error.message}\nRequests:\n${urls.join("\n")}\nPage:\n${await page.locator("body").innerText()}`,
    );
  }
  assert.equal(
    uploadRequest.headers["content-type"],
    "application/octet-stream",
  );
  assert.equal(
    decodeURIComponent(uploadRequest.headers["x-amt-filename"]),
    "delivery sample.csv",
  );
  assert.match(uploadRequest.headers["x-amt-upload-id"], /^[0-9a-f-]{36}$/);
  assert.equal(
    uploadRequest.body.toString(),
    "Date,Document No\n01-01-2026,DN-1\n",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: delivery upload streams raw bytes with idempotency metadata and shows mapping progress",
  );
} finally {
  await browser.close();
}
