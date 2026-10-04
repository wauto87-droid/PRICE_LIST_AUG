import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { embedded, migrate, one } from '../backend/core/db';
import { adminCommand, ConnectionError } from '../backend/integrations/core';
import { receiveSharedQuotation, sharedQuotationWorkspace } from '../backend/integrations/shared-quotation';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import QuotationActions from '../frontend/SharedQuotationActions';
import { sharedQuotationSnapshot, sharedQuotationPdfJob, sharedQuotationPdfDownload } from '../backend/integrations/shared-quotation-pdf';
import { quotationHtml } from '../backend/pdf/template';
import { pendingQuotationCommand, quotationCommandRejected } from '../frontend/shared-quotation-command';
import Decimal from 'decimal.js';
import { setup, login, sessionCookie } from '../backend/auth/service';
import { handle } from '../backend/api/router';
process.env.CONNECTED_APPS_ENABLED = 'true';
process.env.WORKFLOW_INTEGRATION_ENABLED = 'true';
process.env.CONNECTED_APPS_ENCRYPTION_KEY = 'c'.repeat(64);

test('ERP quotation push is deduplicated, rejects reused identities and ignores older revisions', async () => {
  const db = await embedded();
  try {
    await migrate(db);
    const key = (await adminCommand(db, { app: 'pricelist' }, 'fixture', { action: 'generate', name: 'ERP', scopes: ['jobs:results'], expires: new Date(Date.now() + 86400000).toISOString() })).key;
    const documentId = randomUUID();
    await db.query('INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)', [documentId, JSON.stringify({ lines: {} })]);
    const body = { eventId: 'quote:stable:1', documentId, requestId: randomUUID(), requestRevision: 3, quotations: [{ id: 'shared', version: 1, customer: 'Buyer', total: '12.30' }], status: 'QUOTED' };
    const send = (payload: any) => receiveSharedQuotation(db, new Request('http://localhost/jobs-quotation-update', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) }));
    assert.deepEqual(await send(body), { received: true }); assert.deepEqual(await send(body), { received: true });
    await assert.rejects(send({ ...body, quotations: [] }), /different content/);
    assert.deepEqual(await send({ ...body, eventId: 'quote:stable:old', requestRevision: 2, quotations: [] }), { received: true, stale: true });
    const link = await one(db, 'SELECT * FROM sw_job_documents WHERE id=$1', [documentId]);
    assert.equal(link!.data.sharedQuotations.length, 1); assert.equal(link!.data.erpRevision, 3);
  } finally { await db.close!(); }
});

test('Price List submits stable identities and the browser revision to the canonical ERP quotation', async () => {
  const db: any = { query: async () => ({ rows: [{ data: {} }] }) };
  const actor: any = { id: 'price-owner', permissions: ['QUOTE_EDIT'] };
  const eventId = randomUUID(), requestId = randomUUID();
  const input = { action: 'saveQuotation', requestId, eventId, revision: 12, expectedQuoteVersion: 2, customer: 'Buyer' };
  let observed: any;
  const transport = async (_config: any, endpoint: string, payload: any) => {
    observed = { endpoint, payload }; return { requestId, requestRevision: 13, quotations: [{ id: 'shared', version: 3 }] };
  };
  const result = await sharedQuotationWorkspace(db, actor, new Request('http://localhost/shared-quotation', { method: 'POST', body: JSON.stringify(input) }), transport);
  assert.equal(observed.endpoint, 'jobs-quotation-command'); assert.equal(observed.payload.eventId, eventId);
  assert.equal(observed.payload.revision, 12); assert.equal(observed.payload.actorId, actor.id);
  assert.equal((await result.json()).quotations[0].version, 3);
});

