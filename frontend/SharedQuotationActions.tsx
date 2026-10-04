'use client';
import { useState } from 'react';
function Button({ asChild, ...props }: any) { return asChild ? props.children : <button {...props}/>; }
function Input(props: any) { return <input {...props}/>; }

type Row = Record<string, any>;
const control = 'w-full rounded-md border border-input bg-background p-2 text-sm';

export default function QuotationActions({ row, data, busy, submit }: { row: Row; data: Row; busy: boolean; submit: (body: Row) => Promise<unknown> }) {
  const quotes: Row[] = row.quotations || [];
  const latest = quotes.at(-1);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Row>();
  const draftQuote = draft?.latest;
  const draftItems: Row[] = draft?.priced || [];
  const [version, setVersion] = useState<number>();
  const selected = quotes.find(q => q.version === version) || latest;
  const priced = row.items.filter((i: Row) => i.offers.length);
  const admin = data.actorId !== row.ownerId;
  const reason = admin && <label className="block text-sm">Administrator reason<Input required minLength={5} name="overrideReason"/></label>;
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Customer quotation</h4>{!!priced.length && <Button variant="outline" disabled={busy} onClick={() => { if (!editing) setDraft({ latest: structuredClone(latest), priced: structuredClone(priced), revision: row.revision ?? row.requestRevision }); setEditing(!editing); }}>{latest ? 'Edit quotation' : 'Create quotation'}</Button>}</div>
    {!latest && !editing && <p className="text-sm text-muted-foreground">{priced.length ? 'Prices collected. Create a quotation for the customer.' : 'Waiting for supplier prices.'}</p>}
    {selected && <div className="flex flex-wrap items-center gap-3"><select aria-label="Quotation version" className={`${control} max-w-56`} value={selected.version} onChange={e => setVersion(Number(e.target.value))}>{quotes.map(q => <option key={q.version} value={q.version}>Quotation version {q.version}</option>)}</select><span>{selected.customer} · {selected.currency} {selected.total}</span><Button asChild variant="outline"><a href={`/amt_price_list/api/v1/shared-quotation?print=1&requestId=${encodeURIComponent(row.id)}&version=${selected.version}`} target="_blank" rel="noreferrer">Print quotation / Save PDF</a></Button></div>}
    {editing && draft && <form key={`${row.id}:${draftQuote?.version || 0}`} className="space-y-3" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const lines = draftItems.filter((i: Row) => f.get(`include:${i.id}`)).map((i: Row) => ({ itemId: i.id, offerId: f.get(`offer:${i.id}`), quantity: f.get(`qty:${i.id}`), sellingPrice: f.get(`price:${i.id}`) }));
      void submit({ action: 'saveQuotation', revision: draft.revision, expectedQuoteVersion: draftQuote?.version || 0, customer: f.get('customer'), contact: f.get('contact'), currency: f.get('currency'), taxBasis: f.get('taxBasis'), taxRate: f.get('taxRate'), lines, overrideReason: f.get('overrideReason') || '' }).then(result => { if (result !== false) setEditing(false); });
    }}>
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
  </section>;
}
