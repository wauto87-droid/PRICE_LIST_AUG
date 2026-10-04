import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { embedded, migrate, one } from '../backend/core/db';
import { adminCommand } from '../backend/integrations/core';
import { receiveSharedQuotation, sharedQuotationWorkspace } from '../backend/integrations/shared-quotation';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import QuotationActions from '../frontend/SharedQuotationActions';
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

test('Price List print uses canonical decimals and escapes customer text without showing offers', async () => {
  const db: any = { query: async () => ({ rows: [{ data: {} }] }) };
  const actor: any = { id: 'owner', permissions: ['QUOTE_EDIT'] };
  const q = { id: 'shared', version: 1, customer: '<script>Buyer</script>', date: '2026-10-04', currency: 'INR', subtotal: '0.30', taxTotal: '0.00', total: '0.30', lines: [{ name: 'Material', quantity: '3', sellingPrice: '0.1', unit: 'pcs', offer: { cost: 'secret-cost', supplier: 'secret-shop' } }] };
  const result = await sharedQuotationWorkspace(db, actor, new Request(`http://localhost/shared-quotation?requestId=${randomUUID()}&print=1&version=1`), async () => ({ quotations: [q] }));
  const html = await result.text(); assert.match(html, /0\.30/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /secret-cost|secret-shop|<script>/);
});

test('shared quotation editor prints through the real Price List API route and retains version selection', () => {
  const html = renderToStaticMarkup(createElement(QuotationActions, { row: { id: 'request', ownerId: 'owner', items: [], orders: [], quotations: [{ id: 'shared', version: 1, customer: 'Buyer', currency: 'INR', total: '10', lines: [] }] }, data: { actorId: 'owner', suppliers: [], collectionStaff: [] }, busy: false, submit: async () => {} }));
  assert.match(html, /\/amt_price_list\/api\/v1\/shared-quotation\?print=1/);
  assert.match(html, /Quotation version 1/); assert.match(html, /Confirm customer order/);
});
