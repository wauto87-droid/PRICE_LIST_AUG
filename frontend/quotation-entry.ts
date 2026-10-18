import { calculateCustom, customLineInput } from '@/backend/pricing/engine';
import { buildLookupLineRequest } from './lookup-pricing';
import { visibleLevels } from './levels';
import { api } from './api';

export type EntryMatch = { source: 'CATALOG' | 'CUSTOM'; item: any };

export const validEntryQuantity = (value: unknown) =>
  /^\d{1,12}(?:\.\d{1,6})?$/.test(String(value ?? '').trim()) && Number(value) > 0;

export const canAppendEntry = (lines: any[]) => {
  if (!lines.length) return true;
  const last = lines.at(-1);
  return !!last.input && !last.compatibilityIssue &&
    !!(last.input.type === 'CUSTOM' || last.input.productId || last.productId) && validEntryQuantity(last.input.quantity);
};

export function customEntryLine(value: any, vat: string) {
  if (!String(value.description ?? '').trim()) throw new Error('Enter an item description.');
  if (!validEntryQuantity(value.quantity)) throw new Error('Enter a positive quantity.');
  const input = customLineInput.parse({ type: 'CUSTOM', ...value, discount: value.discount || '0' });
  return { source: 'CUSTOM' as const, partNumber: input.partNumber || 'CUSTOM', description: input.description,
    unit: input.unit, quantityPrecision: 6, input, price: calculateCustom(input, vat), pending: false };
}

export async function entryMatchLine(match: EntryMatch, quantity: string, vat: string, request = api) {
  if (!validEntryQuantity(quantity)) throw new Error('Enter a positive quantity.');
  const item = match.item;
  if (match.source === 'CUSTOM') return customEntryLine({ partNumber: item.reference || '',
    description: item.description, unit: item.unit, quantity, unitPriceExcl: String(item.suggestedUnitPrice),
    discount: String(item.suggestedDiscount ?? '0'), reusableItemId: item.id }, vat);
  const sellingLevel = item.defaultLevel ?? 'END_CUSTOMER';
  const level = visibleLevels(item).find(candidate => candidate.code === sellingLevel);
  const base = buildLookupLineRequest(item.id, sellingLevel, quantity, '0');
  const input = level?.entryMode === 'MARKUP' || level?.method === 'COST_MARKUP' ? { ...base, markup: '0' } : base;
  const price = await request('pricing', 'POST', input);
  return { source: 'CATALOG' as const, productId: item.id, sellingLevel, partNumber: item.partNumber,
    description: item.description, unit: item.unit, quantityPrecision: item.quantityPrecision,
    sellingLevels: visibleLevels(item), input, price, pending: false, offline: false };
}
