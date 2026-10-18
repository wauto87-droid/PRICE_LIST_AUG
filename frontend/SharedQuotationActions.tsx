'use client';
import ResponsiveTable from "./ResponsiveTable";
import { useState } from 'react';
import Decimal from 'decimal.js';
import CollectionAssignmentTable from './CollectionAssignmentTable';
import DeliveryHistory from './DeliveryHistory';
function Button({ asChild, ...props }: any) { return asChild ? props.children : <button className="primary" {...props}/>; }
function Input(props: any) { return <input {...props}/>; }

type Row = Record<string, any>;
const control = 'w-full rounded-md border border-input bg-background p-2 text-sm';

export default function QuotationActions({ row, data, busy, submit, onPdf, initialVersion, onOpenDraft, showFulfillment = false, documentView = false, view = 'all', onPickup }: { row: Row; data: Row; busy: boolean; submit: (body: Row) => Promise<unknown>; onPdf?: (version: number) => void; initialVersion?: number; onOpenDraft?: (mode: 'edit' | 'all' | 'priced') => void; showFulfillment?: boolean; documentView?: boolean; view?: string; onPickup?: (orderId:string, staff?:string, internal?:boolean, supplier?:string)=>void }) {
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
  return <section className="quotation-workspace space-y-4 rounded-xl border bg-card p-5">
    <div hidden={!'all quotation'.split(' ').includes(view)}><h4 className="font-semibold">Customer quotation</h4>
    {documentView && !selected && onOpenDraft && <button type="button" disabled={busy} onClick={() => onOpenDraft('edit')}>{selected ? 'Edit quotation' : 'Edit draft'}</button>}
    {!documentView && onOpenDraft && <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy} onClick={() => onOpenDraft('edit')}>Edit draft ({activeItems.length})</Button><Button type="button" disabled={busy || !activeItems.length} onClick={() => onOpenDraft('all')}>Create quotation — all items ({activeItems.length})</Button><Button type="button" disabled={busy || !priced.length} onClick={() => onOpenDraft('priced')}>Create quotation — priced items ({priced.length})</Button></div>}
    {!documentView && <p>{priced.length} of {activeItems.length} items have confirmed supplier prices. All-items quotations require selling prices for every item.</p>}
    </div>{!documentView && <div hidden={!'all pricing'.split(' ').includes(view)}><h3>Internal pricing</h3>
    <div className="table-scroll"><ResponsiveTable><thead><tr><th>Part number</th><th>Description</th><th>Quantity</th><th>Supplier</th><th>Supplier price</th><th>VAT treatment</th><th>Selling price</th><th>Status</th></tr></thead><tbody>{activeItems.map((i: Row) => { const offer = i.offers.find((o: Row) => o.id === i.selectedOffer) || i.offers.at(-1); const saved = selected?.lines.find((l: Row) => l.itemId === i.id); return <tr key={i.id}><td>{i.partNumber || '—'}</td><td>{i.name}</td><td>{i.quantity} {i.unit}</td><td>{data.suppliers?.find((s: Row) => s.id === offer?.supplier)?.name || offer?.supplier || 'Pending'}</td><td>{offer ? `${offer.currency} ${offer.cost}/${offer.unit}` : 'Pending'}</td><td>{offer?.taxBasis || 'Not confirmed'}</td><td>{saved?.sellingPrice ?? (i.sellingPrice || 'Pending')}</td><td>{priced.some((p: Row) => p.id === i.id) ? 'Supplier price confirmed' : 'Pricing pending'}</td></tr>; })}</tbody></ResponsiveTable></div>
    </div>}<div hidden={!'all quotation'.split(' ').includes(view)}>
    {selected && <header className="quotation-summary">
      <div className="quotation-summary-heading"><div><span className="quotation-eyebrow">Saved quotation · Version {selected.version}</span><h3>{selected.customer || 'Customer'}</h3>{selected.contact && <p>{selected.contact}</p>}<span className="quotation-line-count">{selected.lines.length} {selected.lines.length === 1 ? 'item' : 'items'}</span></div><div className="quotation-summary-total"><span>Quotation total</span><strong>{selected.currency} {selected.total}</strong><small>Including quotation tax</small></div></div>
      <div className="quotation-document-actions" role="toolbar" aria-label="Quotation actions"><label className="quotation-version-field">Saved version<select aria-label="Quotation version" value={selected.version} onChange={e => setVersion(Number(e.target.value))}>{quotes.map(q => <option key={q.version} value={q.version}>Quotation version {q.version}</option>)}</select></label><div className="quotation-document-buttons">{documentView && onOpenDraft && <button type="button" disabled={busy} onClick={() => onOpenDraft('edit')}>Edit quotation</button>}<a href={`/amt_price_list/api/v1/shared-quotation?print=1&requestId=${encodeURIComponent(row.id)}&version=${selected.version}${documentView && row.documentId ? `&documentId=${encodeURIComponent(row.documentId)}` : ''}`} target="_blank" rel="noreferrer">Print quotation / Save PDF</a>{onPdf && <Button type="button" disabled={busy} onClick={() => onPdf(selected.version)}>{busy ? 'Please wait…' : 'Generate PDF'}</Button>}</div></div>
    </header>}
    {selected && <>{selected.lines.some((l: Row) => l.partNumber === undefined) && <p className="quotation-snapshot-note" role="status">This saved version did not record part numbers. Edit and save a new quotation version to include verified part numbers; the original version is preserved.</p>}
    <div className="table-scroll quotation-items-scroll" tabIndex={0} role="region" aria-label="Quotation item table"><ResponsiveTable className="quotation-preview-table" aria-label="Quotation items"><thead><tr><th>Part number</th><th>Description</th><th>Quantity</th><th>Unit</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{selected.lines.map((l: Row) => <tr key={l.itemId}><td><span className="quotation-part-number">{l.partNumber === undefined ? 'Not recorded' : l.partNumber || '—'}</span></td><td><strong>{l.name}</strong>{l.specifications && <small>{l.specifications}</small>}</td><td>{l.quantity}</td><td>{l.unit}</td><td>{l.sellingPrice}</td><td>{new Decimal(l.quantity).mul(l.sellingPrice).toFixed(2)}</td></tr>)}</tbody></ResponsiveTable></div><dl className="quotation-totals"><div><dt>Subtotal</dt><dd>{selected.currency} {selected.subtotal}</dd></div><div><dt>Quotation tax</dt><dd>{selected.currency} {selected.taxTotal}</dd></div><div className="quotation-grand-total"><dt>Grand total</dt><dd>{selected.currency} {selected.total}</dd></div></dl></>}
    {!documentView && !showFulfillment && latest && <p>Open this quotation from Workflow to confirm the customer order, assign pickups and mark delivery.</p>}
    {showFulfillment && selected && !!confirmable.length && <ConfirmationTable key={`${selected.version}`} lines={confirmable} revision={row.requestRevision} version={selected.version} busy={busy} reason={reason} submit={submit}/>}
    </div><div hidden={!'all fulfillment'.split(' ').includes(view)}>
    {showFulfillment && (row.orders || []).filter((o: Row) => o.lines.some((l: Row) => l.customerConfirmed)).map((order: Row) => {
      const available = order.lines.filter((l: Row) => Number(l.remainingToAssign) > 0 && row.items.some((i: Row) => i.id === l.itemId && i.offers.length));
      if (!available.length) return null;
      return <CollectionAssignmentTable key={order.id} lines={available.map((line: Row) => {
        const item = row.items.find((i:Row) => i.id === line.itemId);
        const quoted = quotes.find(q => q.version === order.quoteVersion)?.lines.find((q:Row) => q.itemId === line.itemId);
        return { ...line, offerId: quoted?.offer?.id || item?.offers.find((offer:Row) => offer.supplier === line.supplier || data.suppliers.find((shop:Row) => shop.id === offer.supplier)?.name === line.supplier)?.id || item?.selectedOffer, supplier: quoted?.offer?.supplier || line.supplier };
      })} staff={data.collectionStaff} suppliers={data.suppliers} revision={row.requestRevision} orderId={order.id} busy={busy} admin={admin} submit={submit}/>;
    })}
    {showFulfillment && selected && <details><summary>Authorize early collection from saved version {selected.version}</summary><CollectionAssignmentTable key={`early:${selected.version}`} early quoteVersion={selected.version} revision={row.requestRevision} busy={busy} admin={admin} submit={submit} staff={data.collectionStaff} suppliers={data.suppliers}
      lines={selected.lines.flatMap((line:Row) => { const item = row.items.find((value:Row) => value.id === line.itemId); const remaining = Math.min(Number(line.quantity), Number(item?.unallocatedQuantity || 0), Number(item?.confirmableQuantity || 0)); return line.offer?.id && remaining > 0 ? [{ ...line, name:line.name || item?.name, partNumber:line.partNumber || item?.partNumber, offerId:line.offer.id, supplier:line.offer.supplier, remainingToAssign:String(remaining) }] : []; })}/></details>}
    {showFulfillment && <DeliveryHistory row={row} busy={busy} admin={admin} submit={submit} onPickup={onPickup}/>}
    </div>
  </section>;
}

