'use client';
import { useState } from 'react';
function Button({ asChild, ...props }: any) { return asChild ? props.children : <button className="primary" {...props}/>; }
function Input(props: any) { return <input {...props}/>; }

type Row = Record<string, any>;
const control = 'w-full rounded-md border border-input bg-background p-2 text-sm';

export default function QuotationActions({ row, data, busy, submit, onPdf, initialVersion }: { row: Row; data: Row; busy: boolean; submit: (body: Row) => Promise<unknown>; onPdf?: (version: number) => void; initialVersion?: number }) {
  const quotes: Row[] = row.quotations || [];
  const latest = quotes.at(-1);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Row>();
  const draftQuote = draft?.latest;
  const draftItems: Row[] = draft?.priced || [];
  const [version, setVersion] = useState<number | undefined>(initialVersion);
  const selected = quotes.find(q => q.version === version) || latest;
  const priced = row.items.filter((i: Row) => i.offers.length);
  const admin = data.actorId !== row.ownerId;
  const reason = admin && <label className="block text-sm">Administrator reason<Input required minLength={5} name="overrideReason"/></label>;
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Customer quotation</h4>{!!priced.length && <Button variant="outline" disabled={busy} onClick={() => { if (!editing) setDraft({ latest: structuredClone(latest), priced: structuredClone(priced), revision: row.revision ?? row.requestRevision }); setEditing(!editing); }}>{editing ? 'Close editor' : latest ? 'Open quotation' : 'Create quotation'}</Button>}</div>
    {!latest && !editing && <p className="text-sm text-muted-foreground">{priced.length ? 'Prices collected. Create a quotation for the customer.' : 'Waiting for supplier prices.'}</p>}
    {selected && <div className="flex flex-wrap items-center gap-3"><select aria-label="Quotation version" className={`${control} max-w-56`} value={selected.version} onChange={e => setVersion(Number(e.target.value))}>{quotes.map(q => <option key={q.version} value={q.version}>Quotation version {q.version}</option>)}</select><span>{selected.customer} · {selected.currency} {selected.total}</span><Button asChild variant="outline"><a href={`/amt_price_list/api/v1/shared-quotation?print=1&requestId=${encodeURIComponent(row.id)}&version=${selected.version}`} target="_blank" rel="noreferrer">Print quotation / Save PDF</a></Button>{onPdf && <Button disabled={busy} onClick={() => onPdf(selected.version)}>Download themed PDF</Button>}</div>}
    {editing && draft && <form key={`${row.id}:${draftQuote?.version || 0}`} className="space-y-3" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const lines = draftItems.filter((i: Row) => f.get(`include:${i.id}`)).map((i: Row) => ({ itemId: i.id, offerId: f.get(`offer:${i.id}`), quantity: f.get(`qty:${i.id}`), sellingPrice: f.get(`price:${i.id}`) }));
      void submit({ action: 'saveQuotation', revision: draft.revision, expectedQuoteVersion: draftQuote?.version || 0, customer: f.get('customer'), contact: f.get('contact'), currency: f.get('currency'), taxBasis: f.get('taxBasis'), taxRate: f.get('taxRate'), lines, overrideReason: f.get('overrideReason') || '' }).then(result => { if (result !== false) setEditing(false); });
    }}>
      {draft.revision !== (row.revision ?? row.requestRevision) && <p role="alert">This request changed while you were editing. Close the editor and reopen the quotation to load the latest version before saving.</p>}
      <div className="grid gap-3 sm:grid-cols-2"><label>Customer<Input name="customer" required defaultValue={draftQuote?.customer || row.customer}/></label><label>Contact<Input name="contact" defaultValue={draftQuote?.contact || ''}/></label><label>Currency<Input name="currency" required pattern="[A-Z]{3}" defaultValue={draftQuote?.currency || draftItems[0]?.offers[0]?.currency || 'INR'}/></label><label>Tax<select className={control} name="taxBasis" defaultValue={draftQuote?.taxBasis || 'EXCLUSIVE'}><option value="EXCLUSIVE">Tax additional</option><option value="INCLUSIVE">Tax included</option><option value="EXEMPT">Exempt</option></select></label><label>Tax rate %<Input name="taxRate" required inputMode="decimal" defaultValue={draftQuote?.taxRate || '0'}/></label></div>
      {draftItems.map((i: Row) => { const saved = draftQuote?.lines.find((l: Row) => l.itemId === i.id); return <div key={i.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4"><label><input type="checkbox" name={`include:${i.id}`} defaultChecked={draftQuote ? !!saved : true}/> {i.name}</label><label className="text-sm">Supplier cost<select className={control} name={`offer:${i.id}`} defaultValue={saved?.offer.id || i.selectedOffer || i.offers[0].id}>{i.offers.map((o: Row) => <option key={o.id} value={o.id}>{data.suppliers.find((s: Row) => s.id === o.supplier)?.name || o.supplier} · {o.currency} {o.cost}/{o.unit}</option>)}</select></label><label className="text-sm">Quantity ({i.unit})<Input name={`qty:${i.id}`} defaultValue={saved?.quantity || i.quantity} inputMode="decimal"/></label><label className="text-sm">Selling price / {i.unit}<Input name={`price:${i.id}`} defaultValue={saved?.sellingPrice || i.sellingPrice || ''} inputMode="decimal"/></label></div>; })}
      {reason}<Button disabled={busy}>Save quotation version</Button>
    </form>}
    {selected && <details onToggle={e => { if (e.currentTarget.open) setVersion(selected.version); }}><summary className="cursor-pointer font-medium">Confirm customer order from version {selected.version}</summary><form key={`confirm:${selected.version}`} className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'confirmQuotation', quoteVersion: selected.version, confirmed: true, poNumber: f.get('poNumber') || '', overrideReason: f.get('overrideReason') || '', lines: selected.lines.filter((l: Row) => f.get(`include:${l.itemId}`)).map((l: Row) => ({ itemId: l.itemId, quantity: f.get(`qty:${l.itemId}`) })) }); }}>
      {selected.lines.map((l: Row) => <label key={l.itemId} className="flex flex-wrap items-center gap-3"><input type="checkbox" name={`include:${l.itemId}`} defaultChecked/>{l.name}<Input aria-label={`${l.name} accepted quantity`} className="max-w-40" name={`qty:${l.itemId}`} defaultValue={l.quantity} inputMode="decimal"/>{l.unit}</label>)}
      <Input name="poNumber" placeholder="Customer order reference (optional)"/>{reason}<label className="flex gap-2 text-sm"><input type="checkbox" required/>Customer has confirmed these items and quantities.</label><Button disabled={busy}>Confirm customer order</Button>
    </form></details>}
    {(row.orders || []).filter((o: Row) => o.quoteVersion).map((order: Row) => {
      const available = order.lines.filter((l: Row) => !l.allocations.length && Number(l.outstanding) > 0);
      if (!available.length) return null;
      return <form key={order.id} className="space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'approveCollection', orderId: order.id, overrideReason: f.get('overrideReason') || '', lines: available.filter((l: Row) => f.get(`include:${l.itemId}`)).map((l: Row) => ({ itemId: l.itemId, offerId: quotes.find(q => q.version === order.quoteVersion)?.lines.find((q: Row) => q.itemId === l.itemId)?.offer.id, quantity: l.outstanding, owner: f.get(`owner:${l.itemId}`) || f.get('owner'), due: f.get('due') || '' })) }); }}>
        <h4 className="font-semibold">Assign collection · quotation version {order.quoteVersion}</h4><label className="block text-sm">Default collector<select className={control} name="owner" required><option value="">Choose staff</option>{data.collectionStaff.filter((s: Row) => s.teams.includes('*') || s.teams.includes(row.branch)).map((s: Row) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {available.map((l: Row) => <label key={l.itemId} className="block text-sm"><input name={`include:${l.itemId}`} type="checkbox" defaultChecked/> {l.name} · {l.outstanding} {l.unit}<select className={control} name={`owner:${l.itemId}`}><option value="">Use default collector</option>{data.collectionStaff.filter((s: Row) => s.teams.includes('*') || s.teams.includes(row.branch)).map((s: Row) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}
        <label>Deadline (optional)<Input type="date" name="due"/></label>{reason}<Button disabled={busy}>Assign collection</Button>
      </form>;
    })}
    {(row.legacyCollections || []).map((legacy: Row) => <section key={legacy.allocationId} className="border">
      <h4>Existing collection · {legacy.poNumber || legacy.name}</h4><p>{legacy.name} · Collected {legacy.collected} · Delivered {legacy.delivered} · Available {legacy.availableToDeliver} {legacy.unit}</p>
      {!legacy.customerConfirmed && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'confirmLegacyCollection', itemId: legacy.itemId, allocationId: legacy.allocationId, confirmed: true, reference: f.get('reference') || '', overrideReason: f.get('overrideReason') || '' }); }}><label>Customer order reference (optional)<Input name="reference"/></label>{reason}<label><input type="checkbox" required/>Customer confirmed this existing allocation and its saved quotation.</label><Button disabled={busy}>Confirm existing customer order</Button></form>}
      {legacy.customerConfirmed && Number(legacy.availableToDeliver) > 0 && <DeliveryForm order={{ id: legacy.allocationId, lines: [{ ...legacy, lineId: legacy.allocationId }] }} admin={admin} busy={busy} submit={body => submit({ ...body, action: 'legacyDelivered', itemId: legacy.itemId, allocationId: legacy.allocationId, quantity: body.quantities[legacy.allocationId] })}/>}
      <details><summary>Delivery history</summary>{(legacy.deliveries || []).map((m: Row) => <p key={m.id}>{m.quantity} {legacy.unit} · Invoice {m.invoiceNumber || '—'} · Delivery {m.deliveryNumber || '—'} · {new Date(m.date).toLocaleString()}</p>)}</details>
    </section>)}
    {(row.orders || []).map((order: Row) => <section key={order.id} className="border">
      <h4>{order.number} · {order.status?.replaceAll('_', ' ')}</h4>
      {order.lines.map((line: Row) => <p key={line.lineId}>{line.name} · Confirmed {line.quantity} · Collected {line.collected} · Delivered {line.delivered} · Available for delivery {line.availableToDeliver} {line.unit}</p>)}
      {order.mode === 'ORDER_CONFIRMED' && order.lines.some((l: Row) => Number(l.availableToDeliver) > 0) && <DeliveryForm order={order} admin={admin} busy={busy} submit={submit}/>}
      {order.mode === 'EARLY_AUTHORIZED' && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'orderConfirm', orderId: order.id, selected: order.lines.map((l: Row) => l.lineId), authorized: true, poNumber: f.get('reference') || '', overrideReason: f.get('overrideReason') || '' }); }}><label>Customer order reference (optional)<Input name="reference"/></label>{reason}<label><input type="checkbox" required/>Customer confirmed this existing order.</label><Button disabled={busy}>Confirm existing customer order</Button></form>}
      {order.lines.some((l: Row) => Number(l.outstanding) > 0) && <details><summary>Cancel remaining collection</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'orderCancel', orderId: order.id, selected: order.lines.filter((l: Row) => Number(l.outstanding) > 0).map((l: Row) => l.lineId), reason: f.get('reason'), overrideReason: f.get('reason') }); }}><label>Reason<Input name="reason" required minLength={5}/></label><Button disabled={busy}>Cancel uncollected quantities</Button></form></details>}
      <details><summary>Delivery history</summary>{order.lines.flatMap((l: Row) => (l.movements || []).filter((m: Row) => m.type === 'DELIVER').map((m: Row) => <p key={m.id}>{l.name}: {m.quantity} {l.unit} · Invoice {m.invoiceNumber || '—'} · Delivery {m.deliveryNumber || '—'} · {new Date(m.date).toLocaleString()}</p>))}</details>
    </section>)}
  </section>;
}

