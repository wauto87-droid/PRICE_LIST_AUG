import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { embedded, migrate, one } from '../backend/core/db';
import { setup, login, authenticate, sessionCookie, type Actor } from '../backend/auth/service';
import { jobWorkspace, receiveJobResult, preserveWorkflowCosts, assertWorkflowPricingReady } from '../backend/integrations/jobs';
import { adminCommand } from '../backend/integrations/core';
import { deliver, enqueue, lineFingerprint, hash } from '../backend/integrations/job-protocol';

process.env.CONNECTED_APPS_ENABLED = 'true'; process.env.WORKFLOW_INTEGRATION_ENABLED = 'true';
process.env.CONNECTED_APPS_ENCRYPTION_KEY = 'c'.repeat(64);
const cost = { cost: '42.50', currency: 'SAR', unit: 'pcs', supplier: 'Shop A', taxBasis: 'Excluding VAT', availability: 'In stock', evidence: 'Offer 42', leadTime: 'Today' };
test('10-line draft: two known prices, split assignments, retries, returned costs, revisions and issued-document protection', async () => {
  const db = await embedded();
  try {
    await migrate(db); process.env.SETUP_TOKEN = 'workflow-test-token-long-enough-32';
    await setup(db, { token: process.env.SETUP_TOKEN, username: 'jobadmin', password: 'abcd', name: 'Creator', companyName: 'Pilot' });
    const session = await login(db, { username: 'jobadmin', password: 'abcd' });
    const actor = await authenticate(db, new Request('http://localhost', { headers: { Cookie: sessionCookie(session.token).split(';')[0] } }));
    const id = randomUUID();
    const lines = Array.from({ length: 10 }, (_, n) => ({ source: 'CUSTOM', description: `Lamp ${n}`, partNumber: `L-${n}`, unit: 'pcs', input: { type: 'CUSTOM', watcherEventId: randomUUID(), quantity: '10' }, price: { finalExcl: '100', quantity: '10' } }));
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'DRAFT-001','DRAFT',$2,'{\"name\":\"Customer\"}',$3::jsonb,'{}')", [id, actor.id, JSON.stringify(lines)]);
    const get = () => jobWorkspace(db, actor, new Request(`http://localhost/workflow-jobs?documentId=${id}`));
    const post = (body: any) => jobWorkspace(db, actor, new Request('http://localhost/workflow-jobs', { method: 'POST', body: JSON.stringify(body) }));
    for (const line of lines.slice(0,2)) {
      const q = await get(); const body = { action: 'known', eventId: randomUUID(), documentId: id, lineId: line.input.watcherEventId, version: q.version, workflowVersion: q.workflowVersion, cost };
      await post(body); await post(body); // The same command survives quote-version changes.
    }
    const staff = [randomUUID(), randomUUID()]; const tokens: string[] = [];
    for (let n = 0; n < 2; n++) {
      const q = await get(); const token = randomUUID(); tokens.push(token);
      const body = { action: 'assign', eventId: token, documentId: id, version: q.version, workflowVersion: q.workflowVersion, kind: 'PRICING', selected: lines.slice(2+n*4,6+n*4).map(l => l.input.watcherEventId), assignee: staff[n], shops: 'ABC Trading', notes: 'Confirm 400W model', due: '', noDueReason: 'Customer has not confirmed a deadline' };
      await post(body); await post(body);
    }
    assert.equal((await one(db, "SELECT count(*)::int n FROM sw_job_outbox WHERE endpoint='jobs-assign'"))!.n, 2);
    await assert.rejects(assertWorkflowPricingReady(db, (await one(db, 'SELECT * FROM quotations WHERE id=$1', [id]))!), /Finish or review/);
    const key = (await adminCommand(db, { app: 'pricelist' }, actor.id, { action: 'generate', name: 'ERP results', scopes: ['jobs:results'], expires: new Date(Date.now()+86400000).toISOString() })).key;
    const send = (body: any) => receiveJobResult(db, new Request('http://localhost/jobs-result', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(body) }));
    let last: any;
    for (let n = 2; n < 10; n++) {
      const payload = { eventId: randomUUID(), documentId: id, lineId: lines[n].input.watcherEventId, token: tokens[n < 6 ? 0 : 1], revision: n+1, kind: 'PRICING', fingerprint: lineFingerprint(lines[n]), done: true, blocker: '', actorName: n < 6 ? 'Ahmed' : 'Ravi', updatedAt: new Date().toISOString(), cost };
      last = await send(payload); assert.deepEqual(await send(payload), last);
      if (n < 9) assert.equal(last.ready, false);
    }
    assert.equal(last.ready, true); assert.equal(last.count, 10);
    const q = (await one(db, 'SELECT * FROM quotations WHERE id=$1', [id]))!;
    assert(q.lines.every((l: any) => l.workflowCost.cost === '42.50' && l.price.finalExcl === '100'));
    assert.equal(q.lines[2].workflowCost.actorName, 'Ahmed');
    await assertWorkflowPricingReady(db, q);
    const rebuilt = preserveWorkflowCosts(q.lines.map((l: any) => ({ ...l, workflowCost: undefined })).reverse(), q.lines);
    assert.equal(rebuilt[0].workflowCost.actorName, 'Ravi');
    const stranger = { ...actor, id: randomUUID(), role: 'SALES', permissions: ['QUOTE_EDIT'] };
    await assert.rejects(jobWorkspace(db, stranger, new Request(`http://localhost/workflow-jobs?documentId=${id}`)), /belongs to another/);
    await db.query("UPDATE quotations SET status='ISSUED' WHERE id=$1", [id]);
    await send({ eventId: randomUUID(), documentId: id, lineId: lines[2].input.watcherEventId, token: tokens[0], revision: 100, kind: 'PRICING', fingerprint: lineFingerprint(lines[2]), done: true, blocker: '', actorName: 'Ahmed', updatedAt: new Date().toISOString(), cost: { ...cost, cost: '999' } });
    const frozen = (await one(db, 'SELECT lines FROM quotations WHERE id=$1', [id]))!;
    assert.equal(frozen.lines[2].workflowCost.cost, '42.50');
    assert.equal((await get()).lines[2].jobs.PRICING.status, 'REVIEW_REQUIRED');
    assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
  } finally { await db.close?.(); }
});