test('Price List themed print uses canonical currency, decimals and customer-safe snapshots', async () => {
  const db = await embedded();
  try {
    await migrate(db);
    const actor: any = { id: 'owner', permissions: ['QUOTE_EDIT'] };
    const requestId = randomUUID();
    const q = { id: randomUUID(), version: 1, customer: '<script>Buyer</script>', date: '2026-10-04', currency: 'INR', taxBasis: 'EXCLUSIVE', taxRate: '0', subtotal: '0.30', taxTotal: '0.00', total: '0.30', lines: [{ name: 'Material', quantity: '3', sellingPrice: '0.1', unit: 'pcs', offer: { cost: 'secret-cost', supplier: 'secret-shop' } }] };
    const result = await sharedQuotationWorkspace(db, actor, new Request('http://localhost/shared-quotation?requestId=' + requestId + '&print=1&version=1'), async () => ({ requestId, quotations: [q] }));
    const html = await result.text(); assert.match(html, /INR 0\.30/); assert.match(html, /&lt;script&gt;/); assert.match(html, /QUOTATION \/ عرض سعر/); assert.doesNotMatch(html, /secret-cost|secret-shop|<script>/);
    const job = await one(db, "SELECT * FROM jobs WHERE kind='QUOTE_PDF'");
    assert.equal(job!.payload.snapshot.company_snapshot.currency, 'INR');
    assert.equal((await one(db, 'SELECT count(*) n FROM quotations'))!.n, 0);
  } finally { await db.close!(); }
});

test('shared quotation editor prints through the real Price List API route and retains version selection', () => {
  const html = renderToStaticMarkup(createElement(QuotationActions, { row: { id: 'request', ownerId: 'owner', items: [], orders: [], quotations: [{ id: 'shared', version: 1, customer: 'Buyer', currency: 'INR', total: '10', lines: [] }] }, data: { actorId: 'owner', suppliers: [], collectionStaff: [] }, busy: false, submit: async () => {} }));
  assert.match(html, /\/amt_price_list\/api\/v1\/shared-quotation\?print=1/);
  assert.match(html, /Quotation version 1/); assert.doesNotMatch(html, /Close editor|Save quotation version/);
});


test('delivery forwarding retains original quantities, revision and event identity', async () => {
  const db: any = { query: async () => ({ rows: [{ data: {} }] }) };
  const actor: any = { id: 'owner', permissions: ['QUOTE_EDIT'] };
  const input = { action: 'orderDelivered', eventId: randomUUID(), requestId: randomUUID(), revision: 10, orderId: 'existing', selected: ['line'], quantities: { line: '2.5' }, deliveryNumber: 'DN-1', receivedConfirmed: true, date: new Date().toISOString() };
  let observed: any;
  await sharedQuotationWorkspace(db, actor, new Request('http://localhost/shared-quotation', { method: 'POST', body: JSON.stringify(input) }), async (_config, endpoint, payload) => { observed = { endpoint, payload }; return { orders: [] }; });
  assert.equal(observed.endpoint, 'jobs-quotation-command');
  for (const field of ['eventId', 'revision', 'orderId', 'deliveryNumber']) assert.equal(observed.payload[field], (input as any)[field]);
  assert.deepEqual(observed.payload.quantities, input.quantities);
  await assert.rejects(sharedQuotationWorkspace(db, { ...actor, permissions: [] }, new Request('http://localhost/shared-quotation', { method: 'POST', body: JSON.stringify(input) })), /permission/i);
});

test('uncertain delivery retries retain their original revision after a background refresh', () => {
  const delivery = { action: 'orderDelivered', requestId: 'r', revision: 8, quantities: { line: '2' }, deliveryNumber: 'DN1' };
  const first = pendingQuotationCommand(null, delivery, () => 'stable');
  const retry = pendingQuotationCommand(first, { ...delivery, revision: 9 }, () => 'different');
  assert.equal(retry.eventId, 'stable'); assert.equal(retry.payload.revision, 8);
  assert.notEqual(pendingQuotationCommand(first, { ...delivery, quantities: { line: '1' } }, () => 'changed').eventId, 'stable');
  assert.equal(quotationCommandRejected({ status: 409 }), true);
  assert.equal(quotationCommandRejected({ status: 502 }), false);
  assert.equal(quotationCommandRejected(new Error('lost response')), false);
});

test('stale ERP saves reach the Price List editor as explicit conflicts rather than uncertain gateway failures', async () => {
  const db: any = { query: async () => ({ rows: [{ data: {} }] }) };
  const request = new Request('http://localhost/shared-quotation', { method: 'POST', body: JSON.stringify({ action: 'saveQuotation', eventId: randomUUID(), requestId: randomUUID(), revision: 1 }) });
  await assert.rejects(sharedQuotationWorkspace(db, { id: 'owner', permissions: ['QUOTE_EDIT'] } as any, request, async () => { throw new ConnectionError('Request changed; refresh before saving', 502, 409); }), (e: any) => e.status === 409 && /refresh/.test(e.message));
});