function DeliveryForm({ order, admin, busy, submit }: { order: Row; admin: boolean; busy: boolean; submit: (body: Row) => Promise<unknown> }) {
  const [error, setError] = useState('');
  return <form onSubmit={e => {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const selected = order.lines.filter((l: Row) => Number(f.get(l.lineId)) > 0).map((l: Row) => l.lineId);
    if (!selected.length || (!String(f.get('invoiceNumber') || '').trim() && !String(f.get('deliveryNumber') || '').trim())) { setError('Choose quantities and enter an invoice or delivery reference.'); return; }
    setError('');
    void submit({ action: 'orderDelivered', orderId: order.id, selected, quantities: Object.fromEntries(selected.map((id: string) => [id, f.get(id)])), invoiceNumber: f.get('invoiceNumber'), deliveryNumber: f.get('deliveryNumber'), date: new Date(String(f.get('date'))).toISOString(), receivedConfirmed: true, overrideReason: f.get('overrideReason') || '' }).then(result => { if (result !== false) form.reset(); });
  }}>
    <h4>Mark delivery</h4>
    {order.lines.filter((l: Row) => Number(l.availableToDeliver) > 0).map((l: Row) => <label key={l.lineId}>{l.name} · Available {l.availableToDeliver} {l.unit}<Input type="number" min="0" max={l.availableToDeliver} step="0.000001" name={l.lineId} placeholder="Quantity to deliver"/></label>)}
    <label>Invoice reference<Input name="invoiceNumber" maxLength={500}/></label><label>Delivery reference<Input name="deliveryNumber" maxLength={500}/></label><label>Delivery date<Input name="date" type="datetime-local" required/></label>
    {admin && <label>Administrator reason<Input name="overrideReason" required minLength={5}/></label>}
    <label><input required type="checkbox"/>I confirm these goods were delivered to the customer.</label>{error && <p role="alert">{error}</p>}<Button disabled={busy}>Mark selected quantities delivered</Button>
  </form>;
}