test('WhatsApp outbox retains unknown delivery, retries missing phones and never sends an accepted event twice', async () => {
  const db = await embedded();
  try {
    await migrate(db); let sends = 0;
    await enqueue(db, 'notice-a', 'whatsapp', { recipient: 'staff', message: 'New job' }, 'WHATSAPP');
    await deliver(db, 'WHATSAPP', async () => { sends++; return true; });
    await deliver(db, 'WHATSAPP', async () => { sends++; return true; }); assert.equal(sends,1);
    await enqueue(db, 'notice-b', 'whatsapp', {}, 'WHATSAPP');
    await deliver(db, 'WHATSAPP', async () => { throw new Error('Timeout'); });
    assert.equal((await one(db, "SELECT state FROM sw_job_outbox WHERE id='notice-b'"))!.state, 'DELIVERY_UNKNOWN');
    await deliver(db, 'WHATSAPP', async () => { throw new Error('Must not automatically resend'); });
    await enqueue(db, 'notice-c', 'whatsapp', {}, 'WHATSAPP');
    await deliver(db, 'WHATSAPP', async () => { throw Object.assign(new Error('No phone'), { code: 'MISSING_PHONE' }); });
    assert.equal((await one(db, "SELECT state FROM sw_job_outbox WHERE id='notice-c'"))!.state, 'FAILED');
  } finally { await db.close?.(); }
});

