import test from 'node:test';
import assert from 'node:assert/strict';
import { compactQuotationNumber, quotationMoney } from '../frontend/quotation-display';

test('unit price presentation preserves fractional precision and explicit zero', () => {
  for (const [raw, display] of [['50.540000','50.54'],['1.005000','1.005'],['0.000001','0.000001'],['0.000000','0'],['1780','1780'],['','']]) {
    assert.equal(compactQuotationNumber(raw),display);
    if (raw) assert.equal(Number(raw),Number(display));
  }
  assert.equal(compactQuotationNumber('1.'),'1.');
  assert.equal(quotationMoney('1453.025'),'1453.03');
  assert.equal(quotationMoney('0'),'0.00');
  assert.equal(quotationMoney(undefined),'—');
  assert.equal(quotationMoney('1.005000','BHD'),'1.005');
});
