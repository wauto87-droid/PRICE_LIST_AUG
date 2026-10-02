'use client';
import { useEffect, useState, useRef } from 'react';
import { api } from './api';

export default function PricingCollectionJobs({ documentId }: { documentId?: string }) {
  const [rows, setRows] = useState<any[]>([]); const [current, setCurrent] = useState(documentId || '');
  const [doc, setDoc] = useState<any>(); const [staff, setStaff] = useState<any[]>([]); const [userId, setUserId] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const [version, setVersion] = useState<number>();
  const retry = useRef<{ hash: string; id: string } | null>(null);
  const [workflowVersion, setWorkflowVersion] = useState<number>();
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [quantities, setQuantities] = useState<Record<string,string>>({});
  async function load(id = current) {
    try {
      if (id) setDoc(await api(`workflow-jobs?documentId=${encodeURIComponent(id)}`));
      else { const result = await api('workflow-jobs'); setRows(result.rows); setUserId(result.userId); }
      setError('');
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { void load(current); const timer = setInterval(() => void load(current), 10000); return () => clearInterval(timer); }, [current]);
  useEffect(() => { if (current) api('workflow-jobs?staff=1').then(r => setStaff(r.staff)).catch(e => setError(e.message)); }, [current]);
  const command = async (body: any) => {
    setBusy(true); setError('');
    try { delete body.eventId; const payload = { ...body, documentId: current, version: version ?? doc.version, workflowVersion: workflowVersion ?? doc.workflowVersion }; const hash = JSON.stringify(payload); if (retry.current?.hash !== hash) retry.current = { hash, id: crypto.randomUUID() }; const result = await api('workflow-jobs', 'POST', { ...payload, eventId: retry.current.id }); retry.current = null; setMessage(result.ready ? 'All prices ready for creator review.' : 'Saved. Pending jobs will synchronize with ERP.'); setSelected([]); setVersion(undefined); setWorkflowVersion(undefined); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="card" style={{ padding: 16 }}>
    <h2>Pricing & Collection Jobs</h2><p>Assign work here. Staff update jobs through ERP or ERP WhatsApp.</p>
    {userId && <p>Your Price List user ID for ERP mapping: <code>{userId}</code></p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}{message && <p role="status">{message}</p>}
    <button onClick={() => load()} disabled={busy}>Refresh</button>
    {!current ? <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Document</th><th>Customer / creator</th><th>Status</th><th>Pricing</th><th>Collection</th><th>Blockers</th></tr></thead><tbody>
      {rows.map(q => <tr key={q.id}><td><button onClick={() => { setCurrent(q.id); setDoc(undefined); }}>{q.number}</button></td><td>{q.customer?.name} · {q.creator}</td><td>{q.status}</td><td>{q.pricing}/{q.pricingAssigned}</td><td>{q.collection}/{q.collectionAssigned}</td><td>{q.blockers}</td></tr>)}
    </tbody></table></div> : <>
      {!documentId && <button onClick={() => { setCurrent(''); setDoc(undefined); setSelected([]); setVersion(undefined); }}>All documents</button>}
      {doc && <><h3>{doc.number} · {doc.status}</h3><p>Creator mapping ID: <code>{doc.creatorId}</code></p>
        <p>{doc.ready ? 'All supplier prices ready for review. Finalize from the quotation screen.' : 'Pricing or review remains pending.'}</p>
        {doc.failures.map((f: any) => <p key={f.id} role="status">{f.state === 'SENDING' ? 'Pending ERP sync' : f.state}: {f.error || 'Waiting for ERP acknowledgement'}</p>)}
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Select</th><th>Product</th><th>Quantity</th><th>Pricing / collection</th><th>Supplier cost</th></tr></thead><tbody>
          {doc.lines.map((l: any) => <tr key={l.id}><td><input aria-label={`Select ${l.description}`} type="checkbox" checked={selected.includes(l.id)} onChange={e => { if (!selected.length) { setVersion(doc.version); setWorkflowVersion(doc.workflowVersion); } setSelected(e.target.checked ? [...selected,l.id] : selected.filter(id => id !== l.id)); }} /></td>
            <td>{l.partNumber} · {l.description}<br/><small>{l.unit}</small></td>
            <td>{doc.status === 'DRAFT' ? l.quantity : <input aria-label={`Collect quantity for ${l.description}`} type="number" min="0.000001" step="any" max={l.quantity} value={quantities[l.id] ?? l.quantity} onChange={e => setQuantities({ ...quantities, [l.id]: e.target.value })}/>}</td>
            <td>{['PRICING','COLLECTION'].map(kind => l.jobs[kind] && <div key={kind}>{kind}: {l.jobs[kind].status} · {staff.find(s => s.id === l.jobs[kind].owner)?.name || l.jobs[kind].owner}<br/>{l.jobs[kind].blocker}<small>{l.jobs[kind].shops} · {l.jobs[kind].notes}</small>{l.jobs[kind].movements?.map((m: any) => <div key={m.id}>{m.type} {m.quantity} · supplier {m.supplierName || m.supplier} · {m.evidence}</div>)}</div>)}</td>
            <td>{l.workflowCost ? <>{l.workflowCost.cost} {l.workflowCost.currency}/{l.workflowCost.unit}<br/><small>Price updated by {l.workflowCost.actorName} · {new Date(l.workflowCost.updatedAt).toLocaleString()}</small>{l.workflowCost.stale && <strong> · Product changed: reconfirm cost</strong>}{l.margin !== null && <div>Unit margin: {l.margin}</div>}</> : 'Pending'}</td>
          </tr>)}
        </tbody></table></div>
        {doc.canAssign && <><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command({ action: 'assign', eventId: crypto.randomUUID(), kind: doc.status === 'DRAFT' ? 'PRICING' : 'COLLECTION', selected, assignee: f.get('assignee'), shops: f.get('shops'), notes: f.get('notes'), due: f.get('due') ? new Date(String(f.get('due'))).toISOString() : '', noDueReason: f.get('noDueReason'), mode: f.get('mode') || undefined, poNumber: f.get('poNumber') || '', authorized: f.get('authorized') === 'on', quantities }); }}>
          <h3>Assign {selected.length} selected products</h3>
          <label>Staff <select required name="assignee"><option value="">Choose ERP staff</option>{staff.filter(s => (doc.status === 'DRAFT' ? ['sales','pricing','manager'] : ['sales','collection','manager']).includes(s.role)).map(s => <option key={s.id} value={s.id}>{s.name}{s.phoneConfigured ? '' : ' — WhatsApp number missing'}</option>)}</select></label>
          <label>Shops to contact <textarea name="shops" maxLength={10000}/></label><label>Instructions <textarea name="notes" maxLength={10000}/></label>
          <label>Deadline <input name="due" type="datetime-local"/></label><label>If unknown, explain <input name="noDueReason" maxLength={500}/></label>
          {doc.status !== 'DRAFT' && <><label>Collection basis <select name="mode"><option value="ORDER_CONFIRMED">Customer order confirmed</option><option value="EARLY_AUTHORIZED">Authorize collection before customer order</option></select></label><label>Customer PO reference (optional) <input name="poNumber"/></label><label><input name="authorized" type="checkbox" required/>I confirm this order or authorize early collection for the selected quantities.</label></>}
          <button disabled={busy || !selected.length}>Assign selected products</button>
        </form>
        {doc.status === 'DRAFT' && selected.length === 1 && <details><summary>Price already known / confirm reviewed supplier cost</summary><form onSubmit={e => {
          e.preventDefault(); const f = new FormData(e.currentTarget); const line = doc.lines.find((l: any) => l.id === selected[0]);
          void command({ action: 'known', lineId: line.id, cost: { cost: f.get('cost'), currency: f.get('currency'), unit: line.unit, supplier: f.get('supplier'), taxBasis: f.get('taxBasis'), availability: f.get('availability'), evidence: f.get('evidence'), leadTime: f.get('leadTime') } });
        }}><label>Supplier cost <input name="cost" type="number" min="0" step="any" required/></label><label>Currency <input name="currency" defaultValue={doc.currency} pattern="[A-Z]{3}" required/></label>
          <label>Supplier <input name="supplier" required/></label><label>Tax basis <input name="taxBasis" required/></label><label>Availability <input name="availability" required/></label><label>Lead time <input name="leadTime" required/></label><label>Evidence/reference <input name="evidence" required/></label><button disabled={busy}>Confirm this price</button>
        </form></details>}</>}
      </>}
    </>}
  </section>;
}
