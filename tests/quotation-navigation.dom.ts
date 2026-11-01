import test from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
// DOM interaction coverage only; visual CSS acceptance is a separate browser check.
const cssHooks = registerHooks({
  load(url, context, next) {
    return url.endsWith(".css")
      ? { format: "module", source: "export default {};", shortCircuit: true }
      : next(url, context);
  },
});
const { JSDOM } = createRequire(import.meta.url)(
  process.env.QUOTATION_TEST_DOM_RUNTIME || "jsdom",
);
import { act, createElement } from "react";
import Quotations from "../frontend/Quotations";
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://quotation.test/amt_price_list/",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  SVGElement: dom.window.SVGElement,
  Element: dom.window.Element,
  Document: dom.window.Document,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  cancelAnimationFrame: clearTimeout,
  FormData: dom.window.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
});
// React DOM must detect the DOM after the fixture exists, as it does in a browser.
const { createRoot } = await import("react-dom/client");
test.after(() => {
  dom.window.close();
  cssHooks.deregister();
});
const quote = (id: string, shared = false) => ({
  id,
  number: "DR-" + id,
  version: 1,
  status: "DRAFT",
  sharedWorkflow: shared,
  workflowLinked: shared,
  selectedVersion: shared ? 1 : undefined,
  savedVersions: shared ? [{version:1}] : [],
  sharedRequestId: shared ? "request-" + id : undefined,
  customer: { name: "Synthetic buyer" },
  created_at: "2026-10-15T00:00:00Z",
  totals: { total: "10" },
  lines: [
    {
      partNumber: "SYN-1",
      description: "Test cable",
      price: {
        quantity: 1,
        finalExcl: "10",
        subtotal: "10",
        vatAmount: "0",
        total: "10",
      },
      input: { type: "CUSTOM" },
      source: "CUSTOM",
    },
  ],
});
let rows: any[] = [];
let pdfDeferred: ((r: Response) => void) | undefined;
let fetches: string[] = [];
let sharedUnavailable = false;
const json = (value: any) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
globalThis.fetch = async (input: any, init: any = {}) => {
  const path = String(input).split("/api/v1/")[1];
  fetches.push(path);
  if (sharedUnavailable && path === "shared-quotation?documentId=linked&documentOnly=1")
    return new Response(
      JSON.stringify({ error: "Synthetic ERP unavailable" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  if (path.startsWith("quotations?")) return json(rows);
  if (path === "quotation-templates")
    return json({ items: [], availableUsers: [] });
  if (path === "shared-quotation?documentId=linked&documentOnly=1")
    return json({
      requestId: "request-linked",
      requestRevision: 1,
      actorId: "owner",
      ownerId: "owner",
      branch: "test",
      items: [
        { id: "item", name: "Cable", quantity: "1", unit: "m", offers: [] },
      ],
      quotations: [
        {
          version: 1,
          customer: "Synthetic buyer",
          currency: "SAR",
          total: "10",
          subtotal: "10",
          taxTotal: "0",
          lines: [
            {
              itemId: "item",
              name: "Cable",
              quantity: "1",
              unit: "m",
              sellingPrice: "10",
            },
          ],
        },
      ],
      suppliers: [],
      orders: [],
    });
  if (path === "shared-quotation" && init.method === "POST")
    return json({ id: "shared-pdf", status: "DONE" });
  if (path === "quotations/linked/pdf?savedVersion=1") return json({id:"shared-pdf",status:"DONE"});
  if (path.endsWith("/pdf"))
    return await new Promise((resolve) => {
      pdfDeferred = resolve;
    });
  if (path.startsWith("quotations/"))
    return json(rows.find((q) => q.id === path.split("/")[1]));
  throw new Error("Unexpected mock request: " + path);
};
const tick = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
};
const click = async (label: string) => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  assert.ok(button, "Missing " + label);
  await act(async () => {
    button!.click();
  });
  await tick();
};
const props = () => ({
  t: (en: string) => en,
  user: { permissions: ["QUOTE_CREATE", "QUOTE_ISSUE"] },
  cart: { lines: [] },
  onOpen: () => {},
  onUseTemplate: () => {},
  onOpenSharedDraft: () => {},
  onOpenWorkflow: () => {
    throw new Error("Opening quotations must not auto-navigate to workflow");
  },
});
test("legacy quotation toolbar, Back and browser Forward retain the list; old PDF jobs cannot attach to another quotation", async () => {
  rows = [quote("one"), quote("two")];
  fetches = [];
  window.history.replaceState({}, "");
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(createElement(Quotations, props())));
  await tick();
  await click("Open");
  assert.equal(document.querySelectorAll("[role=dialog]").length, 1);
  for (const label of ["Edit draft", "Generate PDF", "Print view"])
    assert.ok(document.body.textContent?.includes(label));
  const dialog = document.querySelector("[role=dialog]")!;
  assert.ok(dialog.querySelector("[role=toolbar]"));
  assert.ok(
    !(
      dialog
        .querySelector("[role=toolbar]")!
        .compareDocumentPosition(dialog.querySelector(".quote-line")!) &
      dom.window.Node.DOCUMENT_POSITION_PRECEDING
    ),
  );
  await click("Generate PDF");
  assert.ok(pdfDeferred);
  await click("Back to quotations");
  await tick();
  assert.equal(document.querySelectorAll("[role=dialog]").length, 0);
  assert.ok(document.body.textContent?.includes("DR-two"));
  await act(async () => {
    window.history.forward();
  });
  // History traversal dispatches popstate asynchronously; wait for its actual
  // result rather than assuming it completes within one 15ms scheduling tick.
  for (let i = 0; i < 100 && document.querySelector('[role=dialog]')?.getAttribute('aria-label') !== 'DR-one'; i++) await tick();
  assert.equal(
    document.querySelector("[role=dialog]")?.getAttribute("aria-label"),
    "DR-one",
  );
  await click("Back to quotations");
  await tick();
  const opens = Array.from(document.querySelectorAll("button")).filter(
    (b) => b.textContent === "Open",
  );
  await act(async () => opens[1].click());
  await tick();
  assert.equal(
    document.querySelector("[role=dialog]")?.getAttribute("aria-label"),
    "DR-two",
  );
  await act(async () => pdfDeferred!(json({ id: "old-pdf", status: "DONE" })));
  await tick();
  assert.equal(document.querySelector("a[href*=old-pdf]"), null);
  await act(async () => root.unmount());
});
test("linked quotations stay in Quotations with edit, saved-version print and PDF actions", async () => {
  rows = [quote("linked", true)];
  fetches = [];
  window.history.replaceState({}, "");
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(createElement(Quotations, props())));
  await tick();
  await click("Open");
  await tick();
  for (const text of [
    "Edit draft",
    "Generate PDF",
    "Print view",
    "Back to quotations",
  ])
    assert.ok(document.body.textContent?.includes(text), "Missing " + text);
  assert.equal(
    fetches.some((p) => p.startsWith("workflow-jobs")),
    false,
  );
  const print = document.querySelector("a[href*=print]") as HTMLAnchorElement;
  assert.ok(print.href.includes("savedVersion=1"));
  await click("Generate PDF");
  assert.ok(document.querySelector("a[href*=shared-pdf]"));
  assert.equal(document.querySelector("button[aria-label=\"Close quotation\"]")?.textContent, "Close ×");
  const visible = Array.from(document.querySelectorAll("button,p")).filter(e => !e.closest("[hidden]"));
  assert.equal(visible.some(e => e.textContent?.includes("Create quotation —")), false);
  assert.equal(visible.some(e => e.textContent?.trim() === "Open workflow"), false);
  assert.equal(visible.some(e => e.textContent?.startsWith("Open this quotation from Workflow")), false);
  await act(async () => (document.querySelector("button[aria-label=\"Close quotation\"]") as HTMLButtonElement).click());
  await tick();
  assert.equal(document.querySelectorAll("[role=dialog]").length, 0);
  await act(async () => root.unmount());
});

