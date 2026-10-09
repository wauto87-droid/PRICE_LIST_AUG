'use client';
import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
type Row=Record<string,any>;
export default function DeliveryHistory({row,admin,busy,submit,onPickup}:{row:Row;admin:boolean;busy:boolean;submit:(body:Row)=>Promise<unknown>;onPickup?:(orderId:string)=>void}) {
  const balances:Row[]=[...(row.legacyCollections||[]),...(row.orders||[]).flatMap((o:Row)=>o.lines)];
  const candidates:Row[]=row.items.map((item:Row)=>{
    const related=balances.filter(l=>l.itemId===item.id&&l.customerConfirmed);
    const total=(field:string)=>related.reduce((n,l)=>n.plus(l[field]||0),new Decimal(0)).toFixed();
    return {...item,itemId:item.id,collected:total('collected'),delivered:total('delivered'),remaining:total('availableToDeliver')};
  });
  const initial=candidates.filter(l=>new Decimal(l.remaining).gt(0));
  const [picked,setPicked]=useState<string[]>(()=>initial.map(l=>l.itemId));
  const [quantities,setQuantities]=useState<Record<string,string>>(()=>Object.fromEntries(initial.map(l=>[l.itemId,l.remaining])));
  // Retain edited rows even if a refresh consumes or voids their remaining stock.
  const lines=candidates.filter(l=>new Decimal(l.remaining).gt(0)||quantities[l.itemId]!==undefined);
  const deliverable=lines.filter(l=>new Decimal(l.remaining).gt(0));
  const [basis,setBasis]=useState(row.requestRevision);
  const [ack,setAck]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{
    const added=deliverable.filter(l=>quantities[l.itemId]===undefined);
    if(added.length){setQuantities(q=>({...q,...Object.fromEntries(added.map(l=>[l.itemId,l.remaining]))}));setPicked(p=>[...p,...added.map(l=>l.itemId)]);}
  },[JSON.stringify(lines.map(l=>l.itemId))]);
  const eligible=deliverable.filter(l=>picked.includes(l.itemId));
  const stale=basis!==row.requestRevision;
  return <section className="delivery-workspace">
    <h3>Collection & delivery</h3>
    {!!lines.length&&<form onKeyDown={e=>{if(e.key==='Enter'&&e.target instanceof HTMLInputElement)e.preventDefault();}} onSubmit={e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);
      if(!eligible.length||!ack||stale){setError('Select items, acknowledge delivery, and review current quantities.');return;}
      if(!String(f.get('deliveryNumber')||'').trim()&&!String(f.get('invoiceNumber')||'').trim()){setError('Enter a delivery reference.');return;}
      if(eligible.some(l=>!quantities[l.itemId]||!new Decimal(quantities[l.itemId]).gt(0)||new Decimal(quantities[l.itemId]).gt(l.remaining))){setError('Delivery quantities must be positive and within the remaining quantity.');return;}
      setError('');void submit({action:'markDelivery',revision:basis,lines:eligible.map(l=>({itemId:l.itemId,quantity:quantities[l.itemId]})),invoiceNumber:f.get('invoiceNumber')||'',deliveryNumber:f.get('deliveryNumber')||'',date:new Date(String(f.get('date'))).toISOString(),receivedConfirmed:true,overrideReason:f.get('overrideReason')||''}).then(ok=>{if(ok===true){setPicked([]);setAck(false);}});
    }}>
      <h4>Mark delivery</h4>
      {stale&&<p role="alert">Progress changed. Your entry is retained. Review the remaining quantities, then <button type="button" onClick={()=>setBasis(row.requestRevision)}>Use updated quantities</button>.</p>}
      <label><input type="checkbox" checked={!!deliverable.length&&eligible.length===deliverable.length} onChange={e=>setPicked(e.target.checked?deliverable.map(l=>l.itemId):[])}/> Select all deliverable items</label>
      <div className="table-scroll"><table><thead><tr><th>Select</th><th>Part number</th><th>Description</th><th>Collected</th><th>Delivered</th><th>Remaining</th><th>Delivery quantity</th><th>Unit</th></tr></thead><tbody>{lines.map(l=><tr key={l.itemId}><td><input aria-label={`Select delivery ${l.name}`} type="checkbox" checked={picked.includes(l.itemId)} onChange={e=>setPicked(e.target.checked?[...picked,l.itemId]:picked.filter(id=>id!==l.itemId))}/></td><td>{l.partNumber||'—'}</td><td>{l.name}</td><td>{l.collected}</td><td>{l.delivered}</td><td>{l.remaining}</td><td><input data-delivery-quantity aria-label={`${l.name} delivery quantity`} type="number" min="0.000001" step="0.000001" max={l.remaining} required disabled={busy||!picked.includes(l.itemId)} value={quantities[l.itemId]??l.remaining} onChange={e=>setQuantities(q=>({...q,[l.itemId]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const fields=Array.from(e.currentTarget.form!.querySelectorAll<HTMLInputElement>('input[data-delivery-quantity]:not(:disabled)'));fields[fields.indexOf(e.currentTarget)+1]?.focus();}}}/></td><td>{l.unit}</td></tr>)}</tbody></table></div>
      <div className="grid"><label>Delivery reference<input name="deliveryNumber" maxLength={500}/></label><label>Delivery date<input name="date" type="datetime-local" required/></label></div>
      <details><summary>Optional supporting details</summary><label>Invoice reference (optional)<input name="invoiceNumber" maxLength={500}/></label></details>
      {admin&&<label>Administrator reason<input name="overrideReason" required minLength={5}/></label>}
      <label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} required/> I confirm these goods were delivered to the customer.</label>
      {error&&<p role="alert">{error}</p>}<button type="submit" className="primary" disabled={busy||!eligible.length||stale}>Mark selected quantities delivered</button>
    </form>}
    {!lines.length&&<p>No confirmed collected quantities are currently available for delivery.</p>}
    <h4>Collection and delivery history</h4>
    <div className="table-scroll"><table><thead><tr><th>Part / item</th><th>Supplier / shop</th><th>Customer</th><th>Confirmed</th><th>Collected</th><th>Delivered</th><th>Date / references</th></tr></thead><tbody>{balances.map((l,index)=>{
      const item=row.items.find((i:Row)=>i.id===l.itemId);
      const deliveries=l.movements?.filter((m:Row)=>!m.voided&&['COLLECT','DELIVER'].includes(m.type))||l.deliveries||[];
      const supplierIds=[...new Set([...deliveries.filter((m:Row)=>m.type==='COLLECT').map((m:Row)=>m.supplier),l.supplier].filter(Boolean))];
      const supplier= l.supplierName||supplierIds.map(id=>row.suppliers?.find((s:Row)=>s.id===id)?.name||id).join(', ')||'—';
      return <tr key={`${l.orderId||index}:${l.itemId}`}><td>{l.partNumber||item?.partNumber||'—'}<div>{l.name||item?.name}</div></td><td>{supplier}</td><td>{row.customer||'Customer'}</td><td>{l.confirmedQuantity||'0'} {l.unit}</td><td>{l.collected} {l.unit}</td><td>{l.delivered} {l.unit}</td><td>{l.poNumber||(l.poReferences||[]).join(', ')}{deliveries.map((m:Row)=><div key={m.id}>{m.type==='COLLECT'?'Collected':'Delivered'} · {Number.isFinite(Date.parse(m.date))?new Date(m.date).toLocaleString():'Date not recorded'} · {m.quantity} {l.unit} · {m.deliveryNumber||m.invoiceNumber||m.evidence||'—'}</div>)}</td></tr>;
    })}</tbody></table></div>
    {onPickup&&(row.orders||[]).filter((o:Row)=>o.lines.some((l:Row)=>new Decimal(l.collected||0).gt(0))).map((o:Row)=><button key={o.id} type="button" disabled={busy} onClick={()=>onPickup(o.id)}>Download internal collection slip · {o.number}</button>)}
  </section>;
}
