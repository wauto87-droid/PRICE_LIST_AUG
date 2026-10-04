'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import QuotationActions from './SharedQuotationActions';
import { pendingQuotationCommand, quotationCommandRejected, type PendingQuotationCommand } from './shared-quotation-command';

export default function SharedQuotation({ documentId, initialRequestId, initialVersion, summaryOnly = false, onOpenDraft, onOpenQuotation }: { documentId?: string; initialRequestId?: string; initialVersion?: number; summaryOnly?: boolean; onOpenDraft?: (identity: any) => void; onOpenQuotation?: (identity: any) => void }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [requestId, setRequestId] = useState(initialRequestId || '');
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<PendingQuotationCommand | null>(null);
  const sending = useRef(false);
  const generation = useRef(0);
  const [pdf, setPdf] = useState<any>();
  const query = documentId ? `documentId=${encodeURIComponent(documentId)}` : `requestId=${encodeURIComponent(requestId)}`;
  async function load() {
    if (sending.current) return;
    const current = ++generation.current;
    try {
      const result = await api(`shared-quotation${documentId || requestId ? `?${query}` : ''}`);
      if (current !== generation.current) return;
      if (documentId || requestId) setData(result); else setRequests(result.rows || []);
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
  }
  useEffect(() => { setData(undefined); void load(); const timer = setInterval(() => void load(), 15000); return () => clearInterval(timer); }, [documentId, requestId]);
  async function submit(body: any) {
    if (sending.current) return false;
    const payload = { ...body, documentId, requestId: data.requestId, revision: body.revision ?? data.requestRevision };
    pending.current = pendingQuotationCommand(pending.current, payload, () => crypto.randomUUID());
    sending.current = true; ++generation.current;
    setBusy(true); setError('');
    try {
      const result = await api('shared-quotation', 'POST', { ...pending.current.payload, eventId: pending.current.eventId });
      setData(result); pending.current = null; return true;
    } catch (e) { if (quotationCommandRejected(e)) pending.current = null; setError((e as Error).message); return false; } finally { sending.current = false; setBusy(false); }
  }
  async function createPdf(version: number) {
    setBusy(true); setError('');
    try { const result = await api('shared-quotation', 'POST', { action: 'quotationPdf', requestId: data.requestId, documentId, quoteVersion: version, eventId: crypto.randomUUID() }); setPdf({ ...result, requestId: data.requestId }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!pdf || !['PENDING', 'RUNNING'].includes(pdf.status)) return;
    let alive = true;
    const timer = setInterval(() => { void api(`shared-quotation?requestId=${encodeURIComponent(pdf.requestId)}&pdfJob=${encodeURIComponent(pdf.id)}`).then(result => { if (alive) setPdf((previous: any) => ({ ...previous, ...result })); }).catch(e => { if (alive) setError(e.message); }); }, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [pdf?.id, pdf?.status]);
  const row = data && { ...data, id: data.requestId, quotations: data.quotations, orders: data.orders };
  return <section className="shared-quotation-panel card" style={{ margin: '16px 0', padding: 16 }}>
    <style>{`.shared-quotation-panel form{display:grid;gap:12px;margin-top:16px}.shared-quotation-panel .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.shared-quotation-panel .flex{display:flex;align-items:center;flex-wrap:wrap;gap:12px}.shared-quotation-panel label{font-size:14px}.shared-quotation-panel input:not([type=checkbox]),.shared-quotation-panel select{display:block;max-width:100%;width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;background:var(--surface,#fff);color:inherit;box-sizing:border-box}.shared-quotation-panel button:not(.primary),.shared-quotation-panel a{display:inline-block;padding:8px 12px;border:1px solid #94a3b8;border-radius:6px;margin:4px 0;background:var(--surface,#fff);color:inherit}.shared-quotation-panel button:disabled{opacity:.5}.shared-quotation-panel .border{border:1px solid #cbd5e1;border-radius:6px;padding:12px}.shared-quotation-panel details{margin-top:16px}.shared-quotation-panel summary{cursor:pointer;font-weight:600}`}</style>

    {!documentId && <label>Request<select disabled={busy} value={requestId} onChange={e => setRequestId(e.target.value)}><option value="">Choose a request</option>{requestId && !requests.some(r => r.id === requestId) && <option value={requestId}>{data?.number || requestId}</option>}{requests.map(r => <option key={r.id} value={r.id}>{r.number} · {r.customer || r.title}</option>)}</select></label>}
    {!summaryOnly && <button onClick={() => { setError(''); void load(); }} disabled={busy}>Refresh progress</button>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {pdf && <p role="status">{pdf.status === 'DONE' ? <a href={`/amt_price_list/api/v1/shared-quotation?requestId=${encodeURIComponent(pdf.requestId)}&pdfJob=${encodeURIComponent(pdf.id)}&download=1`}>Download quotation PDF</a> : pdf.status === 'FAILED' ? 'PDF generation failed. Check the worker and retry Download themed PDF.' : 'Preparing themed quotation PDF…'}</p>}
    {data && summaryOnly && <button className="primary" disabled={busy || !data.items.some((i: any) => i.offers.length)} onClick={() => { const identity = { documentId: documentId || data.documentId, requestId: data.requestId, version: initialVersion }; if (data.quotations.length) onOpenQuotation?.(identity); else onOpenDraft?.(identity); }}>{data.quotations.length ? 'Open quotation' : 'Create quotation'}</button>}
    {data && !summaryOnly && <QuotationActions key={data.requestId} row={row} data={data} busy={busy} submit={submit} onPdf={version => void createPdf(version)} initialVersion={initialVersion} onOpenDraft={onOpenDraft ? () => onOpenDraft({ documentId: documentId || data.documentId, requestId: data.requestId }) : undefined}/>}
  </section>;
}
