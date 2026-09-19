import { OrderItem } from './types';

export const detectColumnIndices = (headers: string[]) => {
  const findIdx = (predicate: (h: string) => boolean, fallback: number) => {
    const idx = headers.findIndex((h) => predicate(String(h || '').toLowerCase().trim()));
    return idx !== -1 ? idx : fallback;
  };

  return {
    date: findIdx((h) => h.includes('date'), 0),
    docNo: findIdx((h) => h.includes('doc'), 1),
    customer: findIdx((h) => h.includes('cust'), 2),
    itemCode: findIdx((h) => h.includes('code') || h.includes('item code'), 3),
    itemName: findIdx((h) => h.includes('item name') || (h.includes('name') && !h.includes('cust')), 4),
    unit: findIdx((h) => h.includes('unit'), 5),
    qty: findIdx((h) => h.includes('qty'), 6),
    invoiced: findIdx((h) => h.includes('invoiced') && !h.includes('return'), 7),
    invoiceRet: findIdx((h) => h.includes('invoice return') || h.includes('inv return'), 8),
    deliveryRet: findIdx((h) => h.includes('delivery return') || h.includes('del return'), 9),
    balance: findIdx((h) => h.includes('balance'), 10),
  };
};

export const deriveItemStatus = (item: Partial<OrderItem>): OrderItem['status'] => {
  const bal = Number(item.balance) || 0;
  const inv = Number(item.invoiced) || 0;
  const delRet = Number(item.deliveryRet) || 0;
  const invRet = Number(item.invoiceRet) || 0;

  // 1. Balance >= 1 strictly takes precedence for Pending
  if (bal >= 1) return 'pending';
  // 2. Returns only classify as Returned if balance is settled/zero
  if (bal === 0 && (delRet > 0 || invRet > 0)) return 'returned';
  // 3. Completed if balance is 0
  if (bal === 0 && (inv > 0 || (item.qty || 0) > 0)) return 'completed';
  // 4. Partially fulfilled
  if (inv > 0 && bal > 0) return 'partial';

  return 'pending';
};

export const transitionItemStatus = (item: OrderItem, targetStatus: OrderItem['status']): OrderItem => {
  const qty = Number(item.qty) || 1;
  const updated = { ...item, status: targetStatus };

  switch (targetStatus) {
    case 'completed':
      updated.invoiced = qty;
      updated.balance = 0;
      updated.deliveryRet = 0;
      updated.invoiceRet = 0;
      break;
    case 'pending':
      updated.balance = qty;
      updated.invoiced = 0;
      updated.deliveryRet = 0;
      updated.invoiceRet = 0;
      break;
    case 'returned':
      updated.deliveryRet = qty;
      updated.balance = 0;
      updated.invoiced = 0;
      break;
    case 'partial':
      const half = Math.max(1, Math.floor(qty / 2));
      updated.invoiced = half;
      updated.balance = Math.max(0, qty - half);
      break;
  }
  return updated;
};
