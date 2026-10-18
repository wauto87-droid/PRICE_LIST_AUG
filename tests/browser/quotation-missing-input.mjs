import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const bundle = await build({
  stdin: {
    contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Cart from './frontend/Cart';const t=(en)=>en;const initial={customer:{name:'Legacy buyer',number:'',mobile:'',reference:'',notes:''},lines:[{source:'CATALOG',productId:'11111111-1111-4111-8111-111111111111',partNumber:'LEGACY-1',description:'Legacy catalog line',sellingLevel:'RETAIL',price:{quantity:'2',requestedDiscount:'0',finalExcl:'50.00',subtotal:'100.00',vatAmount:'15.00',total:'115.00'}},{partNumber:'UNKNOWN-1',description:'Identity was not saved',price:{quantity:'1',finalExcl:'10.00',subtotal:'10.00',vatAmount:'1.50',total:'11.50'}}]};function App(){const[cart,setCart]=useState(initial);return <Cart t={t} user={{id:'owner',permissions:[]}} cart={cart} setCart={setCart} settings={{vat:'15'}} online={true} onSaved={()=>{}}/>}createRoot(document.getElementById('root')).render(<App/>);`,
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://localhost/**", async (route) => {
    if (!route.request().url().includes("/api/v1/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sellingLevel: "RETAIL",
        quantity: "2",
        requestedDiscount: "0",
        finalExcl: "50.00",
        subtotal: "100.00",
        vatAmount: "15.00",
        total: "115.00",
      }),
    });
  });
  await page.goto("http://localhost/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page
    .getByText("Legacy catalog line", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.getByLabel("Selling level LEGACY-1").inputValue(),
    "RETAIL",
  );
  await page.getByText(/missing its catalog or custom-item identity/).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Save quotation" }).isDisabled(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: quotation editor normalizes legacy catalog lines and blocks ambiguous saved rows without crashing",
  );
} finally {
  await browser.close();
}