test("ERP outage never disables local linked quotation actions or requests workflow details",async()=>{
  rows=[quote('linked',true)];fetches=[];sharedUnavailable=true;window.history.replaceState({},'');
  const root=createRoot(document.getElementById('root')!);
  try{
    await act(async()=>root.render(createElement(Quotations,props())));await tick();await click('Open');await tick();
    const generate=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Generate PDF')!;
    assert.equal(generate.disabled,false);
    assert.equal(fetches.some(p=>p.startsWith('shared-quotation')||p.startsWith('workflow-jobs')),false);
    await click('Generate PDF');assert.ok(document.querySelector('a[href*=shared-pdf]'));
  }finally{sharedUnavailable=false;await act(async()=>root.unmount());}
});

test("the actual app keeps shared editing in Quotations and returns without refresh", async () => {
  rows = [quote("linked", true)];
  fetches = [];
  window.history.replaceState({}, "");
  Object.assign(globalThis, { location: window.location });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  (window as any).matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.assign(globalThis, { matchMedia: window.matchMedia });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init: any = {}) => {
    const path = String(input).split("/api/v1/")[1];
    if (path === "auth/me")
      return json({
        user: {
          id: "pilot",
          name: "Synthetic staff",
          username: "pilot@example.invalid",
          csrf: "synthetic-token",
          permissions: ["QUOTE_CREATE", "QUOTE_ISSUE"],
        },
        settings: { allowOfflineCache: false, allowOfflineQuotes: false },
      });
    if (path === "health" || path === "health/maintenance")
      return json({ release: "synthetic", workspace: { enabled: false } });
    if (path === "ads") return json({ ads: [] });
    if (path?.startsWith("shared-quotation?documentId=linked&draft=1"))
      return json({
        ...quote("linked", true),
        sharedDocumentId: "linked",
        sharedRequestId: "request-linked",
        sharedDraftMode: "edit",
        sharedQuoteVersion: 1,
        sharedRevision: 1,
        sharedTaxBasis: "EXEMPT",
        sharedTaxRate: "0",
        workflowCurrency: "SAR",
      });
    return previousFetch(input, init);
  };
  const App = (await import("../app/page")).default;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(createElement(App)));
    await tick();
    await tick();
    await click("Quotations");
    await tick();
    await click("Open");
    await tick();
    await click("Edit draft");
    await tick();
    assert.ok(document.querySelector(".quotation-editor"));
    assert.ok(document.body.textContent?.includes("Back to quotation"));
    assert.equal(document.querySelector(".workflow-workspace"), null);
    await click("Back to quotation");
    await tick();
    assert.ok(document.querySelector("[role=dialog]"));
    await click("Back to quotations");
    await tick();
    assert.equal(document.querySelectorAll("[role=dialog]").length, 0);
    assert.ok(document.body.textContent?.includes("DR-linked"));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previousFetch;
  }
});


