import { DB } from '../core/db';
import { Actor, has } from '../auth/service';
import { state, remote, check } from './core';

export const filters = ['all','drafts','pricing','quotations','collection','delivery','completed','attention'] as const;
export type WorkflowFilter = typeof filters[number];
type Row = Record<string, any>;
const cache = new WeakMap<DB, Map<string, { value: Row; at: number }>>();

export function classifyDocument(q: Row, progress?: Row, failed = 0, now = Date.now()) {
  const tracking = q.workflow?.erpRequestId ? (progress ? 'tracked' : 'unknown') : 'unlinked';
  const quoted = !!q.workflow?.sharedQuotations?.length || ['ISSUED','SENT','APPROVED'].includes(q.status) || (progress?.quotationCount || 0) > 0;
  const known = tracking === 'tracked';
  const categories: WorkflowFilter[] = ['all', quoted ? 'quotations' : 'drafts'];
  if (known && progress?.pricingPending) categories.push('pricing');
  if (known && progress?.awaitingCollection) categories.push('collection');
  if (known && progress?.readyForDelivery) categories.push('delivery');
  if (known && progress?.completed) categories.push('completed');
  const localJobs = Object.values<Row>(q.workflow?.lines || {}).flatMap(l => [l.PRICING,l.COLLECTION]).filter(Boolean);
  const localAttention = localJobs.some(j => j.blocker || (!['COMPLETED','KNOWN','SKIPPED','CANCELLED'].includes(j.status) && j.due && Date.parse(j.due) < now));
  if (failed || localAttention || (known && (progress?.blockers || progress?.overdue))) categories.push('attention');
  return { tracking, categories, status: quoted ? (q.status === 'DRAFT' ? 'ISSUED' : q.status) : q.status,
    progress: known ? progress : null, failedSync: failed };
}

export function matchesSearch(q: Row, search: string, requestNumber = '') {
  const normalize = (v: unknown) => String(v || '').normalize('NFKC').toLocaleLowerCase().trim();
  const text = normalize(search);
  if (!text) return true;
  const w = q.workflow || {};
  return [q.number, q.internal_reference, q.allocated_number, typeof q.customer === 'string' ? q.customer : q.customer?.name, q.creator, w.workflowNumber, requestNumber,
    ...(w.orders || []).map((o: Row) => o.number), ...(w.sharedQuotations || []).flatMap((o: Row) => [o.number,o.quotationNumber,o.draftNumber]),
    q.data?.draftNumber, q.data?.quotationNumber].some(v => normalize(v).includes(text));
}

export async function loadProgress(db: DB, actor: Actor, documents: Row[], transport = remote, now = Date.now()) {
  let entries = cache.get(db); if (!entries) { entries = new Map(); cache.set(db, entries); }
  const prefix = `${actor.id}:`;
  const linked = documents.filter(q => q.workflow?.erpRequestId);
  const needed = linked.filter(q => !entries!.has(prefix+q.id) || now-entries!.get(prefix+q.id)!.at >= 30000);
  let config: any;
  let error = false;
  if (needed.length) { try { config = await state(db); } catch { error = true; } }
  for (let i=0; i<needed.length; i+=100) {
    const batch = needed.slice(i,i+100);
    if (!config) break;
    try {
      const result = await transport(config,'jobs-summary',{actorId:actor.id,documentIds:batch.map(q=>q.id)});
      const rows = result.rows || [];
      for (const q of batch) {
        const value = rows.find((r: Row) => r.documentId === q.id);
        if (!value || value.unavailable) { entries.delete(prefix+q.id); continue; }
        entries.set(prefix+q.id,{value,at:now});
      }
    } catch { error = true; break; }
  }
  while (entries.size>10000) entries.delete(entries.keys().next().value!);
  return new Map<string, Row | undefined>(linked.map(q=>{
    const saved=entries!.get(prefix+q.id);
    return [q.id,saved ? {...saved.value,refreshedAt:new Date(saved.at).toISOString(),freshness:now-saved.at>=30000 ? 'stale' : 'fresh'} : undefined];
  }));
}

export async function dashboardList(db: DB, actor: Actor, url: URL, transport = remote) {
  const admin=actor.role==='ADMIN'||has(actor,'QUOTE_VIEW_ALL');
  const owner=url.searchParams.get('owner')||'me';
  const category=(url.searchParams.get('workflowFilter')||'all') as WorkflowFilter;
  check((url.searchParams.get('search')||'').length<=200,'Search must be at most 200 characters');
  check(filters.includes(category),'Unknown workflow filter');
  const page=Number(url.searchParams.get('page')||1), size=Number(url.searchParams.get('pageSize')||50);
  check(Number.isSafeInteger(page)&&page>0&&Number.isSafeInteger(size)&&size>0&&size<=100,'Invalid pagination');
  const params:any[]=[];let where="q.status<>'DELETED'";
  if(!admin){params.push(actor.id);where+=' AND (q.owner_id=$1::uuid OR $1::uuid=ANY(q.shared_with))';}
  else if(owner!=='all'){params.push(owner==='me'?actor.id:owner);where+=' AND q.owner_id=$1::uuid';}
  const source=(await db.query(`SELECT q.id,q.number,q.internal_reference,a.number allocated_number,q.status,q.customer,q.owner_id,q.updated_at,u.name creator,j.data workflow FROM quotations q LEFT JOIN users u ON u.id=q.owner_id LEFT JOIN sw_job_documents j ON j.id=q.id::text LEFT JOIN quotation_allocations a ON a.quotation_id=q.id WHERE ${where} ORDER BY q.updated_at DESC,q.id DESC`,params)).rows;
  const failures=(await db.query("SELECT payload->>'documentId' document_id,count(*)::int count FROM sw_job_outbox WHERE state IN ('FAILED','REJECTED') GROUP BY payload->>'documentId'")).rows;
  const progress=await loadProgress(db,actor,source,transport);
  const matched=source.filter(q=>matchesSearch(q,url.searchParams.get('search')||'',progress.get(q.id)?.requestNumber));
  const classified=matched.map(q=>({id:q.id,number:q.number,internalReference:q.internal_reference,quotationNumber:q.allocated_number,customer:q.customer,creator:q.creator,ownerId:q.owner_id,workflow:q.workflow?.workflowNumber||progress.get(q.id)?.requestNumber||'',
    ...classifyDocument(q,progress.get(q.id),failures.find(f=>f.document_id===q.id)?.count||0)}));
  const summary=Object.fromEntries(filters.map(f=>[f,classified.filter(q=>q.categories.includes(f)).length]));
  const filtered=classified.filter(q=>q.categories.includes(category));
  const actualPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/size)));
  return {rows:filtered.slice((actualPage-1)*size,actualPage*size),summary,total:filtered.length,page:actualPage,pageSize:size,
    unknownProgress:classified.filter(q=>q.tracking==='unknown').length,staleProgress:classified.filter(q=>q.progress?.freshness==='stale').length,
    userId:actor.id,isAdmin:admin,userReference:(await db.query('SELECT name,integration_reference reference FROM users WHERE id=$1',[actor.id])).rows[0],
    creators:admin?(await db.query('SELECT id,name,username FROM users WHERE disabled IS NOT TRUE ORDER BY name ASC')).rows:[]};
}
