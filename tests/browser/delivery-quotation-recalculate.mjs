import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx"))("esbuild");
const bundle = await build({
  stdin: {
    contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Cart from './frontend/Cart';const t=(en)=>en;const initial={id:'33333333-3333-4333-8333-333333333333',version:1,number:'DR-0037',customer:{name:'ENGINEERING',number:'',mobile:'',reference:'',notes:''},lines:[{productId:'11111111-1111-4111-8111-111111111111',partNumber:'MC-18b-AC220V',description:'Contactor',sellingLevel:'END_CUSTOMER',input:{type:'CATALOG',productId:'11111111-1111-4111-8111-111111111111',sellingLevel:'END_CUSTOMER',quantity:'1',discount:'0',override:false,reason:'',importMeta:{source:'DELIVERY_NOTE',docNo:'1614'}},price:{finalExcl:'50.00',subtotal:'50.00',vatAmount:'7.50',total:'57.50',adjustmentMode:'DISCOUNT'}},{partNumber:'ENS 504015',description:'Enclosure',input:{type:'CUSTOM',partNumber:'ENS 504015',description:'Enclosure',unit:'pcs',quantity:'1',unitPriceExcl:'0',discount:'115',importMeta:{source:'DELIVERY_NOTE',docNo:'1758',unresolved:false}},price:null}]};function App(){const[cart,setCart]=useState(initial);return <Cart t={t} user={{permissions:[]}} cart={cart} setCart={setCart} settings={{vat:'15'}} online={true} onSaved={()=>{}}/>}createRoot(document.getElementById('root')).render(<App/>);`,
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
  const requests = [];
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  await page.route("http://cart.test/**", async (route) => {
    if (!route.request().url().includes("/api/v1/"))
      return route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        finalExcl: "50.00",
        subtotal: "50.00",
        vatAmount: "7.50",
        total: "57.50",
        adjustmentMode: "DISCOUNT",
        requestedDiscount: "0",
      }),
    });
  });
  await page.goto("http://cart.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  await page
    .getByText(/Recovered the unit price for 1 imported custom item/)
    .waitFor();
  assert.equal(
    await page.getByLabel("Unit price ENS 504015").inputValue(),
    "115",
  );
  assert.equal(await page.getByLabel("Discount ENS 504015").inputValue(), "");
  await assert.doesNotReject(() =>
    page
      .getByRole("button", { name: "Update quotation" })
      .click({ trial: true }),
  );

  await page.getByRole("button", { name: "Recalculate" }).click();
  await page.getByRole("button", { name: "Update quotation" }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].productId, "11111111-1111-4111-8111-111111111111");
  assert.equal("type" in requests[0], false);
  assert.equal("importMeta" in requests[0], false);
  console.log(
    "PASS: delivery quotation repairs legacy custom price, enables save, and recalculates with a valid pricing payload",
  );
} finally {
  await browser.close();
}
