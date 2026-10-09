import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardList, classifyDocument, matchesSearch, loadProgress } from '../backend/integrations/workflow-dashboard';
import { embedded, migrate } from '../backend/core/db';
import { setup } from '../backend/auth/service';
import { ProgressBadge } from '../frontend/PricingCollectionJobs';
import DeliveryHistory from '../frontend/DeliveryHistory';
process.env.CONNECTED_APPS_ENABLED='true';process.env.WORKFLOW_INTEGRATION_ENABLED='true';
process.env.CONNECTED_APPS_ENCRYPTION_KEY='c'.repeat(64);

test('classifier overlaps categories but never invents unlinked or unknown progress',()=>{
  const q={status:'DRAFT',workflow:{erpRequestId:'r',sharedQuotations:[{}]}};
  const p={pricingPending:true,awaitingCollection:true,readyForDelivery:true,completed:false,blockers:1,overdue:0};
  assert.deepEqual(classifyDocument(q,p).categories,['all','quotations','pricing','collection','delivery','attention']);
  assert.equal(classifyDocument(q).tracking,'unknown');assert.equal(classifyDocument(q).progress,null);
  const unlinked=classifyDocument({status:'DRAFT'},p);assert.equal(unlinked.tracking,'unlinked');assert.deepEqual(unlinked.categories,['all','drafts']);
  assert.ok(classifyDocument(q,{...p,completed:true}).categories.includes('completed'));
});

test('literal Unicode search covers customer, document, request and retained quotation references',()=>{
  const q={number:'DR-0251',customer:{name:'مؤسسة الكهرباء'},creator:'Musthafa',workflow:{workflowNumber:'REQ-PL-0251',sharedQuotations:[{quotationNumber:'AMT-QT-0042'}]}};
  for(const text of ['dr-0251','الكهرباء','musthafa','req-pl-0251','amt-qt-0042']) assert.ok(matchesSearch(q,text));
  assert.equal(matchesSearch(q,'%'),false);assert.equal(matchesSearch(q,'_'),false);
});

test('batch progress uses at most 100 documents, caches for 30 seconds and retains stale results on outage',async()=>{
  const db:any={query:async()=>({rows:[{data:{url:'https://example.invalid'}}]})};
  const actor:any={id:'pilot'};const docs=Array.from({length:205},()=>({id:randomUUID(),workflow:{erpRequestId:'r'}}));
  const batches:number[]=[];
  const remote:any=async(_s:any,endpoint:string,payload:any)=>{assert.equal(endpoint,'jobs-summary');batches.push(payload.documentIds.length);return {rows:payload.documentIds.map((documentId:string)=>({documentId,itemCount:11,pricedCount:2}))};};
  const first=await loadProgress(db,actor,docs,remote,100000);assert.deepEqual(batches,[100,100,5]);assert.equal(first.size,205);
  await loadProgress(db,actor,docs,remote,110000);assert.deepEqual(batches,[100,100,5]);
  const stale=await loadProgress(db,actor,docs,async()=>{throw Error('offline');},131000);
  assert.equal(stale.get(docs[0].id)?.freshness,'stale');assert.equal(stale.get(docs[0].id)?.pricedCount,2);
  const other=await loadProgress(db,{...actor,id:'other'},docs,async()=>{throw Error('offline');},131000);assert.equal(other.get(docs[0].id),undefined);
});

test('server search finds documents after 200 and pagination counts all permitted documents without writes',async()=>{
  const db=await embedded();
  try{
    await migrate(db);process.env.SETUP_TOKEN='dashboard-synthetic-setup-token-32';
    await setup(db,{token:process.env.SETUP_TOKEN,username:'pilot-dashboard',password:'abcd',name:'Pilot',companyName:'Pilot'});
    const actor:any={...(await db.query('SELECT id FROM users LIMIT 1')).rows[0],role:'ADMIN',permissions:[]};
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals,updated_at) SELECT gen_random_uuid(),'DR-'||lpad(i::text,4,'0'),'DRAFT',$1,'{\"name\":\"Pilot Customer\"}'::jsonb,'[]'::jsonb,'{}'::jsonb,now()-i*interval '1 second' FROM generate_series(1,260) i",[actor.id]);
    const before=(await db.query('SELECT count(*) n FROM sw_job_documents')).rows[0].n;
    const result=await dashboardList(db,actor,new URL('http://local?owner=me&page=2'));
    assert.equal(result.summary.all,260);assert.equal(result.summary.drafts,260);assert.equal(result.rows.length,50);assert.equal(result.rows[0].number,'DR-0051');
    const found=await dashboardList(db,actor,new URL('http://local?search=dr-0251'));assert.equal(found.total,1);assert.equal(found.rows[0].number,'DR-0251');
    const none=await dashboardList(db,{...actor,id:randomUUID(),role:'USER'},new URL('http://local?owner=all'));assert.equal(none.total,0);
    assert.equal((await db.query('SELECT count(*) n FROM sw_job_documents')).rows[0].n,before);
  }finally{await db.close!();}
});

test('delivery table defaults to remaining quantities and hides invoice support in expandable details',()=>{
  const row:any={ownerId:'pilot',requestRevision:1,customer:'Pilot',items:[{id:'i',partNumber:'P1',name:'Cable',unit:'pcs'}],orders:[{id:'o',number:'PO1',lines:[{itemId:'i',name:'Cable',unit:'pcs',customerConfirmed:true,confirmedQuantity:'5',collected:'5',delivered:'2',availableToDeliver:'3'}]}]};
  const html=renderToStaticMarkup(createElement(DeliveryHistory,{row,admin:false,busy:false,submit:async()=>true}));
  assert.match(html,/Delivery quantity/);assert.match(html,/value="3"/);assert.match(html,/checked=""/);assert.match(html,/Optional supporting details/);assert.match(html,/Select all deliverable items/);
  const badge=renderToStaticMarkup(createElement(ProgressBadge,{row:{tracking:'unlinked'}}));assert.match(badge,/Not started/);assert.doesNotMatch(badge,/0\/0/);
});
