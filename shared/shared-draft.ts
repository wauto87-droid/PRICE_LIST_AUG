import Decimal from 'decimal.js';

/** Adapt canonical prices into the existing draft controls without local repricing. */
export function sharedDraft(result: any, source?: any, version?: number) {
  const latest = result.quotations.at(-1);
  const quote = version ? result.quotations.find((q: any) => q.version === version) : latest;
  const items = quote ? quote.lines.map((l: any) => result.items.find((i: any) => i.id === l.itemId)).filter(Boolean) : result.items.filter((i: any) => i.offers.length);
  const currency = quote?.currency || source?.workflowCurrency || items[0]?.offers[0]?.currency || 'SAR';
  const lines = items.map((item: any) => {
    const saved = quote?.lines.find((l: any) => l.itemId === item.id);
    const local = source?.lines.find((l: any) => l.input?.watcherEventId === item.localLineId);
    const offer = saved?.offer || item.offers.find((o: any) => o.id === item.selectedOffer) || item.offers[0];
    const unitPrice = saved?.sellingPrice ?? (item.sellingPrice || local?.price?.finalExcl || '0');
    return { id: local?.id || item.localLineId || item.id, sharedItemId: item.id, sharedOfferId: offer.id, partNumber: item.partNumber || local?.partNumber || '', description: item.name, unit: item.unit,
      workflowCost: local?.workflowCost || { cost: offer.cost, currency: offer.currency, unit: offer.unit, supplier: result.suppliers.find((s: any) => s.id === offer.supplier)?.name || offer.supplier, actorName: result.people?.[offer.actor] || offer.actorName || 'Staff', updatedAt: offer.date, taxBasis: offer.taxBasis },
      input: { type: 'CUSTOM', partNumber: item.partNumber || local?.partNumber || '', description: item.name, unit: item.unit, quantity: saved?.quantity || item.quantity, unitPriceExcl: unitPrice, discount: '0' } };
  });
  const cart = { id: source?.id, number: source?.number || result.number, ownerId: source?.owner_id, sharedRequestId: result.requestId, sharedDocumentId: result.documentId,
    sharedRevision: result.requestRevision, sharedQuoteVersion: latest?.version || 0, sharedViewVersion: quote?.version, workflowCurrency: currency,
    sharedTaxBasis: quote?.taxBasis || 'EXCLUSIVE', sharedTaxRate: quote?.taxRate ?? source?.lines[0]?.price?.vatRate ?? '0', sharedOverrideReason: '',
    sharedCanonicalTotals: quote ? { subtotal: quote.subtotal, vat: quote.taxTotal, total: quote.total } : undefined,
    customer: { ...(source?.customer || {}), ...(quote?.customerDetails || {}), name: quote?.customer || result.customer || '', mobile: quote?.contact || source?.customer?.mobile || '' }, lines, sharedWorkflow: true };
  return { ...recalculateSharedDraft(cart), sharedDirty: false };
}

export function recalculateSharedDraft(cart: any) {
  const rate = new Decimal(cart.sharedTaxBasis === 'EXEMPT' ? 0 : cart.sharedTaxRate || 0).div(100);
  const lines = cart.lines.map((line: any) => {
    const unit = new Decimal(line.input.unitPriceExcl || 0), qty = new Decimal(line.input.quantity || 0);
    const excl = cart.sharedTaxBasis === 'INCLUSIVE' ? unit.div(rate.plus(1)) : unit;
    const subtotal = excl.mul(qty), vat = subtotal.mul(rate);
    return { ...line, price: { quantity: line.input.quantity, finalExcl: excl.toFixed(6), finalIncl: excl.mul(rate.plus(1)).toFixed(6), subtotal: subtotal.toFixed(), vatAmount: vat.toFixed(), total: subtotal.plus(vat).toFixed(), vatRate: rate.mul(100).toFixed() }, pending: false };
  });
  return { ...cart, lines, sharedDirty: true };
}

export function sharedDraftCommand(cart: any) {
  return { action: 'saveQuotation', documentId: cart.sharedDocumentId, requestId: cart.sharedRequestId, revision: cart.sharedRevision, expectedQuoteVersion: cart.sharedQuoteVersion,
    customer: cart.customer.name, contact: cart.customer.mobile || '', customerDetails: { number: cart.customer.number || '', reference: cart.customer.reference || '', notes: cart.customer.notes || '' }, currency: cart.workflowCurrency, taxBasis: cart.sharedTaxBasis, taxRate: cart.sharedTaxBasis === 'EXEMPT' ? '0' : cart.sharedTaxRate,
    overrideReason: cart.sharedOverrideReason || '', lines: cart.lines.map((l: any) => ({ itemId: l.sharedItemId, offerId: l.sharedOfferId, quantity: l.input.quantity, sellingPrice: l.input.unitPriceExcl })) };
}
