'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import QuotationActions from './SharedQuotationActions';

export default function SharedQuotation({ documentId }: { documentId?: string }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [requestId, setRequestId] = useState('');
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ fingerprint: string; eventId: string } | null>(null);
  const query = documentId ? `documentId=${encodeURIComponent(documentId)}` : `requestId=${encodeURIComponent(requestId)}`;
  async function load() {
    try {
      const result = await api(`shared-quotation${documentId || requestId ? `?${query}` : ''}`);
      if (documentId || requestId) setData(result); else setRequests(result.rows || []);
      setError('');
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { setData(undefined); void load(); const timer = setInterval(() => void load(), 15000); return () => clearInterval(timer); }, [documentId, requestId]);
  async function submit(body: any) {
    const payload = { ...body, documentId, requestId: data.requestId, revision: body.revision ?? data.requestRevision };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, eventId: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const result = await api('shared-quotation', 'POST', { ...payload, eventId: pending.current.eventId });
      setData(result); pending.current = null; return true;
    } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  const row = data && { ...data, id: data.requestId, quotations: data.quotations, orders: data.orders };
  return <section className="shared-quotation-panel" style={{ margin: '16px 0', padding: 16, border: '1px solid #cbd5e1', borderRadius: 8 }}>
    <style>{`.shared-quotation-panel form{display:grid;gap:12px;margin-top:16px}.shared-quotation-panel .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.shared-quotation-panel .flex{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.shared-quotation-panel label{font-size:14px}.shared-quotation-panel input:not([type=checkbox]),.shared-quotation-panel select{display:block;max-width:100%;width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;background:var(--surface,#fff);color:inherit;box-sizing:border-box}.shared-quotation-panel button,.shared-quotation-panel a{display:inline-block;padding:8px 12px;border:1px solid #94a3b8;border-radius:6px;margin:4px 0;background:var(--surface,#fff);color:inherit}.shared-quotation-panel button:disabled{opacity:.5}.shared-quotation-panel .border{border:1px solid #cbd5e1;border-radius:6px;padding:12px}.shared-quotation-panel details{margin-top:16px}.shared-quotation-panel summary{cursor:pointer;font-weight:600}`}</style>
    <h3>Shared ERP / Price List quotation</h3>
    {!documentId && <label>Request<select value={requestId} onChange={e => setRequestId(e.target.value)}><option value="">Choose a request</option>{requests.map(r => <option key={r.id} value={r.id}>{r.number} · {r.customer || r.title}</option>)}</select></label>}
    <button onClick={() => void load()} disabled={busy}>Refresh quotation</button>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {data && <QuotationActions key={data.requestId} row={row} data={data} busy={busy} submit={submit}/>}
  </section>;
}
