'use client';
import { useState } from 'react';
import Decimal from 'decimal.js';
function Button({ asChild, ...props }: any) { return asChild ? props.children : <button className="primary" {...props}/>; }
function Input(props: any) { return <input {...props}/>; }

type Row = Record<string, any>;
const control = 'w-full rounded-md border border-input bg-background p-2 text-sm';

export default function QuotationActions({ row, data, busy, submit, onPdf, initialVersion, onOpenDraft, showFulfillment = false }: { row: Row; data: Row; busy: boolean; submit: (body: Row) => Promise<unknown>; onPdf?: (version: number) => void; initialVersion?: number; onOpenDraft?: () => void; showFulfillment?: boolean }) {
  const quotes: Row[] = row.quotations || [];
  const latest = quotes.at(-1);
  const [version, setVersion] = useState<number | undefined>(initialVersion);
  const selected = quotes.find(q => q.version === version) || latest;
  const priced = row.items.filter((i: Row) => i.offers.length);
  const admin = data.actorId !== row.ownerId;
  const confirmable = (selected?.lines || []).map((l: Row) => {
    const item = row.items.find((i: Row) => i.id === l.itemId);
    return { ...l, remaining: Math.max(0, Math.min(Number(l.quantity), Number(l.confirmableQuantity ?? item?.confirmableQuantity ?? 0))) };
  }).filter((l: Row) => l.remaining > 0);
  const reason = admin && <label className="block text-sm">Administrator reason<Input required minLength={5} name="overrideReason"/></label>;
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Customer quotation</h4>{onOpenDraft && !!priced.length && <Button disabled={busy} onClick={onOpenDraft}>{latest ? 'Edit draft' : 'Create quotation'}</Button>}</div>
    {!latest && <p>{priced.length ? 'Open the existing draft to review prices and convert to quotation.' : 'Waiting for supplier prices.'}</p>}
    {selected && <div className="flex flex-wrap items-center gap-3"><select aria-label="Quotation version" className={`${control} max-w-56`} value={selected.version} onChange={e => setVersion(Number(e.target.value))}>{quotes.map(q => <option key={q.version} value={q.version}>Quotation version {q.version}</option>)}</select><span>{selected.customer} · {selected.currency} {selected.total}</span><Button asChild variant="outline"><a href={`/amt_price_list/api/v1/shared-quotation?print=1&requestId=${encodeURIComponent(row.id)}&version=${selected.version}`} target="_blank" rel="noreferrer">Print quotation / Save PDF</a></Button>{onPdf && <Button disabled={busy} onClick={() => onPdf(selected.version)}>Download themed PDF</Button>}</div>}
    {selected && <><p>{selected.customer} · {selected.contact}</p>{selected.lines.map((l: Row) => <div className="quote-line" key={l.itemId}><span><strong>{l.name}</strong><small>{l.specifications}</small></span><span>{l.quantity} {l.unit} × {l.sellingPrice}</span></div>)}<p className="text-end">Subtotal {selected.currency} {selected.subtotal} · Tax {selected.taxTotal}</p><h3 className="text-end">{selected.currency} {selected.total}</h3></>}
    {!showFulfillment && latest && <p>Open this quotation from Pricing &amp; Collection Jobs to confirm the customer order, assign pickups and mark delivery.</p>}
    {showFulfillment && selected && !!confirmable.length && <details onToggle={e => { if (e.currentTarget.open) setVersion(selected.version); }}><summary className="cursor-pointer font-medium">Confirm customer order from version {selected.version}</summary><form key={`confirm:${selected.version}:${row.requestRevision}`} className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'confirmQuotation', quoteVersion: selected.version, confirmed: true, poNumber: f.get('poNumber') || '', overrideReason: f.get('overrideReason') || '', lines: confirmable.filter((l: Row) => f.get(`include:${l.itemId}`)).map((l: Row) => ({ itemId: l.itemId, quantity: f.get(`qty:${l.itemId}`) })) }); }}>
      {confirmable.map((l: Row) => <label key={l.itemId} className="flex flex-wrap items-center gap-3"><input type="checkbox" name={`include:${l.itemId}`} defaultChecked/>{l.name}<Input aria-label={`${l.name} accepted quantity`} className="max-w-40" name={`qty:${l.itemId}`} defaultValue={l.remaining} inputMode="decimal"/>{l.unit}</label>)}
      <Input name="poNumber" placeholder="Customer order reference (optional)"/>{reason}<label className="flex gap-2 text-sm"><input type="checkbox" required/>Customer has confirmed these items and quantities.</label><Button disabled={busy}>Confirm customer order</Button>
    </form></details>}
    {showFulfillment && (row.orders || []).filter((o: Row) => o.lines.some((l: Row) => l.customerConfirmed)).map((order: Row) => {
      const available = order.lines.filter((l: Row) => Number(l.remainingToAssign) > 0 && row.items.some((i: Row) => i.id === l.itemId && i.offers.length));
      if (!available.length) return null;
      return <form key={order.id} className="space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'approveCollection', orderId: order.id, poReference: f.get('poReference') || '', overrideReason: f.get('overrideReason') || '', lines: available.filter((l: Row) => f.get(`include:${l.itemId}`)).map((l: Row) => ({ itemId: l.itemId, offerId: quotes.find(q => q.version === order.quoteVersion)?.lines.find((q: Row) => q.itemId === l.itemId)?.offer.id || row.items.find((i: Row) => i.id === l.itemId)?.offers.find((o: Row) => o.supplier === l.supplier || data.suppliers.find((s: Row) => s.id === o.supplier)?.name === l.supplier)?.id || row.items.find((i: Row) => i.id === l.itemId)?.selectedOffer || row.items.find((i: Row) => i.id === l.itemId)?.offers[0]?.id, quantity: l.remainingToAssign, owner: f.get(`owner:${l.itemId}`) || f.get('owner'), due: f.get('due') || '' })) }); }}>
        <h4 className="font-semibold">Assign collection</h4><label className="block text-sm">Default collector<select className={control} name="owner" required><option value="">Choose staff</option>{data.collectionStaff.filter((s: Row) => s.teams.includes('*') || s.teams.includes(row.branch)).map((s: Row) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {available.map((l: Row) => <label key={l.itemId} className="block text-sm"><input name={`include:${l.itemId}`} type="checkbox" defaultChecked/> {l.name} · {l.remainingToAssign} {l.unit}<select className={control} name={`owner:${l.itemId}`}><option value="">Use default collector</option>{data.collectionStaff.filter((s: Row) => s.teams.includes('*') || s.teams.includes(row.branch)).map((s: Row) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}
        <label>PO reference (optional)<Input name="poReference" maxLength={500}/></label><label>Deadline (optional)<Input type="date" name="due"/></label>{reason}<Button disabled={busy}>Assign collection</Button>
      </form>;
    })}
    {showFulfillment && <FulfillmentHistory row={row} busy={busy} admin={admin} submit={submit}/>}
  </section>;
}

function FulfillmentHistory({ row, admin, busy, submit }: { row: Row; admin: boolean; busy: boolean; submit: (body: Row) => Promise<unknown> }) {
  const balances: Row[] = [...(row.legacyCollections || []), ...(row.orders || []).flatMap((o: Row) => o.lines)];
  const lines: Row[] = row.items.map((item: Row) => ({ ...item, itemId: item.id, availableToDeliver: balances.filter(l => l.itemId === item.id && l.customerConfirmed).reduce((n, l) => n.plus(l.availableToDeliver || 0), new Decimal(0)).toFixed() })).filter((l: Row) => l.availableToDeliver > 0);
  const [error, setError] = useState('');
  return <>
    {!!lines.length && <form onSubmit={e => {
      e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
      const selected = lines.filter(l => Number(f.get(l.itemId)) > 0);
      if (!selected.length || (!String(f.get('invoiceNumber') || '').trim() && !String(f.get('deliveryNumber') || '').trim())) { setError('Choose quantities and enter an invoice or delivery reference.'); return; }
      setError('');
      void submit({ action: 'markDelivery', lines: selected.map(l => ({ itemId: l.itemId, quantity: f.get(l.itemId) })), invoiceNumber: f.get('invoiceNumber'), deliveryNumber: f.get('deliveryNumber'), date: new Date(String(f.get('date'))).toISOString(), receivedConfirmed: true, overrideReason: f.get('overrideReason') || '' }).then(result => { if (result !== false) form.reset(); });
    }}>
      <h4>Mark delivery</h4>
      {lines.map(l => <label key={l.itemId}>{l.name} · Available {l.availableToDeliver} {l.unit}<Input type="number" min="0" max={l.availableToDeliver} step="0.000001" name={l.itemId} placeholder="Quantity to deliver"/></label>)}
      <label>Invoice reference<Input name="invoiceNumber" maxLength={500}/></label><label>Delivery reference<Input name="deliveryNumber" maxLength={500}/></label><label>Delivery date<Input name="date" type="datetime-local" required/></label>
      {admin && <label>Administrator reason<Input name="overrideReason" required minLength={5}/></label>}
      <label><input required type="checkbox"/>I confirm these goods were delivered to the customer.</label>{error && <p role="alert">{error}</p>}<Button disabled={busy}>Mark selected quantities delivered</Button>
    </form>}
    {!!balances.length && <details><summary>Collection and delivery history</summary>{balances.map((l, index) => <div key={index}><p>{l.name} · Confirmed {l.confirmedQuantity || '0'} · Collected {l.collected} · Delivered {l.delivered} {l.unit}</p>{(l.deliveries || l.movements?.filter((m: Row) => m.type === 'DELIVER') || []).map((m: Row) => <p key={m.id}>{m.quantity} {l.unit} · Invoice {m.invoiceNumber || '—'} · Delivery {m.deliveryNumber || '—'} · {new Date(m.date).toLocaleString()}</p>)}</div>)}</details>}
  </>;
}
