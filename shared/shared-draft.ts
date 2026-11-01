import Decimal from 'decimal.js';

/** Adapt canonical prices into the existing draft controls without local repricing. */
export function sharedDraft(result: any, source?: any, version?: number, mode: 'edit' | 'all' | 'priced' | 'version' = version ? 'version' : 'edit') {
  const latest = result.quotations.at(-1);
  const quote = version ? result.quotations.find((q: any) => q.version === version) : latest;
  const eligible = (item: any) => item.offers.some((o: any) => !['UNAVAILABLE', 'WAITING', 'WAITING FOR SUPPLIER'].includes(String(o.availability || '').trim().toUpperCase()) && (!o.validUntil || Date.parse(o.validUntil) >= Date.now()));
  const activeItems = result.items.filter((i: any) => i.active !== false);
  const items = mode === 'version' && quote ? quote.lines.map((l: any) => result.items.find((i: any) => i.id === l.itemId)).filter(Boolean) : mode === 'priced' ? activeItems.filter(eligible) : activeItems;
  const omitted = activeItems.filter((i: any) => !items.some((selected: any) => selected.id === i.id)).map((i: any) => ({ id: i.id, partNumber: i.partNumber, name: i.name }));
  const currency = quote?.currency || source?.workflowCurrency || items[0]?.offers[0]?.currency || 'SAR';
  const lines = items.map((item: any) => {
    const saved = quote?.lines.find((l: any) => l.itemId === item.id);
    const local = source?.lines.find((l: any) => l.input?.watcherEventId === item.localLineId);
    const offer = mode === 'version' && saved ? saved.offer : item.offers.find((o: any) => o.id === item.selectedOffer && eligible({offers:[o]})) || item.offers.find((o: any) => eligible({offers:[o]}));
    const localPrice = local?.input?.unitPriceExcl ?? (local?.price?.finalExcl && new Decimal(local.price.finalExcl).gt(0) ? local.price.finalExcl : '');
    const unitPrice = saved?.sellingPrice ?? (item.sellingPrice || localPrice);
    return { id: local?.id || item.localLineId || item.id, sharedItemId: item.id, sharedOfferId: offer?.id, partNumber: item.partNumber || local?.partNumber || '', description: item.name, unit: item.unit,
      workflowCost: offer ? { cost: offer.cost, currency: offer.currency, unit: offer.unit, supplier: result.suppliers.find((s: any) => s.id === offer.supplier)?.name || offer.supplier, actorName: result.people?.[offer.actor] || offer.actorName || 'Staff', updatedAt: offer.date, taxBasis: offer.taxBasis } : undefined,
      input: { type: 'CUSTOM', partNumber: item.partNumber || local?.partNumber || '', description: item.name, unit: item.unit, quantity: saved?.quantity || item.quantity, unitPriceExcl: unitPrice, discount: '0' } };
  });
  const cart = { id: source?.id, number: source?.number || result.number, ownerId: source?.owner_id, sharedRequestId: result.requestId, sharedDocumentId: result.documentId,
    sharedRevision: result.requestRevision, sharedQuoteVersion: latest?.version || 0, sharedViewVersion: quote?.version, workflowCurrency: currency,
    sharedTaxBasis: quote?.taxBasis || 'EXCLUSIVE', sharedTaxRate: quote?.taxRate ?? source?.lines[0]?.price?.vatRate ?? '0', sharedOverrideReason: '',
    sharedCanonicalTotals: quote && items.length === quote.lines.length && items.every((i: any) => quote.lines.some((l: any) => l.itemId === i.id)) ? { subtotal: quote.subtotal, vat: quote.taxTotal, total: quote.total } : undefined,
    customer: { ...(source?.customer || {}), ...(quote?.customerDetails || {}), name: quote?.customer || result.customer || '', mobile: quote?.contact || source?.customer?.mobile || '' }, lines, sharedWorkflow: true, sharedDraftMode: mode, sharedOmittedItems: omitted };
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
  if (!cart.lines.length) throw new Error('Select at least one quotation item.');
  for (const line of cart.lines) {
    const value = String(line.input.unitPriceExcl ?? '').trim();
    if (!/^[0-9]+(\.[0-9]{1,6})?$/.test(value)) throw new Error(`Enter a selling price for ${line.partNumber || line.description}.`);
  }
  return { action: 'saveQuotation', documentId: cart.sharedDocumentId, requestId: cart.sharedRequestId, revision: cart.sharedRevision, expectedQuoteVersion: cart.sharedQuoteVersion,
    customer: cart.customer.name, contact: cart.customer.mobile || '', customerDetails: { number: cart.customer.number || '', reference: cart.customer.reference || '', notes: cart.customer.notes || '' }, currency: cart.workflowCurrency, taxBasis: cart.sharedTaxBasis, taxRate: cart.sharedTaxBasis === 'EXEMPT' ? '0' : cart.sharedTaxRate,
    overrideReason: cart.sharedOverrideReason || '', lines: cart.lines.map((l: any) => ({ itemId: l.sharedItemId, offerId: l.sharedOfferId, quantity: l.input.quantity, sellingPrice: l.input.unitPriceExcl })) };
}