test('inclusive, exclusive and exempt PDF totals remain canonical despite local settings and rounding', () => {
  for (const taxBasis of ['EXCLUSIVE', 'INCLUSIVE', 'EXEMPT']) {
    const q = { id: 'shared', version: 2, date: '2026-10-04', customer: 'Buyer', currency: 'USD', taxBasis, taxRate: '15', subtotal: taxBasis === 'EXEMPT' ? '0.06' : '0.05', taxTotal: taxBasis === 'EXEMPT' ? '0.00' : '0.01', total: '0.06', lines: [1,2,3].map(n => ({ name: 'Part ' + n, quantity: '1', sellingPrice: '0.02', unit: 'pcs', offer: { cost: 'private-cost' } })) };
    const snapshot = sharedQuotationSnapshot(q, { companyName: 'Brand', companyArabic: '', currency: 'SAR', vat: '99', pdfUnitPrices: 'BOTH' });
    const sum = (field: string) => snapshot.lines.reduce((s: Decimal, l: any) => s.plus(l.price[field]), new Decimal(0)).toFixed(2);
    assert.equal(sum('subtotal'), q.subtotal); assert.equal(sum('vatAmount'), q.taxTotal); assert.equal(sum('total'), q.total);
    const html = quotationHtml(snapshot, {}, ''); assert.match(html, /USD 0\.06/); assert.match(html, /Brand/); assert.match(html, /V2/); assert.doesNotMatch(html, /private-cost|SAR|99%/);
    assert.equal(snapshot.company_snapshot.pdfUnitPrices, taxBasis === 'INCLUSIVE' ? 'INCL' : 'EXCL');
  }
});

test('PDF retry creates no second quotation or job; company snapshot and historical versions stay stable', async () => {
  const db = await embedded();
  try {
    await migrate(db);
    const requestId = randomUUID();
    const q = { id: randomUUID(), version: 1, date: '2026-10-04', customer: 'Buyer', currency: 'SAR', taxBasis: 'EXCLUSIVE', taxRate: '0', subtotal: '10.00', taxTotal: '0.00', total: '10.00', lines: [{ name: 'Part', quantity: '1', sellingPrice: '10', unit: 'pcs' }] };
    const first = await sharedQuotationPdfJob(db, 'owner', requestId, q, 'REQ-1');
    await db.query("UPDATE settings SET data=jsonb_set(data,'{companyName}', '\"Changed branding\"'::jsonb) WHERE id=1");
    const retry = await sharedQuotationPdfJob(db, 'owner', requestId, q, 'REQ-1');
    assert.equal(first.id, retry.id); assert.equal(first.payload.snapshot.company_snapshot.companyName, retry.payload.snapshot.company_snapshot.companyName);
    const second = await sharedQuotationPdfJob(db, 'owner', requestId, { ...q, version: 2 }, 'REQ-1');
    assert.notEqual(second.id, first.id); assert.equal(second.payload.snapshot.company_snapshot.companyName, 'Changed branding');
    await db.query("UPDATE jobs SET status='FAILED' WHERE id=$1", [first.id]);
    const recovered = await sharedQuotationPdfJob(db, 'owner', requestId, q, 'REQ-1');
    assert.notEqual(recovered.id, first.id); assert.deepEqual(recovered.payload.snapshot, first.payload.snapshot);
    assert.equal((await one(db, 'SELECT count(*) n FROM quotations'))!.n, 0);
    await assert.rejects(sharedQuotationPdfDownload(db, { requestId: randomUUID(), quotations: [q] }, first.id, false), /PDF not found/);
    await assert.rejects(sharedQuotationPdfDownload(db, { requestId, quotations: [{ ...q, version: 2 }] }, first.id, false), /PDF not found/);
  } finally { await db.close!(); }
});

