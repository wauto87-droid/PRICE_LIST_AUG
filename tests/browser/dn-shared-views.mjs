import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import SharedViews from './frontend/dn-tracker/SharedViews';const t=(en)=>en;const meta={views:[{id:'v1',kind:'GROUP',name:'Priority customers',version:1,content:{customers:['C1']}}]};const directory={customers:[{customer_key:'C1',customer:'Alpha Company',customer_code:'001'}]};createRoot(document.getElementById('root')).render(<SharedViews meta={meta} directory={directory} filters={{view:'NOTES',include:[],exclude:[]}} t={t} close={()=>{}} refresh={()=>{}} initial={{kind:'GROUP',name:'Unsaved group',customers:[]}}/>);`,
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
  const page = await browser.newPage();
  const nativeDialogs = [];
  page.on("dialog", (dialog) => nativeDialogs.push(dialog.type()));
  await page.route("http://shared.test/**", (route) => {
    if (route.request().url().includes("/api/v1/"))
      return route.fulfill({ status: 204, body: "" });
    return route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div>',
    });
  });
  await page.goto("http://shared.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page.getByRole("button", { name: "Saved presets" }).click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Cancel" }).last().click();
  assert.equal(await page.getByLabel("Name").inputValue(), "Unsaved group");

  await page.getByRole("button", { name: "Saved presets" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Customer groups" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Cancel" }).last().click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "Discard" }).click();

  await page.getByRole("button", { name: "Delete" }).click();
  assert.match(
    await page.getByRole("alertdialog").textContent(),
    /Delete saved item/,
  );
  assert.deepEqual(nativeDialogs, []);
  console.log("PASS: shared-view edits and deletes use in-app confirmations");
} finally {
  await browser.close();
}
