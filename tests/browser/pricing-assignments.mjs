import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import{randomUUID}from'node:crypto';
import{chromium}from'playwright';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import Workspace from'./frontend/WorkflowPricingAssignments';createRoot(document.getElementById('root')).render(<Workspace documentId="document" onOpenDraft={value=>window.opened=value}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',platform:'browser'});
const ids=[randomUUID(),randomUUID()];let version=1,workflowVersion=0,submitted;
const doc=()=>({id:'document',number:'DR-123',erpRequestId:'request',status:'DRAFT',version,workflowVersion,canAssign:true,creator:{name:'Owner'},failures:[],lines:ids.map((id,index)=>({id,partNumber:'ITEM-'+index,description:'Item '+index,unit:'pcs',quantity:'2',jobs:{}}))});
const context=()=>({branchId:'branch',branchName:'AMT',branches:[{id:'branch',name:'AMT'}],ownerMappingRevision:1,actorMappingRevision:1,workflowVersion,readiness:{creatorWhatsApp:true,assignerWhatsApp:true},staff:[{id:'one',name:'Ahmed',role:'pricing',phoneConfigured:true},{id:'two',name:'Ali',role:'pricing',phoneConfigured:true}]});
const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try{const page=await browser.newPage({viewport:{width:1280,height:768}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('http://localhost/**',async route=>{const url=new URL(route.request().url());if(!url.pathname.includes('/api/v1/'))return route.fulfill({contentType:'text/html',body:'<div id="root"></div>'});let value;if(route.request().method()==='POST'){submitted=route.request().postDataJSON();value={saved:true};}else value=url.searchParams.has('staff')?context():doc();return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});});
 await page.goto('http://localhost');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.getByLabel('Assigned staff ITEM-0',{exact:true}).selectOption('one');await page.getByLabel('Assigned staff ITEM-1',{exact:true}).selectOption('two');
 version++;workflowVersion++;await page.getByRole('button',{name:'Refresh document',exact:true}).click();await page.getByText(/Workflow changed. Your staff selections are retained/).waitFor();assert.equal(await page.getByLabel('Assigned staff ITEM-0',{exact:true}).inputValue(),'one');await page.getByRole('button',{name:'Use updated version',exact:true}).click();
 await page.locator('input[name=noDueReason]').fill('Confirm delivery schedule');await page.getByRole('button',{name:'Save assignments',exact:true}).click();await page.waitForFunction(()=>document.body.innerText.includes('Saved. Pending jobs will synchronize with ERP.'),null,{timeout:5000}).catch(async error=>{console.error('Pricing state',submitted,await page.locator('body').innerText(),errors);throw error;});
 assert.deepEqual(submitted.owners,{[ids[0]]:'one',[ids[1]]:'two'});assert.deepEqual(submitted.selected,ids);assert.equal(submitted.version,2);assert.equal(submitted.workflowVersion,1);assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:'Prepare quotation',exact:true}).click();assert.equal(await page.evaluate(()=>window.opened.documentId),'document');
 console.log('PASS: per-item pricing owners, versioned batch submission, refresh retention and Prepare quotation');
}finally{await browser.close();}

