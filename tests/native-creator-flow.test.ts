import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { embedded, migrate } from '../backend/core/db';
import { sharedDraft, sharedDraftCommand, recalculateSharedDraft } from '../shared/shared-draft';
import Cart from '../frontend/Cart';
import Actions from '../frontend/SharedQuotationActions';
import { retireObsoleteCollectionAssignments, canonicalCollectionProgress } from '../backend/integrations/jobs';
import { sharedQuotationWorkspace } from '../backend/integrations/shared-quotation';
import { setup, login, authenticate, sessionCookie } from '../backend/auth/service';
import { handle } from '../backend/api/router';
import { totals } from '../backend/pricing/engine';

const offer = { id: 'offer-1', supplier: 'supplier-1', cost: '83', currency: 'SAR', unit: 'pcs', actor: 'staff-1', date: '2026-10-04', taxBasis: 'Excluding VAT' };
const result = { requestId: 'request-1', documentId: 'document-1', number: 'REQ-1', requestRevision: 7, ownerId: 'owner', actorId: 'owner', branch: 'A', customer: 'Buyer', people: { 'staff-1': 'Price collector' }, suppliers: [{ id: 'supplier-1', name: 'Supplier' }], collectionStaff: [], items: [{ id: 'item-1', localLineId: 'line-1', name: 'Contactor', partNumber: 'P-1', quantity: '3', unit: 'pcs', selectedOffer: offer.id, offers: [offer] }], quotations: [] as any[], orders: [] as any[] };
const source = { id: 'document-1', number: 'AMT-QT-0008', owner_id: 'owner', workflowCurrency: 'SAR', customer: { name: 'Buyer', number: 'C-1', reference: 'Reference' }, lines: [{ input: { watcherEventId: 'line-1' }, price: { finalExcl: '100', vatRate: '15' } }] };

test('shared requests use the existing draft controls, cost notes and canonical save identity', () => {
  const draft = sharedDraft(result, source);
  assert.equal(draft.id, source.id); assert.equal(draft.number, source.number);
  assert.equal(draft.lines[0].sharedItemId, 'item-1'); assert.equal(draft.lines[0].input.unitPriceExcl, '100');
  const html = renderToStaticMarkup(React.createElement(Cart, { t: (en: string) => en, user: { id: 'owner', permissions: [] }, settings: { vat: '99' }, cart: draft, setCart() {}, online: true, onSaved() {} }));
  assert.match(html, /Convert to quotation/); assert.match(html, /Price collector/); assert.match(html, /83/);
  assert.doesNotMatch(html, /Save quotation version|Supplier cost<select|CustomLineCatalogResolver/);
  const command = sharedDraftCommand(draft);
  assert.equal(command.requestId, result.requestId); assert.equal(command.documentId, source.id); assert.equal(command.revision, 7);
  assert.equal(command.lines[0].offerId, offer.id); assert.equal(command.customerDetails.number, 'C-1');
});

test('opening an existing version preserves canonical tax, totals and selling prices regardless of local defaults', () => {
  const canonical = { ...result, quotations: [{ id: 'shared-1', version: 2, customer: 'Canonical buyer', customerDetails: { number: 'CAN-1', reference: 'CAN-REF' }, currency: 'SAR', taxBasis: 'INCLUSIVE', taxRate: '15', subtotal: '300.00', taxTotal: '45.00', total: '345.00', lines: [{ itemId: 'item-1', quantity: '3', sellingPrice: '115', offer }] }] };
  const draft = sharedDraft(canonical, { ...source, lines: [{ ...source.lines[0], price: { finalExcl: '9999', vatRate: '99' } }] });
  assert.equal(draft.sharedTaxRate, '15'); assert.equal(draft.lines[0].input.unitPriceExcl, '115'); assert.equal(draft.customer.number, 'CAN-1');
  assert.deepEqual(draft.sharedCanonicalTotals, { subtotal: '300.00', vat: '45.00', total: '345.00' });
  assert.equal(sharedDraftCommand(draft).lines[0].sellingPrice, '115');
  draft.lines[0].input.quantity = '1';
  assert.equal(recalculateSharedDraft(draft).lines[0].price.total, '115');
});

