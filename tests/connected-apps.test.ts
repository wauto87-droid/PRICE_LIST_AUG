import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { embedded, migrate, one as maybeOne } from '../backend/core/db';
import { adminCommand, adminState, authenticate, catalogItem, encrypt, decrypt, isPublicAddress, protocol, refreshCatalog, reviewProposal, submitProposal, sync, type Hooks } from '../backend/integrations/core';
import { priceHooks, integrationAdmin } from '../backend/integrations/service';
import { setup, login, authenticate as sessionAuth, sessionCookie } from '../backend/auth/service';

process.env.CONNECTED_APPS_ENABLED = 'true';
process.env.CONNECTED_APPS_ENCRYPTION_KEY = 'a'.repeat(64);
async function one(db: any, sql: string, args?: any[]) { const row = await maybeOne(db, sql, args); assert(row, 'Expected database row'); return row; }
const migration = () => readFile('database/034_connected_apps.sql', 'utf8');
async function fresh() { const db = await embedded(); for (const statement of (await migration()).split(';').filter(v => v.trim())) await db.query(statement); return db; }
const item = (n: number) => catalogItem.parse({ id: String(n), type: n % 2 ? 'PRODUCT' : 'REUSABLE', code: n === 0 ? '' : `PART-${n}`, description: `Lamp ${n}W`, unit: 'pcs', active: n !== 2 });
const key = async (db: any, hooks: Hooks) => (await adminCommand(db, hooks, 'admin', { action: 'generate', name: 'Test connection', scopes: hooks.app === 'pricelist' ? ['catalog:read','proposals:write','proposals:read'] : ['notifications:write'], expires: new Date(Date.now() + 86400000).toISOString() })).key!;
const req = (token: string, path: string, body?: any) => new Request(`https://example.com/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });

test('keys are scoped, hashed, encrypted, rotatable and immediately revocable', async () => {
  const db = await fresh(); const hooks: Hooks = { app: 'pricelist' };
  try {
    const token = await key(db, hooks); await authenticate(db, req(token, 'health'), 'catalog:read');
    await assert.rejects(authenticate(db, req(token, 'health'), 'notifications:write'));
    const view = await adminState(db, hooks); assert(!JSON.stringify(view).includes(token)); assert(view.keys[0].last_used_at);
    const stored = await one(db, 'SELECT hash FROM sw_link_keys'); assert.notEqual(stored.hash, token);
    const rotated = await adminCommand(db, hooks, 'admin', { action: 'rotate', id: view.keys[0].id, name: 'Rotated', scopes: ['catalog:read'], expires: new Date(Date.now()+86400000).toISOString() });
    await assert.rejects(authenticate(db, req(token, 'health'), 'catalog:read'));
    await authenticate(db, req(rotated.key!, 'health'), 'catalog:read');
    await adminCommand(db, hooks, 'admin', { action: 'revoke', id: rotated.id });
    await assert.rejects(authenticate(db, req(rotated.key!, 'health'), 'catalog:read'));
    const sealed = encrypt(token); assert(!sealed.includes(token)); assert.equal(decrypt(sealed), token);
    assert.throws(() => decrypt(sealed.slice(0,-4)+'AAAA'));
    for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(isPublicAddress(address), false);
    assert.equal(isPublicAddress('8.8.8.8'), true);
  } finally { await db.close?.(); }
});

test('1100 catalog records paginate beyond the old custom-item limit; changes, deletion and conversions survive retries', async () => {
  const source = await fresh(); const target = await fresh(); let products = Array.from({length:1100}, (_,n) => item(n));
  const hooks: Hooks = { app: 'pricelist', catalog: async () => products }; const workflow: Hooks = { app: 'workflow' };
  try {
    const token = await key(source, hooks);
    await target.query('UPDATE sw_link_state SET data=$1::jsonb WHERE id=1', [JSON.stringify({ paused: false, url: 'https://example.com', secret: encrypt(token) })]);
    let calls = 0;
    const transport = async (_s: any, path: string, body?: any) => { calls++; return protocol(source, hooks, req(token,path,body), path.split('?')[0]); };
    await sync(target, workflow, true, transport); assert.equal((await one(target,'SELECT count(*)::int n FROM sw_link_catalog')).n,1100); assert.equal(calls,6);
    const before = await one(source,'SELECT max(seq)::text seq FROM sw_link_catalog');
    await refreshCatalog(source, hooks); assert.equal((await one(source,'SELECT max(seq)::text seq FROM sw_link_catalog')).seq,before.seq, 'JSONB key order must not manufacture changes');
    await sync(target, workflow, true, transport); assert.equal((await one(target,'SELECT count(*)::int n FROM sw_link_catalog')).n,1100);
    products = products.filter(p => p.id !== '3').map(p => p.id === '4' ? {...p, active:false, convertedTo:'5'} : p.id === '1' ? {...p,code:'NEW-1'} : p);
    await sync(target, workflow, true, transport);
    assert.equal((await one(target,"SELECT data FROM sw_link_catalog WHERE identity='PRODUCT:3'")).data.deleted,true);
    assert.equal((await one(target,"SELECT data FROM sw_link_catalog WHERE identity='REUSABLE:4'")).data.convertedTo,'5');
    assert.equal((await one(target,"SELECT data FROM sw_link_catalog WHERE identity='PRODUCT:1'")).data.code,'NEW-1');
    const all = await target.query('SELECT data FROM sw_link_catalog'); assert(!JSON.stringify(all).includes('cost')); assert(!JSON.stringify(all).includes('suggestedUnitPrice'));
    const oldCursor = (await one(target,'SELECT data FROM sw_link_state')).data.cursor;
    await assert.rejects(sync(target, workflow, true, async () => { throw new Error('offline'); }));
    assert.equal((await one(target,'SELECT data FROM sw_link_state')).data.cursor,oldCursor);
    assert.equal((await one(target,'SELECT count(*)::int n FROM sw_link_catalog')).n,1100);
  } finally { await source.close?.(); await target.close?.(); }
});

test('proposal retries are idempotent, revisions preserve review history, and decisions cannot be replayed', async () => {
  const db = await fresh(); const id=randomUUID(); const p = { id, revision:1, item:{...item(1),id,type:'LOCAL'}, note:'Verify actual model' };
  const hooks: Hooks = { app:'pricelist', approve:async () => ({id:'approved-id',type:'PRODUCT'}) };
  try {
    await submitProposal(db,p); await submitProposal(db,p); assert.equal((await one(db,'SELECT count(*)::int n FROM sw_link_proposals')).n,1);
    await assert.rejects(submitProposal(db,{...p,note:'Different content'}));
    await reviewProposal(db,hooks,{id:'admin'},{id,revision:1,decision:'CHANGES_REQUESTED',reason:'Need dimensions'});
    await submitProposal(db,{...p,revision:2,note:'Dimensions checked'});
    await reviewProposal(db,hooks,{id:'admin'},{id,revision:2,decision:'APPROVED',reason:'Verified'});
    await assert.rejects(reviewProposal(db,hooks,{id:'admin'},{id,revision:2,decision:'REJECTED',reason:'Stale request'}));
    assert.equal((await one(db,'SELECT status FROM sw_link_proposals WHERE id=$1',[id])).status,'APPROVED');
    assert((await one(db,'SELECT count(*)::int n FROM sw_link_audit')).n>=3);
  } finally { await db.close?.(); }
});

test('notifications deduplicate, paused sync retains data, and wrong scopes cannot access notifications', async () => {
  const db=await fresh(); const hooks:Hooks={app:'workflow'};
  try {
    const token=await key(db,hooks); const id=randomUUID();
    await protocol(db,hooks,req(token,'notifications',{id}),'notifications'); await protocol(db,hooks,req(token,'notifications',{id}),'notifications');
    assert.equal((await one(db,'SELECT count(*)::int n FROM sw_link_events')).n,1);
    await assert.rejects(sync(db,hooks,true));
    await assert.rejects(protocol(db,hooks,req(token,'catalog'),'catalog'));
  } finally { await db.close?.(); }
});

test('two-app pilot: interrupted pages resume, queued submissions arrive once and admin decisions return', async () => {
  const source=await fresh(); const target=await fresh(); const hooks:Hooks={app:'pricelist',catalog:async()=>Array.from({length:401},(_,n)=>item(n)),approve:async()=>({id:'1',type:'PRODUCT',code:'PART-1',unit:'pcs'})}; const workflow:Hooks={app:'workflow'};
  try {
    const token=await key(source,hooks); const reverse=await key(target,workflow);
    await target.query('UPDATE sw_link_state SET data=$1::jsonb WHERE id=1',[JSON.stringify({paused:false,url:'https://example.com',secret:encrypt(token)})]);
    await source.query('UPDATE sw_link_state SET data=$1::jsonb WHERE id=1',[JSON.stringify({paused:false,url:'https://example.com',secret:encrypt(reverse)})]);
    const transport=(_s:any,path:string,body?:any)=>protocol(source,hooks,req(token,path,body),path.split('?')[0]);
    let calls=0;
    await assert.rejects(sync(target,workflow,true,async(s,path,body)=>{if(++calls===2)throw new Error('Interrupted network');return transport(s,path,body);}));
    assert.equal((await one(target,'SELECT count(*)::int n FROM sw_link_catalog')).n,200);
    await sync(target,workflow,true,transport); assert.equal((await one(target,'SELECT count(*)::int n FROM sw_link_catalog')).n,401);
    const id=randomUUID();const p={id,revision:1,item:{...item(1),id,type:'LOCAL'},note:''};
    await target.query("INSERT INTO sw_link_proposals(id,revision,hash,data,status,team,owner) VALUES($1,1,'test',$2::jsonb,'PENDING_SYNC','A','sales')",[id,JSON.stringify(p)]);
    await sync(target,workflow,true,transport); await sync(target,workflow,true,transport);
    assert.equal((await one(source,'SELECT count(*)::int n FROM sw_link_proposals')).n,1);
    assert.equal((await one(target,'SELECT status FROM sw_link_proposals WHERE id=$1',[id])).status,'PENDING_REVIEW');
    await reviewProposal(source,hooks,{id:'admin'},{id,revision:1,decision:'LINKED',reason:'Exact model confirmed'});
    await sync(source,hooks,true,(_s,path,body)=>protocol(target,workflow,req(reverse,path,body),path));
    assert.equal((await one(target,'SELECT data FROM sw_link_state')).data.refreshRequested,true);
    await sync(target,workflow,true,transport);
    const approved=await one(target,'SELECT * FROM sw_link_proposals WHERE id=$1',[id]);assert.equal(approved.status,'LINKED');assert.equal(approved.result.code,'PART-1');
  } finally {await source.close?.();await target.close?.();}
});

test('price-list admin review uses real product validation, preserves custom conversion and excludes prices', async () => {
  const db=await embedded();
  try {
    await migrate(db); process.env.SETUP_TOKEN='connected-apps-test-setup-token-long-enough';
    await setup(db,{token:process.env.SETUP_TOKEN,username:'admin',password:'abcd',name:'Admin',companyName:'Test'});
    const session=await login(db,{username:'admin',password:'abcd'});
    const actor=await sessionAuth(db,new Request('http://localhost',{headers:{Cookie:sessionCookie(session.token).split(';')[0]}}));
    const p={id:randomUUID(),revision:1,item:{...item(1),id:randomUUID(),type:'LOCAL'},note:''};
    await submitProposal(db,p);
    const input={id:p.id,revision:1,decision:'APPROVED',type:'REUSABLE',reason:'Verified identity',pricingConfirmed:true,custom:{reference:'NEW-42',description:'400W light',unit:'pcs',suggestedUnitPrice:'12.50'}};
    await reviewProposal(db,priceHooks,actor,input);
    const row=await one(db,'SELECT * FROM reusable_custom_items WHERE reference=$1',['NEW-42']); assert(row);
    const catalog=await priceHooks.catalog!(db); assert(catalog.some(p=>p.id===row.id)); assert(!JSON.stringify(catalog).includes('12.5'));
    const denied=await integrationAdmin(db,{...actor,role:'SALES'},new Request('http://localhost/connected-apps')); assert.equal(denied.status,403);
    const p2={...p,id:randomUUID()};await submitProposal(db,p2);
    await assert.rejects(reviewProposal(db,priceHooks,actor,{...input,id:p2.id,type:'PRODUCT',product:{partNumber:'P-42',description:'400W light',unit:'pcs'}}));
    assert.equal((await one(db,'SELECT status FROM sw_link_proposals WHERE id=$1',[p2.id])).status,'PENDING_REVIEW');
    await reviewProposal(db,priceHooks,actor,{...input,id:p2.id,type:'PRODUCT',product:{partNumber:'P-42',description:'400W light with different specifications',unit:'pcs',cost:'10',markup:'25',listPrice:'0'}});
    assert.equal((await one(db,'SELECT result FROM sw_link_proposals WHERE id=$1',[p2.id])).result.code,'P-42');
    const p3={...p,id:randomUUID()};await submitProposal(db,p3);
    await assert.rejects(reviewProposal(db,priceHooks,actor,{...input,id:p3.id,type:'PRODUCT',product:{partNumber:'NEW-42',description:'Do not duplicate reusable code',unit:'pcs',cost:'10',listPrice:'0'}}));
  } finally {await db.close?.();}
});
