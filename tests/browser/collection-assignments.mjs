import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx'))('esbuild');
const bundle=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Table from './frontend/CollectionAssignmentTable';function App(){const[revision,setRevision]=useState(1);window.updateRevision=setRevision;return <Table early={new URLSearchParams(location.search).has('early')} quoteVersion={2} orderId="order" revision={revision} busy={false} admin={false} lines={[{itemId:'a',partNumber:'A',name:'Relay',remainingToAssign:'4',unit:'pcs',supplier:'shop',offerId:'offer-a'},{itemId:'b',partNumber:'B',name:'Breaker',remainingToAssign:'2',unit:'pcs',supplier:'shop',offerId:'offer-b'}]} staff={[{id:'one',name:'Ahmed'},{id:'two',name:'Ali'}]} suppliers={[{id:'shop',name:'Supplier'}]} submit={async value=>{window.submitted=value;return true;}}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,jsx:'automatic',platform:'browser'});
const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
 for(const early of [false,true]) {
  const page=await browser.newPage({viewport:{width:1280,height:768}});
  await page.route('http://collection.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('http://collection.test/'+(early?'?early':''));await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.getByLabel('Assigned collector Relay',{exact:true}).selectOption('one');await page.getByLabel('Assigned collector Breaker',{exact:true}).selectOption('two');
  if(early){await page.getByLabel('Select collection Relay',{exact:true}).check();await page.getByLabel('Reason for early collection',{exact:true}).fill('Urgent stock required');await page.getByLabel('Early quantity Relay',{exact:true}).fill('3');}
  await page.evaluate(()=>window.updateRevision(2));await page.getByRole('alert').waitFor();
  assert.equal(await page.getByLabel('Assigned collector Relay',{exact:true}).inputValue(),'one');
  await page.getByRole('button',{name:'Use updated version',exact:true}).click();
  await page.getByRole('button',{name:early?'Authorize selected early quantities':'Save collection assignments',exact:true}).click();
  await page.waitForFunction(()=>window.submitted);
  const sent=await page.evaluate(()=>window.submitted);assert.equal(sent.revision,2);assert.equal(sent.lines[0].owner,'one');assert.equal(sent.action,early?'authorizeEarlyCollection':'approveCollection');
  if(early){assert.equal(sent.quoteVersion,2);assert.equal(sent.reason,'Urgent stock required');assert.equal(sent.lines[0].quantity,'3');assert.equal(sent.lines.length,1);}else{assert.equal(sent.lines[1].owner,'two');assert.equal(sent.lines.length,2);}
  await page.close();
 }
 console.log('PASS: per-item collection owners, retained selection across refresh, explicit version review, early reason and selected quantities');
}finally{await browser.close();}