test('edited draft preview rounds once at the quotation total, retaining small fractional line values', () => {
  const lines = Array.from({ length: 199 }, () => ({ input: { quantity: '0.0001', unitPriceExcl: '0.005' } }));
  lines.push({ input: { quantity: '1', unitPriceExcl: '0.0049' } });
  const draft = recalculateSharedDraft({ sharedTaxBasis: 'EXEMPT', sharedTaxRate: '0', lines });
  assert.equal(totals(draft.lines.map((l: any) => l.price)).total, '0.00');
});

test('quotation detail has confirmation and PO assignment, with no second quotation editor', () => {
  const quote = { id: 'shared-1', version: 1, customer: 'Buyer', total: '345', lines: [{ itemId: 'item-1', name: 'Contactor', quantity: '3', unit: 'pcs', sellingPrice: '100', offer }] };
  const order = { id: 'order-1', mode: 'ORDER_CONFIRMED', quoteVersion: 1, lines: [{ lineId: 'item-1', itemId: 'item-1', name: 'Contactor', quantity: '1', cancelled: '0', toDeliver: '1', outstanding: '1', allocations: [], availableToDeliver: '0' }] };
  const row = { ...result, id: result.requestId, quotations: [quote], orders: [order] };
  const html = renderToStaticMarkup(React.createElement(Actions, { row, data: row, busy: false, submit: async () => true, onOpenDraft() {} }));
  assert.match(html, /Edit draft/); assert.match(html, /PO reference \(optional\)/); assert.match(html, /Assign collection/); assert.match(html, /Confirm customer order/);
  assert.doesNotMatch(html, /Close editor|Save quotation version|Selling price \/|Supplier cost<select/);
  assert.match(html, /value="2"/);
});

test('explicit obsolete 409 assignments are retired without replaying jobs or deleting history', async () => {
  const db = await embedded();
  try {
    await migrate(db);
    const id = randomUUID(), eventId = randomUUID(), uncertain = randomUUID();
    const payload = { documentId: id, eventId, kind: 'COLLECTION', selected: ['line-1'] };
    await db.query('INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)', [id, JSON.stringify({ lines: { 'line-1': { COLLECTION: { token: eventId, status: 'PENDING_ERP_SYNC' } } } })]);
    await db.query("INSERT INTO sw_job_outbox(id,channel,endpoint,payload,state,error) VALUES($1,'REMOTE','jobs-assign',$2::jsonb,'FAILED',$3)", [eventId, JSON.stringify(payload), 'Remote delivery failed: Remote HTTP 409: Confirm the shared quotation and assign collection through jobs-quotation-command']);
    await db.query("INSERT INTO sw_job_outbox(id,channel,endpoint,payload,state,error) VALUES($1,'REMOTE','jobs-assign',$2::jsonb,'FAILED','Network timeout')", [uncertain, JSON.stringify({ ...payload, eventId: uncertain })]);
    await retireObsoleteCollectionAssignments(db, id); await retireObsoleteCollectionAssignments(db, id);
    const rows = (await db.query('SELECT id,state FROM sw_job_outbox')).rows;
    assert.equal(rows.find(r => r.id === eventId)!.state, 'REJECTED'); assert.equal(rows.find(r => r.id === uncertain)!.state, 'FAILED');
    const link = (await db.query('SELECT data FROM sw_job_documents WHERE id=$1', [id])).rows[0];
    assert.equal(link.data.lines['line-1'].COLLECTION.status, 'REJECTED'); assert.equal(rows.length, 2);
    assert.equal((await db.query('SELECT count(*) n FROM quotations')).rows[0].n, 0);
  } finally { await db.close!(); }
});