test("quotation preparation keeps 25 editable rows, one save toolbar and keyboard focus after errors", async () => {
  const {useState} = await import('react');
  const Cart = (await import('../frontend/Cart')).default;
  const {calculateCustom} = await import('../backend/pricing/engine');
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async(input:any, init:any={})=> {
    if(String(input).endsWith('/quotations') && init.method==='POST') return new Response(JSON.stringify({error:'Synthetic save rejected'}),{status:409,headers:{'content-type':'application/json'}});
    return previousFetch(input,init);
  };
  const initial={customer:{name:'Synthetic',number:'',mobile:'',reference:'',notes:'Retain these notes'},lines:Array.from({length:25},(_,i)=>{
    const input={type:'CUSTOM' as const,partNumber:`SYN-${i}`,description:`Synthetic item ${i}`,quantity:'1',unitPriceExcl:'10',discount:'0',unit:'pcs'};
    return {partNumber:input.partNumber,description:input.description,input,price:calculateCustom(input,'15'),pending:false};
  })};
  function Harness(){const [cart,setCart]=useState(initial);return createElement(Cart,{t:(en:string)=>en,user:{id:'synthetic',permissions:['QUOTE_CREATE']},cart,setCart,settings:{vat:'15'},online:true,onSaved:()=>{throw new Error('Failed save cannot succeed')}});}
  const root=createRoot(document.getElementById('root')!);
  try {
    await act(async()=>root.render(createElement(Harness))); await tick();
    assert.equal(document.querySelectorAll('[data-cart-row-index]').length,25);
    assert.equal(document.querySelectorAll('[aria-label="Quotation preparation actions"]').length,1);
    const table=document.querySelector('.quotation-entry-table')!;
    assert.ok(document.querySelector('[aria-label="Quotation preparation actions"]')!.compareDocumentPosition(table)&window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal((document.querySelector('.quotation-customer-extras') as HTMLDetailsElement).open,true);
    const fields=Array.from(document.querySelectorAll<HTMLInputElement>('input[data-cart-field="quantity"]'));
    fields[0].focus();
    const enter=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
    await act(async()=>fields[0].dispatchEvent(enter));
    assert.equal(enter.defaultPrevented,true);assert.equal(document.activeElement,fields[1]);
    const setValue=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;
    await act(async()=>{setValue.call(fields[1],'3');fields[1].dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
    await tick();
    await click('Save quotation');await tick();
    assert.ok(document.querySelector('[role="alert"]'));
    assert.equal((document.querySelector('input[data-cart-field="quantity"][data-cart-row="1"]') as HTMLInputElement).value,'3');
    assert.equal((document.querySelector('.cart-notes textarea') as HTMLTextAreaElement).value,'Retain these notes');
    fields.at(-1)!.focus();const lastEnter=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
    await act(async()=>fields.at(-1)!.dispatchEvent(lastEnter));assert.equal(lastEnter.defaultPrevented,true);
  }finally{await act(async()=>root.unmount());globalThis.fetch=previousFetch;}
});

test('33-item and 100-item editors retain precision, focus mode and hidden details through failed saves', async () => {
  const {useState}=await import('react');
  const Cart=(await import('../frontend/Cart')).default;
  const {calculateCustom}=await import('../backend/pricing/engine');
  const {registerConfirmHandler,resolveConfirm}=await import('../frontend/confirm');
  const previousFetch=globalThis.fetch;
  let submitted:any;
  globalThis.fetch=async(input:any,init:any={})=>{
    if(init.method==='POST' && /\/(quotations|shared-quotation)$/.test(String(input))) {
      submitted=JSON.parse(init.body);
      return new Response(JSON.stringify({error:'Synthetic administrator/customer validation failed'}),{status:422,headers:{'content-type':'application/json'}});
    }
    return previousFetch(input,init);
  };
  try {
    for(const [count,shared] of [[33,false],[100,true]] as const) {
      let refreshed=0;
      const initial:any={customer:{name:'Synthetic long customer',number:'SYN',mobile:'',reference:'Retained reference',notes:'Retained notes'},
        ...(shared?{sharedWorkflow:true,sharedQuoteVersion:1,sharedRevision:1,sharedDocumentId:'synthetic-document',sharedRequestId:'synthetic-request',workflowCurrency:'SAR',sharedTaxBasis:'EXCLUSIVE',sharedTaxRate:'15',sharedOverrideReason:''}:{}),
        lines:Array.from({length:count},(_,i)=>{const input={type:'CUSTOM' as const,partNumber:`REPEATED-${i%3}`,description:'Very long synthetic description '.repeat(8),quantity:'1',unitPriceExcl:'1.005000',discount:'0',unit:'pcs'};return {partNumber:input.partNumber,description:input.description,input,price:calculateCustom(input,'15'),pending:false,sharedItemId:`item-${i}`};})};
      function Harness(){const [cart,setCart]=useState(initial);return createElement(Cart,{t:(en:string)=>en,user:{id:'synthetic',role:'ADMIN',permissions:['QUOTE_CREATE','QUOTE_PRICE_HISTORY']},cart,setCart,settings:{vat:'15'},online:true,onReloadShared:()=>{refreshed++;},onSaved:()=>{throw Error('Failed save cannot succeed')}});}
      const root=createRoot(document.getElementById('root')!);
      try {
        await act(async()=>root.render(createElement(Harness)));await tick();
        assert.equal(document.querySelectorAll('[data-cart-row-index]').length,count);
        const details=document.querySelector('.quotation-customer-extras') as HTMLDetailsElement;
        assert.equal(details.open,true);
        await act(async()=>details.querySelector('summary')!.click());await tick();assert.equal(details.open,false);
        const price=document.querySelector('input[data-cart-field="unitPriceExcl"]') as HTMLInputElement;
        assert.equal(price.value,'1.005');
        await act(async()=>price.focus());await tick();assert.equal(price.value,'1.005000');
        await act(async()=>price.blur());await tick();assert.equal(price.value,'1.005');
        await click('Focus table');assert.ok(document.querySelector('.quotation-focus-table'));
        await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
        assert.equal(document.querySelector('.quotation-focus-table'),null);
        assert.equal(document.activeElement?.textContent,'Focus table');
        const rowActions=document.querySelector('.quotation-row-actions') as HTMLDetailsElement;
        assert.equal(rowActions.open,false);
        await act(async()=>rowActions.querySelector('summary')!.click());await tick();
        assert.equal(rowActions.open,true);assert.ok(rowActions.querySelector('button[title*="F10"]'));
        if(shared){
          let confirmation='';registerConfirmHandler(payload=>{confirmation=payload.message;});
          const customer=document.querySelector('.quotation-customer-fields input') as HTMLInputElement;
          const setValue=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;
          await act(async()=>{setValue.call(customer,'Retained changed customer');customer.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});await tick();
          await click('Refresh prices and version');assert.match(confirmation,/Unsaved quotation edits/);
          await act(async()=>resolveConfirm(false));await tick();assert.equal(refreshed,0);assert.equal(customer.value,'Retained changed customer');
          await click('Refresh prices and version');await act(async()=>resolveConfirm(true));await tick();assert.equal(refreshed,1);
          registerConfirmHandler(null);
        }
        await click(shared?'Save quotation version':'Save quotation');await tick();
        assert.ok(document.querySelector('[role=alert]'));assert.equal(details.open,true);
        assert.equal(document.querySelectorAll('[data-cart-row-index]').length,count);
        assert.equal((document.querySelector('.cart-notes textarea') as HTMLTextAreaElement).value,'Retained notes');
        assert.equal(shared?submitted.lines[0].sellingPrice:submitted.lines[0].unitPriceExcl,'1.005000');
      } finally { await act(async()=>root.unmount()); }
    }
  } finally {registerConfirmHandler(null);globalThis.fetch=previousFetch;}
});

test('responsive table preserves selection, sort actions and complete columns', async()=>{
  const {useState}=await import('react');
  const ResponsiveTable=(await import('../frontend/ResponsiveTable')).default;
  function Harness(){const [selected,setSelected]=useState(false);const [ascending,setAscending]=useState(true);return createElement(ResponsiveTable,{'aria-label':'Synthetic inventory'},
    createElement('thead',null,createElement('tr',null,createElement('th',null,'Select'),createElement('th',null,createElement('button',{onClick:()=>setAscending(x=>!x)},'Sort item')))),
    createElement('tbody',null,(ascending?['Part A','Part B']:['Part B','Part A']).map(part=>createElement('tr',{key:part},createElement('td',null,createElement('input',{type:'checkbox','aria-label':'Select '+part,checked:selected,onChange:e=>setSelected(e.currentTarget.checked)})),createElement('td',null,part)))));
  }
  const root=createRoot(document.getElementById('root')!);
  try{
    await act(async()=>root.render(createElement(Harness)));await tick();
    const region=document.querySelector('.responsive-table-region')!;
    assert.equal(region.getAttribute('role'),'region');assert.equal(region.getAttribute('tabindex'),'0');assert.equal(region.getAttribute('aria-label'),'Synthetic inventory');
    assert.equal(region.querySelectorAll('tbody tr').length,2);assert.equal(region.querySelectorAll('tbody td').length,4);
    await act(async()=>(region.querySelector('input') as HTMLInputElement).click());await tick();assert.equal((region.querySelector('input') as HTMLInputElement).checked,true);
    await click('Sort item');assert.equal(region.querySelector('tbody tr td:nth-child(2)')?.textContent,'Part B');
  }finally{await act(async()=>root.unmount());}
});

test('ordinary and linked quotation rows retain identities, colours, focus and exact save order through arrows and keyboard drag', async()=>{
  const {useState}=await import('react');
  const Cart=(await import('../frontend/Cart')).default;
  const {calculateCustom}=await import('../backend/pricing/engine');
  const previousRect=dom.window.HTMLElement.prototype.getBoundingClientRect;
  const previousFetch=globalThis.fetch;
  // Synthetic geometry exercises sensors, not rendered-layout acceptance.
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
    const row=this.closest('[data-cart-row-index]') || ((this.matches('.quotation-drag-preview') || this.firstElementChild?.matches('.quotation-drag-preview')) ? document.querySelector('tr[data-dragging]') : null);
    const index=Number(row?.getAttribute('data-cart-row-index')||0);
    const y=row?index*48:0;
    return {x:0,y,top:y,bottom:y+(row?48:480),left:0,right:720,width:720,height:row?48:480,toJSON(){return {};}};
  };
  dom.window.requestAnimationFrame=globalThis.requestAnimationFrame;
  dom.window.cancelAnimationFrame=globalThis.cancelAnimationFrame;
  dom.window.scrollTo=()=>{};
  let submitted:any;
  globalThis.fetch=async(input:any,init:any={})=>{
    if (/\/(quotations|shared-quotation)$/.test(String(input)) && init.method==='POST') {
      submitted=JSON.parse(init.body);
      return new Response(JSON.stringify({error:'Synthetic failed save'}),{status:422,headers:{'content-type':'application/json'}});
    }
    return previousFetch(input,init);
  };
  const key=async(target:Element,code:string)=>{
    await act(async()=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:code==='Space'?' ':code,code,bubbles:true,cancelable:true})));
    await tick();
  };
  try{
    for(const [count,shared] of [[33,false],[100,true]] as const){
      let current:any;
      const initial={customer:{name:'Synthetic buyer',number:'SYN',notes:'Keep notes'},...(shared?{sharedWorkflow:true,sharedDocumentId:'synthetic-document',sharedRequestId:'synthetic-request',sharedRevision:1,sharedQuoteVersion:0,sharedTaxBasis:'EXCLUSIVE',sharedTaxRate:'15',workflowCurrency:'SAR',sharedCanonicalTotals:{subtotal:'100.00',vat:'15.00',total:'115.00'}}:{}),lines:Array.from({length:count},(_,i)=>{
        const input={type:'CUSTOM' as const,partNumber:`DUP-${i%6}`,description:`Unique row ${i} `+'long description '.repeat(5),quantity:String(i+1),unitPriceExcl:'1.005001',discount:'0',unit:'pcs'};
        return {input,partNumber:input.partNumber,description:input.description,price:calculateCustom(input,'15'),sharedItemId:`item-${i}`,pending:false};
      })};
      function Harness(){const [cart,setCart]=useState(initial);current=cart;return createElement(Cart,{t:(en:string)=>en,user:{id:'synthetic',permissions:['QUOTE_CREATE']},cart,setCart,settings:{vat:'15'},online:true,onSaved:()=>{throw Error('Synthetic save must fail')}});}
      const root=createRoot(document.getElementById('root')!);
      try{
        await act(async()=>root.render(createElement(Harness)));await tick();
        const rows=()=>Array.from(document.querySelectorAll('[data-cart-row-index]'));
        const first=rows()[0], id=first.getAttribute('data-row-id'), colour=first.className;
        const originalTotal=document.querySelector('.editor-total')!.textContent;
        assert.equal(new Set(rows().map(row=>row.className)).size,6);
        assert.match(first.textContent||'',/Repeated/);
        const itemDetails=first.querySelector('.quotation-line-options') as HTMLDetailsElement;
        await act(async()=>itemDetails.querySelector('summary')!.click());await tick();assert.equal(itemDetails.open,true);
        const customerDetails=document.querySelector('.quotation-customer-extras') as HTMLDetailsElement;
        assert.equal(customerDetails.open,true);
        await click('Focus table');await click('Exit focus');assert.equal(customerDetails.open,true);
        await act(async()=>customerDetails.querySelector('summary')!.click());await tick();assert.equal(customerDetails.open,false);
        const arrow=first.querySelector('button[title="Move down"]') as HTMLButtonElement;
        await act(async()=>{arrow.focus();arrow.click();});await tick();
        assert.equal(rows()[1],first);assert.equal(first.className,colour);assert.equal(itemDetails.open,true);assert.equal(document.activeElement,arrow);
        assert.equal(current.lines[1],initial.lines[0]);if(shared)assert.equal(current.sharedDirty,true);
        assert.equal(document.querySelector('.editor-total')!.textContent,originalTotal);
        assert.equal(customerDetails.open,false);
        // Keyboard drop moves the complete stable row; Space does not submit.
        const handle=first.querySelector('.quotation-drag-handle') as HTMLButtonElement;
        await act(async()=>handle.focus());
        await key(handle,'Space');assert.ok(document.querySelector('.quotation-drag-preview'));
        await key(handle,'ArrowDown');
        await key(handle,'Space');
        assert.equal(rows()[2].getAttribute('data-row-id'),id,JSON.stringify(current.lines.slice(0,6).map((l:any)=>l.sharedItemId)));assert.equal(current.lines[2],initial.lines[0]);
        assert.equal(first.className,colour);assert.equal(itemDetails.open,true);
        const beforeCancel=[...current.lines];
        await click('Focus table');
        await key(handle,'Space');await key(handle,'ArrowDown');await key(handle,'Escape');
        assert.deepEqual(current.lines,beforeCancel);assert.equal(document.querySelector('.quotation-drag-preview'),null);
        assert.ok(document.querySelector('.quotation-focus-table'),'Cancelling a drag keeps focus mode');
        await click('Exit focus');
        // Mouse dragging uses the handle, with an insertion marker before drop.
        const mouse=async(target:EventTarget,type:string,y:number)=>{await act(async()=>target.dispatchEvent(new dom.window.MouseEvent(type,{clientX:20,clientY:y,button:0,buttons:type==='mouseup'?0:1,bubbles:true,cancelable:true})));await tick();};
        await mouse(handle,'mousedown',120);await mouse(document,'mousemove',24);await mouse(document,'mousemove',24);
        assert.ok(document.querySelector('.quotation-drag-preview'));assert.ok(document.querySelector('[data-drop-position]'));
        await mouse(document,'mouseup',24);assert.equal(current.lines[0],initial.lines[0]);assert.equal(rows()[0],first);
        // Touch hold activates only the handle; cancellation does not reorder.
        const touch=async(type:string)=>{const point={identifier:1,target:handle,clientX:20,clientY:24,pageX:20,pageY:24};await act(async()=>handle.dispatchEvent(new dom.window.TouchEvent(type,{touches:type==='touchcancel'?[]:[point],changedTouches:[point],bubbles:true,cancelable:true})));await tick();};
        const beforeTouch=[...current.lines];await touch('touchstart');assert.equal(document.querySelector('.quotation-drag-preview'),null);
        await act(async()=>new Promise(resolve=>setTimeout(resolve,270)));await tick();assert.ok(document.querySelector('.quotation-drag-preview'));
        await touch('touchcancel');assert.deepEqual(current.lines,beforeTouch);assert.equal(document.querySelector('.quotation-drag-preview'),null);
        assert.equal(document.querySelector('.editor-total')!.textContent,originalTotal);
        // Saving uses existing payloads in the chosen order, with no editor IDs.
        await click(shared?'Convert to quotation':'Save quotation');await tick();
        assert.ok(document.querySelector('[role=alert]'));assert.equal(customerDetails.open,true);
        assert.deepEqual(submitted.lines.map((l:any)=>shared?l.itemId:l.description),current.lines.map((l:any)=>shared?l.sharedItemId:l.input.description));
        assert.ok(submitted.lines.every((l:any)=>(shared?l.sellingPrice:l.unitPriceExcl)==='1.005001'));
        assert.doesNotMatch(JSON.stringify(submitted),/quotation-row-/);
      }finally{await act(async()=>root.unmount());}
    }
  }finally{dom.window.HTMLElement.prototype.getBoundingClientRect=previousRect;globalThis.fetch=previousFetch;}
});
