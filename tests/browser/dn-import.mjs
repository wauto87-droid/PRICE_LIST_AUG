import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx'))('esbuild');
const headers=['Date','Document No','Cust.Name','Item Code','Item Name','Unit','Qty','Invoiced','Invoice Returned','Delivery Returned','Balance'];
const values=['2026-09-17','1822','JEDDAH CABLE-COMPANY','HEATER PLUG 2 PIN','HEATER PLUG 2 PIN','PCS','5','0','0','0','5'];
const row={row:537,date:values[0],docNo:'1822',customer:values[2],itemCode:values[3],itemName:values[4],unit:'PCS',qty:'5',invoiced:'0',invoiceRet:'0',deliveryRet:'0',balance:'5'};
const bundle=await build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import ImportDialog from './frontend/dn-tracker/ImportDialog';
import DNTracker from './frontend/dn-tracker/DNTracker';import ConfirmModal from './frontend/ConfirmModal';
const q=new URLSearchParams(location.search),t=(en,ar)=>q.has('ar')?ar:en;
createRoot(document.getElementById('root')).render(q.has('clear')?<><DNTracker t={t} user={{permissions:['DN_TRACKER_MANAGE','DN_TRACKER_EDIT']}}/><ConfirmModal t={t}/></>:<ImportDialog upload={${JSON.stringify({filename:'sample.xls',sheets:[{name:'Sheet1',rows:[headers,values,values]}]})}} reports={[]} reportId="" t={t} close={()=>{}} saved={()=>window.saved=true}/>);
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',platform:'browser',loader:{'.css':'empty'}});
const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
 for(const ar of [false,true]){
  const page=await browser.newPage({viewport:{width:ar?390:1440,height:900}});
  page.on('dialog',()=>{throw new Error('Native browser dialog invoked');});
  let cleared=false,clearRequests=0;
  await page.route('http://dn.test/**',async route=>{
   const url=route.request().url();let body;
   if(url.includes('/api/v1/')){
    if(url.includes('/preview')){const req=route.request().postDataJSON(),decision=req.duplicateDecisions?.['a'.repeat(64)]||null;body={id:'preview',reportId:'report',issues:[],comparison:{customers:1,notes:1,rows:decision==='KEEP_FIRST'?1:2,sourceRows:2,excludedRows:decision==='KEEP_FIRST'?1:0,added:['1822'],changed:[],missing:[],resolvedChanged:[],ambiguous:[],duplicateReview:{unresolved:decision?0:1,groups:[{id:'a'.repeat(64),rows:[row,{...row,row:538}],decision}]}}};}
    else if(url.includes('/commit'))body={id:'report'};
    else if(url.includes('/metadata'))body={reports:[{id:'report',name:'Sample report',version:2,current_snapshot:cleared?null:'snapshot'}],views:[],users:[]};
    else if(url.includes('/directory'))body={customers:[],snapshots:[]};
    else if(url.includes('/list'))body={rows:[],counts:[],summary:{customers:0,unbilled:0,lines:0,aged:0},total:0};
    else if(url.includes('/clear')){cleared=true;clearRequests++;body={id:'report'};}
    else throw new Error(url);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   }
   return route.fulfill({contentType:'text/html',body:`<html dir="${ar?'rtl':'ltr'}"><body><div id="root"></div></body></html>`});
  });
  async function mount(query){await page.goto('http://dn.test/?'+query+(ar?'&ar':''));await page.addStyleTag({content:(await fs.readFile('app/globals.css','utf8'))+'\n'+await fs.readFile('frontend/dn-tracker/tracker.css','utf8')});await page.addScriptTag({content:bundle.outputFiles[0].text});}
  await mount('');
  await page.getByRole('button',{name:ar?'معاينة التغييرات':'Preview changes'}).click();
  const action=page.locator('.dn-duplicate-group select');await action.waitFor();
  assert.equal(await action.inputValue(),'');
  const submit=page.getByRole('button',{name:ar?'استيراد التقرير':'Import report',exact:true});
  await page.getByRole('checkbox').check();assert.ok(await submit.isDisabled());
  await action.selectOption('KEEP_FIRST');await page.waitForFunction(()=>document.querySelector('.dn-duplicate-group select')?.value==='KEEP_FIRST');
  assert.match(await page.locator('.dn-import-summary').innerText(),ar?/1 صفوف مستبعدة/:/1 excluded rows/);
  await action.selectOption('KEEP_ALL');await page.waitForFunction(()=>document.querySelector('.dn-duplicate-group select')?.value==='KEEP_ALL');
  assert.ok(!await page.getByRole('checkbox').isChecked());
  await page.getByRole('checkbox').check();await submit.click();await page.waitForFunction(()=>window.saved);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  await mount('clear');
  await page.getByRole('button',{name:ar?'مسح التقرير المحدد':'Clear selected report',exact:true}).click();
  const confirm=page.getByRole('button',{name:ar?'مسح البيانات الحالية':'Clear current data',exact:true});await confirm.waitFor();
  assert.equal(clearRequests,0);await confirm.click();await page.waitForFunction(()=>document.querySelector('.notice.success'));
  assert.equal(clearRequests,1);
  await page.close();
 }
 console.log('PASS: duplicate choices, confirmation gating, report clear, English desktop and Arabic mobile; no native dialogs');
}finally{await browser.close();}