function ConfirmationTable({lines,version,revision,busy,reason,submit}: any) {
  const [picked,setPicked] = useState<string[]>(lines.map((l: Row) => l.itemId));
  const [basis,setBasis] = useState(revision);
  const [quantities,setQuantities] = useState<Record<string,string>>(() => Object.fromEntries(lines.map((l: Row)=>[l.itemId,String(l.remaining)])));
  return <details><summary>Confirm customer order from version {version}</summary><form onKeyDown={e=>{if(e.key==='Enter' && e.target instanceof HTMLInputElement)e.preventDefault();}} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void submit({action:'confirmQuotation',revision:basis,quoteVersion:version,confirmed:true,poNumber:f.get('poNumber')||'',overrideReason:f.get('overrideReason')||'',lines:lines.filter((l: Row)=>picked.includes(l.itemId)).map((l: Row)=>({itemId:l.itemId,quantity:f.get(`qty:${l.itemId}`)}))}); }}>
    {basis !== revision && <p role="alert">Order quantities changed. Your entry is retained. <button type="button" onClick={()=>{setBasis(revision);setPicked(lines.map((l: Row)=>l.itemId));setQuantities(Object.fromEntries(lines.map((l: Row)=>[l.itemId,String(l.remaining)])));}}>Reload available quantities</button></p>}
    <label><input type="checkbox" checked={picked.length===lines.length} onChange={e=>setPicked(e.target.checked?lines.map((l: Row)=>l.itemId):[])}/>Select all eligible items</label>
    <div className="table-scroll"><ResponsiveTable><thead><tr><th>Select</th><th>Part number</th><th>Description</th><th>Quoted quantity</th><th>Accepted quantity</th><th>Unit</th></tr></thead><tbody>{lines.map((l: Row)=><tr key={l.itemId}><td><input aria-label={`Select ${l.name}`} type="checkbox" checked={picked.includes(l.itemId)} onChange={e=>setPicked(e.target.checked?[...picked,l.itemId]:picked.filter(id=>id!==l.itemId))}/></td><td>{l.partNumber||'—'}</td><td>{l.name}</td><td>{l.quantity}</td><td><Input data-accepted-quantity="true" aria-label={`${l.name} accepted quantity`} name={`qty:${l.itemId}`} type="number" min="0.000001" max={l.remaining} step="0.000001" value={quantities[l.itemId] || ''} onChange={(e: any)=>setQuantities({...quantities,[l.itemId]:e.target.value})} required disabled={busy||!picked.includes(l.itemId)} onKeyDown={(e: any)=>{if(e.key!=='Enter')return;e.preventDefault();const fields=Array.from(e.currentTarget.form.querySelectorAll('input[data-accepted-quantity]:not(:disabled)')) as HTMLInputElement[];fields[fields.indexOf(e.currentTarget)+1]?.focus();}}/></td><td>{l.unit}</td></tr>)}</tbody></ResponsiveTable></div>
    <Input aria-label="Customer order reference" name="poNumber" placeholder="Customer order reference (optional)"/>{reason}<label><input type="checkbox" required/>Customer has confirmed these items and quantities.</label><Button type="submit" disabled={busy||!picked.length||basis!==revision}>Confirm selected items</Button>
  </form></details>;
}
