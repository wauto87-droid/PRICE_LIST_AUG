'use client';
import { useState } from 'react';
import Decimal from 'decimal.js';
function Button({ asChild, ...props }: any) { return asChild ? props.children : <button className="primary" {...props}/>; }
function Input(props: any) { return <input {...props}/>; }

type Row = Record<string, any>;
const control = 'w-full rounded-md border border-input bg-background p-2 text-sm';

export default function QuotationActions({ row, data, busy, submit, onPdf, initialVersion, onOpenDraft, showFulfillment = false }: { row: Row; data: Row; busy: boolean; submit: (body: Row) => Promise<unknown>; onPdf?: (version: number) => void; initialVersion?: number; onOpenDraft?: (mode: 'edit' | 'all' | 'priced') => void; showFulfillment?: boolean }) {
  const quotes: Row[] = row.quotations || [];
  const latest = quotes.at(-1);
  const [version, setVersion] = useState<number | undefined>(initialVersion);
  const selected = quotes.find(q => q.version === version) || latest;
  const activeItems = row.items.filter((i: Row) => i.active !== false);
  const priced = activeItems.filter((i: Row) => i.offers.some((o: Row) => !['UNAVAILABLE','WAITING','WAITING FOR SUPPLIER'].includes(String(o.availability || '').trim().toUpperCase()) && (!o.validUntil || Date.parse(o.validUntil) >= Date.now())));
  const admin = data.actorId !== row.ownerId;
  const confirmable = (selected?.lines || []).map((l: Row) => {
    const item = row.items.find((i: Row) => i.id === l.itemId);
    return { ...l, partNumber: item?.partNumber, remaining: Math.max(0, Math.min(Number(l.quantity), Number(l.confirmableQuantity ?? item?.confirmableQuantity ?? 0))) };
  }).filter((l: Row) => l.remaining > 0);
  const reason = admin && <label className="block text-sm">Administrator reason<Input required minLength={5} name="overrideReason"/></label>;
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <h4 className="font-semibold">Customer quotation</h4>
    {onOpenDraft && <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy} onClick={() => onOpenDraft('edit')}>Edit draft ({activeItems.length})</Button><Button type="button" disabled={busy || !activeItems.length} onClick={() => onOpenDraft('all')}>Create quotation — all items ({activeItems.length})</Button><Button type="button" disabled={busy || !priced.length} onClick={() => onOpenDraft('priced')}>Create quotation — priced items ({priced.length})</Button></div>}
    <p>{priced.length} of {activeItems.length} items have confirmed supplier prices. All-items quotations require selling prices for every item.</p>
    <div className="table-scroll"><table><thead><tr><th>Part number</th><th>Description</th><th>Quantity</th><th>Supplier</th><th>Supplier price</th><th>VAT treatment</th><th>Selling price</th><th>Status</th></tr></thead><tbody>{activeItems.map((i: Row) => { const offer = i.offers.find((o: Row) => o.id === i.selectedOffer) || i.offers.at(-1); const saved = selected?.lines.find((l: Row) => l.itemId === i.id); return <tr key={i.id}><td>{i.partNumber || '—'}</td><td>{i.name}</td><td>{i.quantity} {i.unit}</td><td>{data.suppliers?.find((s: Row) => s.id === offer?.supplier)?.name || offer?.supplier || 'Pending'}</td><td>{offer ? `${offer.currency} ${offer.cost}/${offer.unit}` : 'Pending'}</td><td>{offer?.taxBasis || 'Not confirmed'}</td><td>{saved?.sellingPrice ?? (i.sellingPrice || 'Pending')}</td><td>{priced.some((p: Row) => p.id === i.id) ? 'Supplier price confirmed' : 'Pricing pending'}</td></tr>; })}</tbody></table></div>
    {selected && <div className="flex flex-wrap items-center gap-3"><select aria-label="Quotation version" className={`${control} max-w-56`} value={selected.version} onChange={e => setVersion(Number(e.target.value))}>{quotes.map(q => <option key={q.version} value={q.version}>Quotation version {q.version}</option>)}</select><span>{selected.customer} · {selected.currency} {selected.total}</span><Button asChild variant="outline"><a href={`/amt_price_list/api/v1/shared-quotation?print=1&requestId=${encodeURIComponent(row.id)}&version=${selected.version}`} target="_blank" rel="noreferrer">Print quotation / Save PDF</a></Button>{onPdf && <Button disabled={busy} onClick={() => onPdf(selected.version)}>Download themed PDF</Button>}</div>}
    {selected && <><p>{selected.customer} · {selected.contact}</p>{selected.lines.map((l: Row) => <div className="quote-line" key={l.itemId}><span><strong>{l.name}</strong><small>{l.specifications}</small></span><span>{l.quantity} {l.unit} × {l.sellingPrice}</span></div>)}<p className="text-end">Subtotal {selected.currency} {selected.subtotal} · Tax {selected.taxTotal}</p><h3 className="text-end">{selected.currency} {selected.total}</h3></>}
    {!showFulfillment && latest && <p>Open this quotation from Workflow to confirm the customer order, assign pickups and mark delivery.</p>}
    {showFulfillment && selected && !!confirmable.length && <ConfirmationTable key={`${selected.version}`} lines={confirmable} revision={row.requestRevision} version={selected.version} busy={busy} reason={reason} submit={submit}/>}
    {showFulfillment && (row.orders || []).filter((o: Row) => o.lines.some((l: Row) => l.customerConfirmed)).map((order: Row) => {
      const available = order.lines.filter((l: Row) => Number(l.remainingToAssign) > 0 && row.items.some((i: Row) => i.id === l.itemId && i.offers.length));
      if (!available.length) return null;
      return <form key={order.id} className="space-y-3 border-t pt-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({ action: 'approveCollection', orderId: order.id, poReference: f.get('poReference') || '', overrideReason: f.get('overrideReason') || '', lines: available.filter((l: Row) => f.get(`include:${l.itemId}`)).map((l: Row) => ({ itemId: l.itemId, offerId: quotes.find(q => q.version === order.quoteVersion)?.lines.find((q: Row) => q.itemId === l.itemId)?.offer?.id || row.items.find((i: Row) => i.id === l.itemId)?.offers.find((o: Row) => o.supplier === l.supplier || data.suppliers.find((s: Row) => s.id === o.supplier)?.name === l.supplier)?.id || row.items.find((i: Row) => i.id === l.itemId)?.selectedOffer || row.items.find((i: Row) => i.id === l.itemId)?.offers[0]?.id, quantity: l.remainingToAssign, owner: f.get('owner'), due: f.get('due') || '' })) }); }}>
        <h4 className="font-semibold">Assign collection</h4><label className="block text-sm">Default collector<select className={control} name="owner" required><option value="">Choose staff</option>{data.collectionStaff.filter((s: Row) => s.teams.includes('*') || s.teams.includes(row.branch)).map((s: Row) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {available.map((l: Row) => <label key={l.itemId} className="block text-sm"><input name={`include:${l.itemId}`} type="checkbox" defaultChecked/> {l.name} · {l.remainingToAssign} {l.unit}</label>)}
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

function ConfirmationTable({lines,version,revision,busy,reason,submit}: any) {
  const [picked,setPicked] = useState<string[]>(lines.map((l: Row) => l.itemId));
  const [basis,setBasis] = useState(revision);
  const [quantities,setQuantities] = useState<Record<string,string>>(() => Object.fromEntries(lines.map((l: Row)=>[l.itemId,String(l.remaining)])));
  return <details><summary>Confirm customer order from version {version}</summary><form onKeyDown={e=>{if(e.key==='Enter' && e.target instanceof HTMLInputElement)e.preventDefault();}} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({action:'confirmQuotation',revision:basis,quoteVersion:version,confirmed:true,poNumber:f.get('poNumber')||'',overrideReason:f.get('overrideReason')||'',lines:lines.filter((l: Row)=>picked.includes(l.itemId)).map((l: Row)=>({itemId:l.itemId,quantity:f.get(`qty:${l.itemId}`)}))}); }}>
    {basis !== revision && <p role="alert">Order quantities changed. Your entry is retained. <button type="button" onClick={()=>{setBasis(revision);setPicked(lines.map((l: Row)=>l.itemId));setQuantities(Object.fromEntries(lines.map((l: Row)=>[l.itemId,String(l.remaining)])));}}>Reload available quantities</button></p>}
    <label><input type="checkbox" checked={picked.length===lines.length} onChange={e=>setPicked(e.target.checked?lines.map((l: Row)=>l.itemId):[])}/>Select all eligible items</label>
    <div className="table-scroll"><table><thead><tr><th>Select</th><th>Part number</th><th>Description</th><th>Quoted quantity</th><th>Accepted quantity</th><th>Unit</th></tr></thead><tbody>{lines.map((l: Row)=><tr key={l.itemId}><td><input aria-label={`Select ${l.name}`} type="checkbox" checked={picked.includes(l.itemId)} onChange={e=>setPicked(e.target.checked?[...picked,l.itemId]:picked.filter(id=>id!==l.itemId))}/></td><td>{l.partNumber||'—'}</td><td>{l.name}</td><td>{l.quantity}</td><td><Input data-accepted-quantity="true" aria-label={`${l.name} accepted quantity`} name={`qty:${l.itemId}`} type="number" min="0.000001" max={l.remaining} step="0.000001" value={quantities[l.itemId] || ''} onChange={(e: any)=>setQuantities({...quantities,[l.itemId]:e.target.value})} required disabled={busy||!picked.includes(l.itemId)} onKeyDown={(e: any)=>{if(e.key!=='Enter')return;e.preventDefault();const fields=Array.from(e.currentTarget.form.querySelectorAll('input[data-accepted-quantity]:not(:disabled)')) as HTMLInputElement[];fields[fields.indexOf(e.currentTarget)+1]?.focus();}}/></td><td>{l.unit}</td></tr>)}</tbody></table></div>
    <Input aria-label="Customer order reference" name="poNumber" placeholder="Customer order reference (optional)"/>{reason}<label><input type="checkbox" required/>Customer has confirmed these items and quantities.</label><Button type="submit" disabled={busy||!picked.length||basis!==revision}>Confirm selected items</Button>
  </form></details>;
}
