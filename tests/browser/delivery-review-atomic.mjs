import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Review from './frontend/DeliveryQuoteImport';createRoot(document.getElementById('root')).render(<Review t={en=>en} user={{permissions:['QUOTE_CREATE','QUOTE_VIEW_ALL']}} online onImported={value=>window.imported=value}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',platform:'browser'});
const id=randomUUID(),rows=Array.from({length:105},(_,index)=>({id:randomUUID(),row_number:index+1,action:index<17?'REMOVE':'ADD',completed:index>=17,resolution:'UNMATCHED_CUSTOM',raw:{},issues:[],line_input:{partNumber:'ITEM-'+(index+1),description:'Item '+(index+1),quantity:'1',unitPriceExcl:'5'}}));
let version=7, reviews=0, finalizations=0, conflict=false, active=0, maxActive=0, submitted;
const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const page=await browser.newPage({viewport:{width:1280,height:768}});
try {
 await page.route('http://review.test/**',async route=>{
  const url=new URL(route.request().url()),json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(!url.pathname.includes('/api/v1/'))return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});
  const path=url.pathname.split('/api/v1/')[1];
  if(path==='delivery-quote-imports')return json(url.searchParams.has('scope')?{items:[],total:0,totalPages:1,page:0,pageSize:20}:[{id,filename:'1533.XLS',status:'AWAITING_REVIEW'}]);
  if(route.request().method()==='GET') {const page=Number(url.searchParams.get('page')||0);return json({id,version,status:'AWAITING_REVIEW',filename:'1533.XLS',mapping:{},header:{customerName:'ACME',docNos:['KEPT']},summary:{totalRows:105,includedRows:88,removedRows:17,blockedRows:0,docNos:['KEPT']},rows:rows.slice(page*50,(page+1)*50),resultCount:105,page,pageSize:50});}
  active++;maxActive=Math.max(active,maxActive);await new Promise(resolve=>setTimeout(resolve,120));
  const body=route.request().postDataJSON(); if (!body) throw Error(route.request().method()+' '+path);
  try {
   if(conflict){conflict=false;version++;return await json({error:'Import changed. Reload'},409);}
   assert.equal(body.version,version);
   if(path.endsWith('/review')){reviews++;for(const rowId of body.rowIds){const row=rows.find(value=>value.id===rowId);if(body.action)row.action=body.action==='REMOVE'?'REMOVE':'ADD';Object.assign(row.line_input,body.rowUpdates?.[rowId]);}return await json({ok:true,version:++version});}
   if(path.endsWith('/finalize')){finalizations++;submitted=body;return await json({id:'quote',lines:rows.filter(row=>row.action==='ADD')});}
   throw Error(path);
  }finally{active--;}
 });
 await page.goto('http://review.test');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByRole('button',{name:'Upload / review files',exact:true}).click();await page.getByRole('button',{name:'1533.XLS · AWAITING_REVIEW',exact:true}).click();
 const first=()=>page.locator('tbody tr').first();
 await first().locator('td').nth(5).locator('input').fill('3');
 await page.getByRole('button',{name:'Next',exact:true}).first().click();await page.getByText('Page 2 / 3 (105 rows)',{exact:true}).first().waitFor();
 await first().locator('td').nth(5).locator('input').fill('9');
 await page.getByRole('button',{name:'Previous',exact:true}).first().click();await page.getByText('Page 1 / 3 (105 rows)',{exact:true}).first().waitFor();assert.equal(await first().locator('td').nth(5).locator('input').inputValue(),'3');
 conflict=true;await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText(/Latest rows loaded; your unsaved values are retained/).waitFor();assert.equal(await first().locator('td').nth(5).locator('input').inputValue(),'3');
 await page.getByRole('button',{name:'Create quotation',exact:true}).click();await page.waitForFunction(()=>window.imported?.id==='quote');
 assert.equal(reviews,0,'Creation does not make a separate review request');assert.equal(finalizations,1);assert.equal(submitted.rowUpdates[rows[0].id].quantity,'3');assert.equal(submitted.rowUpdates[rows[50].id].quantity,'9');assert.equal(maxActive,1);
 console.log('PASS: 105 rows, pagination retains edits, conflict reload retains edits, creation submits one atomic request');
}finally{await browser.close();}


