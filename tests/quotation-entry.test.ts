import test from 'node:test';
import assert from 'node:assert/strict';
import { canAppendEntry, customEntryLine, entryMatchLine, validEntryQuantity } from '../frontend/quotation-entry';
import { normalizeEditableQuotationCart } from '../shared/quotation-line-compat';
import { QuotationRowIdentity, reorderQuotationRows } from '../frontend/quotation-row-order';

test('next-entry row requires a real item and valid positive quantity, and never changes the quotation data', () => {
  for (const value of ['', '0', '-1', '1e2', '1,000', '1.', '0.0000001']) assert.equal(validEntryQuantity(value), false);
  for (const value of ['1', '0.001', '100', '1.000001']) assert.equal(validEntryQuantity(value), true);
  assert.equal(canAppendEntry([]), true);
  assert.equal(canAppendEntry([{ input: { quantity: '1' } }]), false);
  const line = customEntryLine({ partNumber: 'CUSTOM-1', description: 'Bracket', unit: 'pcs', quantity: '2', unitPriceExcl: '12.50' }, '15');
  const rows = [line]; const before = JSON.stringify(rows);
  for (let i = 0; i < 10; i++) assert.equal(canAppendEntry(rows), true);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(canAppendEntry([{ ...line, input: { ...line.input, quantity: '' } }]), false);
  assert.equal(canAppendEntry([{ ...line, compatibilityIssue: 'Missing identity' }]), false);
  assert.equal(canAppendEntry([{ productId: 'catalog', input: { productId: 'catalog', quantity: '1' } }]), true);
});

test('saved custom selection retains its identity, exact price, discount and unit without a catalogue pricing request', async () => {
  const line = await entryMatchLine({ source: 'CUSTOM', item: { id: '11111111-1111-4111-8111-111111111111', reference: 'BRKT', description: 'Bracket', unit: 'pcs', suggestedUnitPrice: '1.005001', suggestedDiscount: '5' } }, '2', '15', async () => { throw new Error('Must not request catalogue pricing'); });
  assert.ok(line.source === 'CUSTOM');
  assert.equal(line.input.reusableItemId, '11111111-1111-4111-8111-111111111111');
  assert.equal(line.input.unitPriceExcl, '1.005001');
  assert.equal(line.input.discount, '5');
  assert.equal(line.input.quantity, '2');
  assert.equal(line.unit, 'pcs');
  assert.ok(line.price);
});

test('catalogue selection uses its configured selling level and markup rules, without overrides', async () => {
  let submitted: any;
  const request: any = async (path: string, method: string, input: any) => { submitted = { path, method, input }; return { finalExcl: '45.00', total: '103.50' }; };
  const line = await entryMatchLine({ source: 'CATALOG', item: { id: 'product', partNumber: 'MCB', description: 'Breaker', defaultLevel: 'RETAIL', unit: 'pcs', quantityPrecision: 0,
    sellingLevels: [{ code: 'RETAIL', method: 'COST_MARKUP', masterExcl: '45' }] } }, '2', '15', request);
  assert.ok(line.source === 'CATALOG');
  assert.equal(submitted.path, 'pricing'); assert.equal(submitted.method, 'POST');
  assert.equal(submitted.input.sellingLevel, 'RETAIL'); assert.equal(submitted.input.markup, '0');
  assert.equal(submitted.input.override, false); assert.equal(submitted.input.quantity, '2');
  assert.equal(line.price.total, '103.50'); assert.equal(line.productId, 'product');
  assert.equal(canAppendEntry([line]), true);
});

test('inline custom details reject empty descriptions and invalid quantities before being added', () => {
  assert.throws(() => customEntryLine({ description: '', quantity: '1', unitPriceExcl: '12' }, '15'), /description/);
  assert.throws(() => customEntryLine({ description: 'Bracket', quantity: '0', unitPriceExcl: '12' }, '15'), /quantity/);
});

test('compatibility normalization preserves sortable row references and explicit blank quantity edits', () => {
  const a = customEntryLine({ partNumber: 'A', description: 'First', quantity: '1', unitPriceExcl: '5' }, '15');
  const b = customEntryLine({ partNumber: 'B', description: 'Second', quantity: '2', unitPriceExcl: '10' }, '15');
  const cart = normalizeEditableQuotationCart({ lines: [a, b] });
  const identity = new QuotationRowIdentity(); const ids = identity.sync(cart.lines, 'draft');
  const moved = normalizeEditableQuotationCart({ lines: reorderQuotationRows(cart.lines, 0, 1) });
  assert.equal(moved.lines[1], cart.lines[0]);
  assert.deepEqual(identity.sync(moved.lines, 'draft'), [ids[1], ids[0]]);
  const cleared = normalizeEditableQuotationCart({ lines: [{ ...a, input: { ...a.input, quantity: '' } }] });
  assert.equal(cleared.lines[0].input.quantity, '');
  assert.match(cleared.lines[0].compatibilityIssue, /quantity/);
  assert.equal(canAppendEntry(cleared.lines), false);
  const spaced = { ...a, input: { ...a.input, description: 'Existing description ' } };
  assert.equal(normalizeEditableQuotationCart({ lines: [spaced] }).lines[0], spaced);
});
