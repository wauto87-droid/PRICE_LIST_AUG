import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const bundle = await build({ stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Cart from './frontend/Cart';
function App(){const[cart,setCart]=useState({customer:{name:'Al Noor Trading',number:'C-1042',mobile:'+966 50 000 0000',reference:'REF-1024',notes:''},lines:[]});window.testCart=cart;window.setTestCart=setCart;return <><header className="app-header"><a className="brand"><img src="/logo.svg" alt="AMT Electric"/><span><strong>AMT <em>ELECTRIC</em></strong><small>PRICE LIST & QUOTATIONS</small></span></a><span>Quotation entry verification</span></header><nav className="main-nav"><button>Lookup</button><button className="active">Quotations</button><button>Customers</button></nav><main><div className="workspace-side"><Cart t={(en)=>en} user={{id:'owner',permissions:['QUOTE_CREATE','QUOTE_EDIT','QUOTE_PRICE_HISTORY']}} cart={cart} setCart={setCart} settings={{vat:'15'}} online={true} onSaved={()=>{}}/></div></main></>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', platform: 'browser', loader: { '.css': 'empty' } });
const catalog = { id:'11111111-1111-4111-8111-111111111111', partNumber:'CAB-2.5', description:'Copper cable 2.5 mm', unit:'m', quantityPrecision:3, defaultLevel:'RETAIL', masterExcl:'45', sellingLevels:[{code:'RETAIL',masterExcl:'45',method:'FIXED'}] };
const saved = [{ id:'22222222-2222-4222-8222-222222222222', reference:'BRKT-01', description:'Custom cable mounting bracket', unit:'pcs', suggestedUnitPrice:'12.50', suggestedDiscount:'0' }];
const css = (await fs.readFile('app/globals.css','utf8')).replace(/^@import[^;]+;/gm,'') + '\n' + await fs.readFile('frontend/quotation-normal.css','utf8');
const browser = await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page = await browser.newPage({viewport:{width:1280,height:768},hasTouch:true});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
let submitted;
let failedSave = false;
const price = input => { const unit=Number(input.targetFinalExcl || 45);const subtotal=unit*Number(input.quantity);return { quantity:input.quantity, finalExcl:unit.toFixed(2), requestedDiscount:input.discount || '0', subtotal:subtotal.toFixed(2), vatAmount:(subtotal*.15).toFixed(2), total:(subtotal*1.15).toFixed(2), sellingLevel:input.sellingLevel, adjustmentMode:'DISCOUNT' }; };
await page.route('http://localhost/**',async route=>{
  const url=new URL(route.request().url());
  const json=async(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(url.pathname==='/logo.svg') return route.fulfill({contentType:'image/svg+xml',body:await fs.readFile('public/logo.svg','utf8')});
  if(!url.pathname.includes('/api/v1/')) return route.fulfill({contentType:'text/html',body:'<div id="root" style="display:contents"></div>'});
  const path=url.pathname.split('/api/v1/')[1],q=(url.searchParams.get('q')||'').toLowerCase();
  if(path==='search' || path==='reusable-custom-items') {
    if(q==='fail' && path==='reusable-custom-items') return json({error:'Saved-item search unavailable'},503);
    if(q==='slow') {await new Promise(resolve=>setTimeout(resolve,650));try{return await json(path==='search'?[{...catalog,partNumber:'STALE-SLOW'}]:[]);}catch{return;}}
    return json(path==='search' ? (q && (catalog.partNumber+' '+catalog.description).toLowerCase().includes(q)?[catalog]:[]) : saved.filter(item=>q && (item.reference+' '+item.description).toLowerCase().includes(q)));
  }
  if(path==='reusable-custom-items/resolve') {const body=route.request().postDataJSON();return json({match:saved.find(item=>item.reference.toLowerCase()===body.reference.toLowerCase() || item.description.toLowerCase()===body.description.toLowerCase()) || null});}
  if(path==='pricing' || path==='pricing/target') return json(price(route.request().postDataJSON()));
  if(path==='customers') return json([]);
  if(path==='quotation-previous-prices') return json({results:[],summary:{matched:0,adjusted:0,notFound:0,invalid:0}});
  if(path.startsWith('quotations')) {
    submitted=route.request().postDataJSON();
    if(failedSave) return json({error:'Synthetic save failure'},503);
    for(const line of submitted.lines.filter(item=>item.type==='CUSTOM')) if(!saved.some(item=>item.reference===line.partNumber)) saved.push({id:crypto.randomUUID(),reference:line.partNumber,description:line.description,unit:line.unit,suggestedUnitPrice:line.unitPriceExcl,suggestedDiscount:line.discount});
    return json({id:'33333333-3333-4333-8333-333333333333',number:'DR-0042',version:1,lines:await page.evaluate(()=>window.testCart.lines),totals:{total:'0'}});
  }
  return json([]);
});
const lines = ()=>page.evaluate(()=>window.testCart.lines);
const waitCount=async count=>page.waitForFunction(n=>window.testCart.lines.length===n,count);
const rowSearch = n=>page.getByRole('combobox',{name:`Item search ${n}`,exact:true});
const draft=()=>page.locator('[data-entry-draft]');
const chooseFirst=async search=>{await search.press('ArrowDown');await search.press('Enter');};
try {
  await page.goto('http://localhost/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
  await draft().waitFor();assert.equal(await page.locator('thead th').count(),9);assert.equal(await draft().count(),1);
  assert.equal(await page.locator('.quotation-drag-handle').count(),0);
  // Unified search, keyboard selection and quantity-driven addition retain focus.
  await rowSearch(1).fill('cable');await page.getByRole('option').filter({hasText:'Catalogue'}).waitFor();
  assert.equal(await page.getByRole('option').filter({hasText:'Saved custom'}).count(),1);
  await chooseFirst(rowSearch(1));assert.equal((await lines()).length,0);
  await page.getByLabel('New item quantity',{exact:true}).fill('2');await waitCount(1);
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-cart-field')==='quantity');
  assert.equal(await draft().count(),1);assert.equal((await lines())[0].input.quantity,'2');
  const qty=page.locator('[data-cart-field="quantity"][data-cart-row="0"]');
  await qty.fill('0');await page.waitForFunction(()=>!document.querySelector('[data-entry-draft]'));
  await qty.fill('2');await draft().waitFor();
  // Typing or cancelling a replacement leaves the saved item intact.
  await rowSearch(1).fill('brkt');await page.locator('.quotation-search-popup [role=option]').waitFor();await rowSearch(1).press('Escape');
  assert.equal((await lines())[0].partNumber,'CAB-2.5');assert.equal(await rowSearch(1).inputValue(),'CAB-2.5');
  await rowSearch(1).fill('brkt');await page.locator('.quotation-search-popup [role=option]').waitFor();await page.locator('.quotation-search-popup [role=option]').tap();
  await page.waitForFunction(()=>window.testCart.lines[0].input.type==='CUSTOM');assert.equal((await lines())[0].input.quantity,'2');
  // Stale responses and clearing input cannot revive obsolete choices.
  await rowSearch(2).fill('slow');await page.waitForTimeout(220);await rowSearch(2).fill('cable');
  await page.getByRole('option').filter({hasText:'Catalogue'}).waitFor();await page.waitForTimeout(700);
  assert.equal(await page.getByText('STALE-SLOW',{exact:true}).count(),0);
  await rowSearch(2).fill('');await page.waitForTimeout(250);assert.equal(await page.getByRole('listbox').count(),0);
  // A failed source is an error, never a no-match/custom-create offer.
  await rowSearch(2).fill('fail');await page.getByText('Saved-item search unavailable',{exact:true}).waitFor();
  assert.equal(await page.getByRole('option',{name:/Add custom item/}).count(),0);
  // Inline custom creation, validation and duplicate resolution.
  await rowSearch(2).fill('CUST-X');await page.getByRole('option',{name:/Add custom item/}).click();
  let form=page.getByRole('group',{name:'New custom item'});await form.waitFor();
  await form.getByRole('button',{name:'Add & reuse'}).click();await form.getByText('Enter an item description.',{exact:true}).waitFor();
  await form.getByLabel('Description',{exact:true}).fill('Custom mounting plate');await form.getByLabel('Unit price excl. VAT',{exact:true}).fill('25');
  await form.getByRole('button',{name:'Add & reuse'}).click();await waitCount(2);assert.equal(await draft().count(),1);
  await rowSearch(3).fill('NEW-REF');await page.getByRole('option',{name:/Add custom item/}).click();form=page.getByRole('group',{name:'New custom item'});
  await form.getByLabel('Description',{exact:true}).fill(saved[0].description);await form.getByLabel('Unit price excl. VAT',{exact:true}).fill('99');
  await form.getByRole('button',{name:'Add & reuse'}).click();await form.getByRole('button',{name:'Use saved item'}).click();await waitCount(3);
  assert.equal((await lines())[2].input.unitPriceExcl,'12.50');assert.equal((await lines())[2].input.reusableItemId,saved[0].id);
  // All real rows, including custom and repeated items, retain sortable handles.
  assert.equal(await page.locator('.quotation-drag-handle').count(),3);assert.equal(await page.locator('.duplicate-line').count(),2);
  const original=(await lines()).map(line=>line.description);
  const firstHandle=page.locator('.quotation-drag-handle').first();await firstHandle.focus();await firstHandle.press('Space');await firstHandle.press('ArrowDown');await page.waitForTimeout(100);await firstHandle.press('Space');
  await page.waitForFunction(first=>window.testCart.lines[0].description!==first,original[0]);
  assert.deepEqual((await lines()).map(line=>line.description),[original[1],original[0],original[2]]);
  // Failed saves retain data; successful save contains only real rows and makes custom items searchable.
  failedSave=true;await page.getByRole('button',{name:'Save quotation',exact:true}).click();await page.getByRole('alert').filter({hasText:'Synthetic save failure'}).waitFor();assert.equal((await lines()).length,3);
  failedSave=false;await page.getByRole('button',{name:'Save quotation',exact:true}).click();await page.waitForFunction(()=>window.testCart.number==='DR-0042');
  assert.equal(submitted.lines.length,3);assert.equal(JSON.stringify(submitted).includes('quotation-row-'),false);
  await rowSearch(4).fill('CUST-X');await page.getByRole('option').filter({hasText:'Saved custom'}).waitFor();await chooseFirst(rowSearch(4));
  await page.getByLabel('New item quantity',{exact:true}).fill('1');await waitCount(4);
  assert.equal((await lines())[3].input.unitPriceExcl,'25');
  // Real screenshots and responsive overflow checks; no document-wide horizontal overflow.
  await fs.mkdir('test-results/quotation-normal-entry',{recursive:true});
  await page.screenshot({path:'test-results/quotation-normal-entry/normal-1280.png',fullPage:true});
  await rowSearch(5).fill('cable');await page.getByRole('option').filter({hasText:'Catalogue'}).waitFor();
  const anchor=await rowSearch(5).boundingBox(),popup=await page.locator('.quotation-search-popup').boundingBox();
  assert.ok(Math.min(Math.abs(popup.y+popup.height-anchor.y),Math.abs(popup.y-anchor.y-anchor.height))<=6,'Search popup stays attached to the active row');
  await page.screenshot({path:'test-results/quotation-normal-entry/normal-search-1280.png',fullPage:true});await rowSearch(5).press('Escape');
  await rowSearch(5).fill('UNLISTED');await page.getByRole('option',{name:/Add custom item/}).click();
  await page.getByRole('group',{name:'New custom item'}).waitFor();
  await page.screenshot({path:'test-results/quotation-normal-entry/normal-inline-custom-1280.png',fullPage:true});
  await page.getByRole('group',{name:'New custom item'}).getByRole('button',{name:'Cancel',exact:true}).click();
  await page.setViewportSize({width:1920,height:1080});await page.screenshot({path:'test-results/quotation-normal-entry/normal-1920.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.equal(await page.locator('.responsive-table-region').evaluate(el=>el.scrollWidth>el.clientWidth),true);
  await page.screenshot({path:'test-results/quotation-normal-entry/normal-mobile.png',fullPage:true});
  // Focus keeps the original six-column editor, controls and sortable rows.
  await page.setViewportSize({width:1280,height:768});await page.getByRole('button',{name:'Focus table',exact:true}).click();
  assert.equal(await page.locator('thead th').count(),6);assert.equal(await page.getByRole('combobox',{name:/Item search/}).count(),0);
  assert.equal(await page.locator('.quotation-drag-handle').count(),4);await page.screenshot({path:'test-results/quotation-normal-entry/focused-1280.png',fullPage:true});
  await page.getByRole('button',{name:'Exit focus',exact:true}).click();
  // Linked quotations retain their existing identity restrictions.
  await page.evaluate(()=>window.setTestCart({...window.testCart,sharedWorkflow:true,sharedDocumentId:'linked',sharedTaxBasis:'EXCLUSIVE',sharedTaxRate:'15',workflowCurrency:'SAR',lines:window.testCart.lines.map((line,index)=>({...line,sharedItemId:'shared-'+index}))}));
  await page.waitForFunction(()=>!document.querySelector('[data-entry-draft]'));
  assert.equal(await page.getByRole('combobox',{name:/Item search/}).count(),0);assert.equal(await page.locator('.quotation-drag-handle').count(),4);
  assert.deepEqual(errors,[]);
  console.log('PASS: unified search, quantity/focus, replacement, stale results, inline custom/dedup/reuse, save failure, keyboard dragging, responsive layouts, focused and linked modes');
} catch (error) {
  await fs.mkdir('test-results/quotation-normal-entry',{recursive:true});
  await page.screenshot({path:'test-results/quotation-normal-entry/failure.png',fullPage:true});
  console.error('Browser fixture state:', await page.evaluate(()=>({alerts:Array.from(document.querySelectorAll('[role=alert]')).map(el=>el.textContent),lines:window.testCart.lines.length,text:document.body.innerText.slice(-1800)})), 'Submitted:',submitted,'Page errors:',errors);
  throw error;
} finally {await browser.close();}