test('Price List shows delivery balances and reference controls for existing collected orders', () => {
  const html = renderToStaticMarkup(createElement(QuotationActions, { row: { id: 'r', ownerId: 'owner', items: [], quotations: [], orders: [{ id: 'old', number: 'SO-OLD', mode: 'ORDER_CONFIRMED', status: 'PARTIALLY_COLLECTED', lines: [{ lineId: 'line', name: 'Part', quantity: '5', collected: '3', delivered: '1', availableToDeliver: '2', outstanding: '2', unit: 'pcs', movements: [] }] }] }, data: { actorId: 'owner', suppliers: [], collectionStaff: [] }, busy: false, submit: async () => {} }));
  assert.match(html, /SO-OLD/); assert.match(html, /Mark delivery/); assert.match(html, /Invoice reference/); assert.match(html, /Delivery reference/); assert.match(html, /max=\"2\"/); assert.doesNotMatch(html, /Create a collection order/);
});

test('historical allocations appear in Price List without orders; early collections require explicit confirmation', () => {
  const props: any = { row: { id: 'r', ownerId: 'owner', items: [], quotations: [], orders: [], legacyCollections: [{ allocationId: 'old', itemId: 'item', name: 'Contactor', poNumber: 'PO-OLD', quantity: '5', collected: '3', delivered: '1', availableToDeliver: '2', unit: 'pcs', customerConfirmed: false, deliveries: [] }] }, data: { actorId: 'owner', suppliers: [], collectionStaff: [] }, busy: false, submit: async () => {} };
  const pending = renderToStaticMarkup(createElement(QuotationActions, props));
  assert.match(pending, /PO-OLD/); assert.match(pending, /Confirm existing customer order/); assert.doesNotMatch(pending, /Mark delivery/);
  props.row.legacyCollections[0].customerConfirmed = true;
  const confirmed = renderToStaticMarkup(createElement(QuotationActions, props));
  assert.match(confirmed, /Mark delivery/); assert.match(confirmed, /max="2"/); assert.doesNotMatch(confirmed, /Confirm existing customer order/);
});

test('native quotation routes direct shared records to the creator workspace and cannot duplicate or issue them', async () => {
  const db = await embedded();
  try {
    await migrate(db);
    process.env.SETUP_TOKEN = 'shared-quote-fixture-token-long-enough';
    await setup(db, { token: process.env.SETUP_TOKEN, username: 'shared-owner', password: 'Test-quotation-password-129', name: 'Creator', companyName: 'AMT Electric' });
    const session = await login(db, { username: 'shared-owner', password: 'Test-quotation-password-129' });
    const cookie = sessionCookie(session.token).split(';')[0];
    const owner = (await one(db, "SELECT id FROM users WHERE username='shared-owner'"))!;
    const id = randomUUID();
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'DR-SHARED','DRAFT',$2,'{\"name\":\"Buyer\"}','[]','{\"subtotal\":\"0.00\",\"vat\":\"0.00\",\"total\":\"0.00\"}')", [id, owner.id]);
    await db.query('INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)', [id, JSON.stringify({ erpRequestId: randomUUID(), sharedQuotations: [{ id: randomUUID(), version: 1 }], lines: {} })]);
    const request = (action: string, method: string) => new Request(`http://localhost/amt_price_list/api/v1/quotations/${id}${action ? '/' + action : ''}`, { method, headers: { Cookie: cookie, 'X-CSRF-Token': session.csrf, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    const view = await handle(request('', 'GET'), db);
    assert.equal(view.status, 200); assert.equal((await view.json()).sharedWorkflow, true);
    for (const action of ['duplicate', 'revision', 'issue', 'pdf', 'customer-link', 'submit-approval', 'review']) {
      const result = await handle(request(action, 'POST'), db);
      assert.equal(result.status, 409, action); assert.match((await result.json()).error, /creator workflow/);
    }
    assert.equal((await handle(request('print', 'GET'), db)).status, 409);
    assert.equal((await handle(request('', 'DELETE'), db)).status, 409);
    assert.equal((await one(db, 'SELECT count(*) n FROM quotations'))!.n, 1);
    assert.equal((await one(db, 'SELECT count(*) n FROM jobs'))!.n, 0);
  } finally { await db.close!(); }
});
