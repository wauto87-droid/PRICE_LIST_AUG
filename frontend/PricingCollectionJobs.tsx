'use client';
import { useEffect, useRef, useState } from 'react';
import { api, requestWasCancelled } from './api';
import SharedQuotation from './SharedQuotation';
import WorkflowPricingAssignments from './WorkflowPricingAssignments';
import { workflowStyles } from './workflow-styles';

export const workflowCards = [['all','All documents'],['drafts','Drafts'],['pricing','Pricing pending'],['quotations','Quotations'],['collection','Awaiting collection'],['delivery','Ready for delivery'],['completed','Completed'],['attention','Needs attention']] as const;
type Row = Record<string, any>;
type Tab = 'overview'|'pricing'|'quotation'|'fulfillment';
const tabs: [Tab,string][] = [['overview','Overview'],['pricing','Pricing'],['quotation','Quotation'],['fulfillment','Collection & Delivery']];
const customerName=(q:Row)=>typeof q.customer==='string'?q.customer:q.customer?.name||'Customer';
export function ProgressBadge({row}:{row:Row}) {
  if(row.tracking==='unlinked')return <span className="wf-muted">Not started / Not linked to ERP</span>;
  if(!row.progress)return <span className="wf-warning">Progress unavailable</span>;
  const p=row.progress;
  return <span>Pricing {p.pricedCount}/{p.itemCount} · Collected {p.collectedItems}/{p.confirmedItems} · Delivered {p.deliveredItems}/{p.confirmedItems}{p.freshness==='stale'&&<strong className="wf-warning"> · Stale</strong>}</span>;
}
function OverviewCards({progress}:{progress?:Row}) {
  if(!progress)return null;
  const values:[string,number,number|null][]=[['Priced items',progress.pricedCount,progress.itemCount],['Confirmed items',progress.confirmedItems,null],['Collected items',progress.collectedItems,progress.confirmedItems],['Delivered items',progress.deliveredItems,progress.confirmedItems]];
  return <div className="wf-cards">{values.map(([label,value,total])=><div key={label} className="wf-stat"><span>{label}</span><strong>{value}{total!==null?' / '+total:''}</strong></div>)}</div>;
}
export default function PricingCollectionJobs({documentId,requestId,quotationVersion,onOpenDraft,onOpenQuotation}:{documentId?:string;requestId?:string;quotationVersion?:number;onOpenDraft?:(v:any)=>void;onOpenQuotation?:(v:any)=>void}) {
  const [current,setCurrent]=useState(documentId||'');
  const [requestContext,setRequestContext]=useState(requestId||'');
  const [pricingVisited,setPricingVisited]=useState(false);
  const [tab,setTab]=useState<Tab>(quotationVersion?'quotation':'overview');
  const [owner,setOwner]=useState('me');const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');const [debounced,setDebounced]=useState('');
  const [page,setPage]=useState(1);const [refresh,setRefresh]=useState(0);
  const [result,setResult]=useState<Row>();const [doc,setDoc]=useState<Row>();
  const [canonical,setCanonical]=useState<Row>();
  const [error,setError]=useState('');const [loading,setLoading]=useState(false);
  const [lastRefresh,setLastRefresh]=useState('');const generation=useRef(0);
  useEffect(()=>{const timer=setTimeout(()=>{setDebounced(search);setPage(1);},300);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{if(documentId&&documentId!==current){setCurrent(documentId);setDoc(undefined);setCanonical(undefined);setPricingVisited(false);setTab(quotationVersion?'quotation':'overview');}if(quotationVersion)setTab('quotation');setRequestContext(requestId||'');},[documentId,requestId,quotationVersion]);
  useEffect(()=>{
    if(current||requestContext)return;
    const controller=new AbortController();const currentGeneration=++generation.current;
    const query=new URLSearchParams({dashboard:'1',owner,workflowFilter:filter,search:debounced,page:String(page),pageSize:'50'});
    const load=async()=>{setLoading(true);try{
      const next=await api(`workflow-jobs?${query}`,'GET',undefined,{signal:controller.signal});
      if(currentGeneration===generation.current){setResult(next);setError('');setLastRefresh(new Date().toISOString());}
    }catch(e){if(!requestWasCancelled(e)&&currentGeneration===generation.current)setError((e as Error).message);}finally{if(currentGeneration===generation.current)setLoading(false);}};
    void load();const timer=setInterval(()=>void load(),30000);
    return()=>{controller.abort();++generation.current;clearInterval(timer);};
  },[current,requestContext,owner,filter,debounced,page,refresh]);
  useEffect(()=>{
    if(!current)return;
    let alive=true;const controller=new AbortController();
    api(`workflow-jobs?documentId=${encodeURIComponent(current)}`,'GET',undefined,{signal:controller.signal}).then(v=>{if(alive){setDoc(v);setLastRefresh(new Date().toISOString());setError('');}}).catch(e=>{if(alive&&!requestWasCancelled(e))setError(e.message);});
    return()=>{alive=false;controller.abort();};
  },[current,refresh]);
  const open=(id:string)=>{setDoc(undefined);setCanonical(undefined);setRequestContext('');setPricingVisited(false);setCurrent(id);setTab('overview');setError('');};
  const changeTab=(value:Tab)=>{setTab(value);if(value==='pricing')setPricingVisited(true);};
  const selected=result?.rows?.find((r:Row)=>r.id===current);
  const detailProgress=canonical?.summary||selected?.progress;
  const canReadShared=current ? !!doc?.erpRequestId || (!doc&&selected?.tracking!=='unlinked') : !!requestContext;
  return <section className="workflow-workspace">
    <style>{workflowStyles}</style>
    <header className="wf-header"><div><small className="wf-muted">OUR COUNTER, CONNECTED</small><h2>Workflow</h2><p className="wf-muted">Pricing, quotations, collection and delivery.</p></div><button type="button" onClick={()=>setRefresh(n=>n+1)} disabled={loading}>Refresh progress</button></header>
    {error&&<p role="alert" className="wf-warning">{error}</p>}
    {!current&&!requestContext?<>
      <div className="wf-toolbar"><label>Documents<select value={owner} onChange={e=>{setOwner(e.target.value);setPage(1);}}><option value="me">My documents</option>{result?.isAdmin&&<><option value="all">All users</option>{result.creators?.map((u:Row)=><option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</>}</select></label><label className="wf-search">Search customer, draft, quotation, or request number<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Customer name, DR-0057, AMT-QT…"/></label><button type="button" onClick={()=>{setSearch('');setDebounced('');setFilter('all');setOwner('me');setPage(1);}}>Clear filters</button></div>
      <div className="wf-cards">{workflowCards.map(([value,label])=><button type="button" className={`wf-stat ${filter===value?'is-selected':''}`} key={value} aria-pressed={filter===value} title="Counts are documents. A document can appear in more than one status card." onClick={()=>{setFilter(value);setPage(1);}}><span>{label}</span><strong>{result?.summary?.[value]??'—'}</strong></button>)}</div>
      {!!(result?.unknownProgress||result?.staleProgress)&&<p className="wf-warning" role="status">{result?.unknownProgress||0} document(s) have unavailable ERP progress; {result?.staleProgress||0} show last known progress. Counts may be incomplete.</p>}
      <div className="wf-header"><h3>{workflowCards.find(([v])=>v===filter)?.[1]} · {result?.total??'—'} documents</h3>{loading&&<span role="status">Refreshing…</span>}</div>
      {result&&!result.rows.length?<div className="wf-empty">No matching documents. Try another customer or document number, or clear the filters.</div>:<>
        <div className="wf-desktop table-scroll"><table><thead><tr><th>Document / customer</th><th>Creator</th><th>Status</th><th>Progress</th><th>Attention</th></tr></thead><tbody>{result?.rows?.map((r:Row)=><tr key={r.id}><td><button className="wf-link" onClick={()=>open(r.id)}>{r.number}</button><div>{customerName(r)}</div><small className="wf-muted">{r.workflow||'Not linked to ERP'}</small></td><td>{r.creator}</td><td><span className="wf-pill">{r.status}</span></td><td><ProgressBadge row={r}/></td><td>{r.categories.includes('attention')?<span className="wf-warning">Needs attention</span>:'—'}</td></tr>)}</tbody></table></div>
        <div className="wf-mobile">{result?.rows?.map((r:Row)=><article className="wf-document card" key={r.id}><button className="wf-link" onClick={()=>open(r.id)}>{r.number}</button><span className="wf-pill">{r.status}</span><h3>{customerName(r)}</h3><p className="wf-muted">{r.creator}</p><ProgressBadge row={r}/>{r.categories.includes('attention')&&<p className="wf-warning">Needs attention</p>}</article>)}</div>
      </>}
      {result&&<div className="wf-header"><button disabled={loading||result.page<=1} onClick={()=>setPage(result.page-1)}>Previous</button><span>Page {result.page} of {Math.max(1,Math.ceil(result.total/result.pageSize))} · {result.total} results</span><button disabled={loading||result.page*result.pageSize>=result.total} onClick={()=>setPage(result.page+1)}>Next</button></div>}
    </>:<>
      <button type="button" onClick={()=>{setCurrent('');setRequestContext('');setDoc(undefined);setCanonical(undefined);setPricingVisited(false);setError('');}}>← Back to workflows</button>
      <header className="wf-header card wf-document"><div><h2>{doc?.number||selected?.number||canonical?.number||'Loading document…'}</h2><h3>{doc?customerName(doc):selected?customerName(selected):canonical?.customer||''}</h3><p className="wf-muted">{doc?.creator?.name||selected?.creator||'—'} · {doc?.workflow||selected?.workflow||canonical?.number||'Not linked to ERP'}{(doc?.internalReference||selected?.internalReference)&&<> · Draft reference: {doc?.internalReference||selected?.internalReference}</>}{selected?.quotationNumber&&<> · Quotation: {selected.quotationNumber}</>}</p></div><div><span className="wf-pill">{doc?.status||selected?.status||(canonical?.quotations?.length?'ISSUED':'Loading')}</span><p className={doc?.syncWarning?'wf-warning':'wf-muted'}>{doc?.syncWarning||((doc?.failures||[]).length?'ERP synchronization pending':(canReadShared?'No pending synchronization reported':'Not linked to ERP'))}</p><small>Last successful refresh: {lastRefresh?new Date(lastRefresh).toLocaleString():'—'}</small></div></header>
      <nav className="wf-tabs" aria-label="Workflow sections">{tabs.map(([id,label])=><button type="button" key={id} aria-current={tab===id?'page':undefined} className={tab===id?'is-selected':''} onClick={()=>changeTab(id)}>{label}</button>)}</nav>
      <div hidden={tab!=='overview'} className="card wf-document"><h3>Document overview</h3><OverviewCards progress={detailProgress}/>{canonical?.summary?<ProgressBadge row={{tracking:'tracked',progress:{...canonical.summary,freshness:canonical.stale?'stale':'fresh'}}}/>:selected?<ProgressBadge row={selected}/>:<p>ERP progress is not available yet.</p>}<div className="wf-actions">{tabs.slice(1).map(([id,label])=><button key={id} onClick={()=>changeTab(id)}>Open {label}</button>)}</div>{doc?.failures?.map((f:Row)=><p role="status" className="wf-warning" key={f.id}>{f.state}: {f.error||'Waiting for ERP acknowledgement'}</p>)}{doc?.lines?.flatMap((l:Row)=>Object.values<Row>(l.jobs||{}).filter(j=>j.blocker).map((j:Row,index:number)=><p key={`${l.id}:${index}`} className="wf-warning">{l.partNumber||l.description}: {j.blocker}</p>))}</div>
      {pricingVisited&&!!current&&<div hidden={tab!=='pricing'}><details><summary>Assign pricing staff / branch setup</summary><WorkflowPricingAssignments key={current} documentId={current} requestId={requestContext||undefined} quotationVersion={quotationVersion} onOpenDraft={onOpenDraft} onOpenQuotation={onOpenQuotation}/></details></div>}
      {!canReadShared&&doc&&<p className="wf-muted">Not started / Not linked to ERP. Open Pricing to assign work, then refresh progress after ERP synchronization.</p>}
      {canReadShared&&<SharedQuotation documentId={current||undefined} initialRequestId={requestContext||undefined} initialVersion={quotationVersion} showFulfillment refreshKey={refresh} view={tab} onUnavailable={message=>{setError(message);setCanonical(value=>value?{...value,stale:true}:value);}} onOpenDraft={onOpenDraft} onData={value=>{setError('');setCanonical(value);setLastRefresh(value.refreshedAt||new Date().toISOString());}}/>}
    </>}
  </section>;
}