test('workflow-jobs workspace: filtering by status and owner for admin and normal users', async () => {
  const db = await embedded();
  try {
    await migrate(db); process.env.SETUP_TOKEN = 'workflow-test-token-long-enough-32';
    await setup(db, { token: process.env.SETUP_TOKEN, username: 'adminuser', password: 'password123', name: 'Admin User', companyName: 'Pilot' });
    const adminSession = await login(db, { username: 'adminuser', password: 'password123' });
    const admin = await authenticate(db, new Request('http://localhost', { headers: { Cookie: sessionCookie(adminSession.token).split(';')[0] } }));

    // Create a staff user
    const staffId = randomUUID();
    await db.query("INSERT INTO users(id,username,name,password_hash,role_id) VALUES($1,'staffuser','Staff Member','dummy','STAFF')", [staffId]);
    const staff: Actor = { id: staffId, username: 'staffuser', name: 'Staff Member', role: 'STAFF', permissions: ['QUOTE_EDIT'], maxDiscount: '10', csrf: 'csrf' };

    // Insert quotations: Admin draft & issued, Staff draft & issued
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'ADMIN-DRAFT','DRAFT',$2,'{\"name\":\"Cust 1\"}','[]','{}')", [randomUUID(), admin.id]);
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'ADMIN-ISSUED','ISSUED',$2,'{\"name\":\"Cust 2\"}','[]','{}')", [randomUUID(), admin.id]);
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'STAFF-DRAFT','DRAFT',$2,'{\"name\":\"Cust 3\"}','[]','{}')", [randomUUID(), staff.id]);
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'STAFF-ISSUED','ISSUED',$2,'{\"name\":\"Cust 4\"}','[]','{}')", [randomUUID(), staff.id]);

    // 1. Normal user query: default status=DRAFT returns only staff draft
    const staffDrafts: any = await jobWorkspace(db, staff, new Request('http://localhost/workflow-jobs?status=DRAFT'));
    assert.equal(staffDrafts.isAdmin, false);
    assert.deepEqual(staffDrafts.creators, []);
    assert.equal(staffDrafts.rows.length, 1);
    assert.equal(staffDrafts.rows[0].number, 'STAFF-DRAFT');

    // 2. Normal user query: status=ALL returns both staff draft and staff issued, none of admin's
    const staffAll: any = await jobWorkspace(db, staff, new Request('http://localhost/workflow-jobs?status=ALL'));
    assert.equal(staffAll.rows.length, 2);
    assert(staffAll.rows.every((r: any) => r.ownerId === staff.id));

    // 3. Admin query: owner=me and status=DRAFT returns only admin draft
    const adminMyDrafts: any = await jobWorkspace(db, admin, new Request('http://localhost/workflow-jobs?status=DRAFT&owner=me'));
    assert.equal(adminMyDrafts.isAdmin, true);
    assert(adminMyDrafts.creators.length >= 2);
    assert.equal(adminMyDrafts.rows.length, 1);
    assert.equal(adminMyDrafts.rows[0].number, 'ADMIN-DRAFT');

    // 4. Admin query: owner=all and status=DRAFT returns both admin draft and staff draft
    const allDrafts: any = await jobWorkspace(db, admin, new Request('http://localhost/workflow-jobs?status=DRAFT&owner=all'));
    assert.equal(allDrafts.rows.length, 2);
    const draftNums = allDrafts.rows.map((r: any) => r.number).sort();
    assert.deepEqual(draftNums, ['ADMIN-DRAFT', 'STAFF-DRAFT']);

    // 5. Admin query: filter by specific user (staffId)
    const staffByAdmin: any = await jobWorkspace(db, admin, new Request(`http://localhost/workflow-jobs?status=DRAFT&owner=${staffId}`));
    assert.equal(staffByAdmin.rows.length, 1);
    assert.equal(staffByAdmin.rows[0].number, 'STAFF-DRAFT');

    // 6. Admin query: all users, all statuses returns all 4 quotes
    const allQuotes: any = await jobWorkspace(db, admin, new Request('http://localhost/workflow-jobs?status=ALL&owner=all'));
    assert.equal(allQuotes.rows.length, 4);
  } finally { await db.close?.(); }
});
