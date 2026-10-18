import test from 'node:test';
import assert from 'node:assert/strict';
import { QuotationRowIdentity, reorderQuotationRows } from '../frontend/quotation-row-order';
import { embedded, migrate } from '../backend/core/db';
import { setup, login, authenticate, sessionCookie } from '../backend/auth/service';
import { saveDraft, getQuote } from '../backend/quotations/service';

test('editor identities follow repeated rows, input replacement, addition and removal without leaking into data', () => {
  const identities = new QuotationRowIdentity();
  const a = { partNumber: 'SAME', price: '1.005000' }, b = { ...a }, c = { partNumber: 'OTHER' };
  const rows = [a,b,c], ids = identities.sync(rows, 'draft');
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(identities.sync(reorderQuotationRows(rows, 0, 2), 'draft'), [ids[1],ids[2],ids[0]]);
  const edited = { ...b, price: '1.000001' };
  assert.deepEqual(identities.sync([edited,c,a], 'draft'), [ids[1],ids[2],ids[0]]);
  const extra = { partNumber: 'SAME' };
  const added = identities.sync([extra,edited,c,a], 'draft');
  assert.deepEqual(added.slice(1), [ids[1],ids[2],ids[0]]);
  assert.ok(!ids.includes(added[0]));
  assert.deepEqual(identities.sync([extra,c,a], 'draft'), [added[0],ids[2],ids[0]]);
  assert.ok(identities.sync([a,b,c], 'different-draft').every(id => !ids.includes(id)));
  assert.deepEqual(rows, [{partNumber:'SAME',price:'1.005000'},{partNumber:'SAME',price:'1.005000'},{partNumber:'OTHER'}]);
});

test('33 and 100 row moves preserve exact values and objects; invalid or cancelled moves are no-ops', () => {
  for (const count of [33,100]) {
    const rows = Array.from({length:count},(_,i)=>({id:i,partNumber:`REPEATED-${i%7}`,quantity:`${i+1}`,price:'1.005001',description:'Long description '.repeat(10)}));
    const original = JSON.stringify(rows);
    const moved = reorderQuotationRows(rows,0,count-1);
    assert.equal(moved[count-1],rows[0]);
    assert.deepEqual(reorderQuotationRows(moved,count-1,0),rows);
    assert.equal(JSON.stringify(rows),original);
    for (const [from,to] of [[0,0],[-1,2],[0,count]]) assert.equal(reorderQuotationRows(rows,from,to),rows);
  }
});

test('ordinary quotation order survives a real isolated save, reorder/update and reopen without changing values or old version', async () => {
  const db = await embedded();
  try {
    await migrate(db);
    process.env.SETUP_TOKEN='row-order-synthetic-token-long-enough';
    await setup(db,{token:process.env.SETUP_TOKEN,username:'synthetic-owner',password:'synthetic-fixture-only',name:'Synthetic owner',companyName:'Synthetic company'});
    const session=await login(db,{username:'synthetic-owner',password:'synthetic-fixture-only'});
    const actor=await authenticate(db,new Request('http://localhost',{headers:{Cookie:sessionCookie(session.token).split(';')[0]}}));
    const inputs=Array.from({length:33},(_,i)=>({type:'CUSTOM' as const,partNumber:`REPEATED-${i%6}`,description:`Unique item ${i}`,unit:'pcs',quantity:String(i+1),unitPriceExcl:'1.005001',discount:'0'}));
    const saved:any=await saveDraft(db,actor,{customer:{name:'Synthetic buyer'},lines:inputs},{});
    const before=JSON.stringify(saved);
    const ordered=reorderQuotationRows(inputs,0,32);
    const updated:any=await saveDraft(db,actor,{customer:{name:'Synthetic buyer'},lines:ordered},{},saved.id,saved.version);
    const reopened:any=await getQuote(db,actor,saved.id,true);
    assert.deepEqual(reopened.lines.map((line:any)=>line.input.description),ordered.map(line=>line.description));
    assert.deepEqual(reopened.lines.map((line:any)=>[line.input.partNumber,line.input.quantity,line.input.unitPriceExcl]),ordered.map(line=>[line.partNumber,line.quantity,line.unitPriceExcl]));
    assert.deepEqual(updated.totals,saved.totals);
    assert.equal(JSON.stringify(saved),before);
    assert.equal(reopened.lines.length,33);
  } finally { await db.close?.(); }
});
