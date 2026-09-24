import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import DNTracker from './frontend/dn-tracker/DNTracker';const t=(en)=>en;createRoot(document.getElementById('root')).render(<DNTracker t={t} user={{permissions:['DN_TRACKER_VIEW','DN_TRACKER_EDIT']}}/>);`,
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
    }),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("http://switch.test/**", async (route) => {
    const url = route.request().url();
    if (!url.includes("/api/v1/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    let body;
    if (url.includes("/metadata"))
      body = {
        reports: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "DN report",
            version: 1,
            current_snapshot: "s",
            report_date: "2026-09-24",
          },
        ],
        views: [],
        users: [],
      };
    else if (url.includes("/directory/"))
      body = { customers: [], snapshots: [] };
    else if (url.includes("/list")) {
      const request = route.request().postDataJSON(),
        view = request.view;
      requests.push(request);
      if (view === "CUSTOMERS") await new Promise((r) => setTimeout(r, 450));
      if (view === "NOTES") await new Promise((r) => setTimeout(r, 20));
      body = {
        filters: { ...request },
        report: { id: request.reportId },
        summary: { customers: 1, unbilled: 1, lines: 1, aged: 0 },
        counts: [],
        total: 1,
        page: 0,
        rows:
          view === "CUSTOMERS"
            ? [
                {
                  customer_key: "C",
                  customer: "Late customer summary",
                  notes: 1,
                  unbilled: 1,
                  outstanding: 1,
                  oldest: "2026-09-01",
                  updated_at: "2026-09-01",
                },
              ]
            : view === "NOTES"
              ? [
                  {
                    id: "n1",
                    doc_no: "DN-1",
                    customer: "Correct delivery note",
                    doc_date: "2026-09-01",
                    billing: "FUTURE_STATUS",
                    stage: "READY",
                    outstanding: 1,
                  },
                ]
              : view === "LINES"
                ? [
                    {
                      note_id: "n1",
                      row: 2,
                      doc_no: "DN-1",
                      doc_date: "2026-09-01",
                      customer: "Correct delivery note",
                      itemCode: "ITEM-1",
                      itemName: "Test item",
                      unit: "PCS",
                      qty: "2",
                      invoiced: "0",
                      invoiceRet: "0",
                      deliveryRet: "0",
                      balance: "2",
                      billing: "NOT_INVOICED",
                      stage: "READY",
                    },
                  ]
                : [],
      };
    } else throw new Error(url);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("http://switch.test/");
  await page.addStyleTag({
    content:
      (await fs.readFile("app/globals.css", "utf8")) +
      "\n" +
      (await fs.readFile("frontend/dn-tracker/tracker.css", "utf8")),
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "Customers", exact: true }).click();
  await page.waitForTimeout(230);
  await page
    .getByRole("button", { name: "Delivery notes", exact: true })
    .click();
  await page.getByText("Correct delivery note").waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.getByText("Correct delivery note").count(), 1);
  assert.equal(await page.getByText("Late customer summary").count(), 0);
  assert.equal(await page.getByText("Unknown billing status").count(), 1);
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "File rows", exact: true }).click();
  await page.getByText("ITEM-1").waitFor();
  await page.getByRole("button", { name: /Qty ↕/ }).click();
  await page.waitForFunction(() =>
    document.querySelector("[role=status]")?.textContent?.includes("1 results"),
  );
  assert.equal(requests.at(-1).view, "LINES");
  assert.equal(requests.at(-1).sort, "qty");
  assert.equal(requests.at(-1).direction, "asc");
  await page
    .getByRole("button", { name: "All imported rows", exact: true })
    .click();
  await page.getByText("ITEM-1").waitFor();
  assert.equal(requests.at(-1).billing, "ALL");
  console.log(
    "PASS: stale response ignored, unknown status safe, file rows render and sort",
  );
} finally {
  await browser.close();
}