test('job progress displays canonical collector and PO reference rather than rejected local state', () => {
  const canonical = { ...result, orders: [{ id: 'order-1', status: 'COLLECTION_PENDING', lines: [{ itemId: 'item-1', allocations: ['allocation-1'], outstanding: '3', supplier: 'Supplier', staff: [{ id: 'staff-1' }], poReferences: ['PO-1'], movements: [] }] }] };
  const jobs = canonicalCollectionProgress(canonical, 'line-1', { PRICING: { status: 'COMPLETED' }, COLLECTION: { status: 'REJECTED' } });
  assert.equal(jobs.PRICING.status, 'COMPLETED'); assert.equal(jobs.COLLECTION.status, 'ASSIGNED'); assert.equal(jobs.COLLECTION.notes, 'PO reference: PO-1');
});

test('converted drafts retain one document and appear in the native quotation list with canonical totals', async () => {
  const db = await embedded();
  try {
    await migrate(db); process.env.WORKFLOW_INTEGRATION_ENABLED = 'true';
    process.env.SETUP_TOKEN = 'native-flow-fixture-token-long-enough';
    await setup(db, { token: process.env.SETUP_TOKEN, username: 'native-owner', password: 'Native-flow-password-129', name: 'Creator', companyName: 'AMT Electric' });
    const session = await login(db, { username: 'native-owner', password: 'Native-flow-password-129' });
    const cookie = sessionCookie(session.token).split(';')[0];
    const actor = await authenticate(db, new Request('http://localhost', { headers: { Cookie: cookie } }));
    const id = randomUUID();
    await db.query("INSERT INTO quotations(id,number,status,owner_id,customer,lines,totals) VALUES($1,'AMT-QT-0008','DRAFT',$2,'{\"name\":\"Old buyer\"}','[]','{\"total\":\"9999\"}')", [id, actor.id]);
    await db.query('INSERT INTO sw_job_documents(id,data) VALUES($1,$2::jsonb)', [id, JSON.stringify({ erpRequestId: 'request-1', lines: {} })]);
    const canonical = { ...result, documentId: id, quotations: [{ id: 'shared-1', version: 1, customer: 'Canonical buyer', contact: '123', currency: 'USD', subtotal: '100', taxTotal: '15', total: '115', lines: [] }] };
    const response = await sharedQuotationWorkspace(db, actor, new Request('http://localhost/shared-quotation', { method: 'POST', body: JSON.stringify({ action: 'saveQuotation', documentId: id, revision: 7, expectedQuoteVersion: 0, eventId: randomUUID() }) }), async () => canonical);
    assert.equal(response.status, 200);
    const list = await handle(new Request('http://localhost/amt_price_list/api/v1/quotations?status=ISSUED', { headers: { Cookie: cookie } }), db);
    assert.equal(list.status, 200);
    const quotes = await list.json(); assert.equal(quotes.length, 1); assert.equal(quotes[0].id, id); assert.equal(quotes[0].number, 'AMT-QT-0008');
    assert.equal(quotes[0].totals.total, '115'); assert.equal(quotes[0].currency, 'USD'); assert.equal(quotes[0].customer.name, 'Canonical buyer');
    const pdf = await sharedQuotationWorkspace(db, actor, new Request('http://localhost/shared-quotation', { method: 'POST', body: JSON.stringify({ action: 'quotationPdf', requestId: result.requestId, quoteVersion: 1, eventId: randomUUID() }) }), async () => canonical);
    assert.equal(pdf.status, 200);
    const snapshot = (await db.query("SELECT payload FROM jobs WHERE kind='QUOTE_PDF'")).rows[0].payload.snapshot;
    assert.equal(snapshot.number, 'AMT-QT-0008 · V1');
    assert.equal((await db.query('SELECT count(*) n FROM quotations')).rows[0].n, 1);
  } finally { await db.close!(); }
});
