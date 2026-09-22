import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { DB } from '../core/db';
import { one } from '../core/db';
import { assert } from '../core/errors';
import { audit, json } from '../core/audit';
import { requirePermission, type Actor } from '../auth/service';
import { fields, parseRows, groupLines, stages } from '../../shared/dn-tracker';
const digest=(x:unknown)=>createHash('sha256').update(json(x)).digest('hex');
const allowed=(a:Actor,p='VIEW')=>requirePermission(a,`DN_TRACKER_${p}`);
export async function readWorkbook(actor:Actor, file:File) {
 allowed(actor,'MANAGE'); assert(file.size<=10*1024*1024,413,'Maximum upload is 10 MB');
 assert(/\.(xlsx|xls|csv)$/i.test(file.name),400,'Use XLSX, XLS or CSV');
 const book=new ExcelJS.Workbook(); const buffer=Buffer.from(await file.arrayBuffer());
 if(/\.xls$/i.test(file.name)) {
  const result=await new Promise<string>((resolve,reject)=>{
   const child=spawn(process.env.PYTHON_BIN||'python3',[path.join(process.cwd(),'scripts/dn-xls.py')],{windowsHide:true});
   let output='',errors='';const timer=setTimeout(()=>{child.kill();reject(new Error('Workbook parsing timed out'));},30000);
   child.stdout.on('data',b=>{output+=b;if(output.length>25*1024*1024){child.kill();reject(new Error('Expanded workbook is too large'));}});
   child.stderr.on('data',b=>{errors+=b;});child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error('Unable to read XLS workbook. Verify the file and server XLS reader.'));});
   child.stdin.on('error',()=>{});child.stdin.end(buffer);
  });return {filename:file.name,...JSON.parse(result)};
 }
 if(/\.csv$/i.test(file.name)) await book.csv.read(Readable.from([buffer])); else await book.xlsx.load(buffer as any);
 assert(book.worksheets.length<=30,400,'Maximum 30 worksheets');
 return { filename:file.name,sheets:book.worksheets.map(sheet=>{
  assert(sheet.rowCount<=20001 && sheet.columnCount<=100,400,'Maximum 20,000 rows and 100 columns per sheet');
  const rows:string[][]=[];
  sheet.eachRow({includeEmpty:true},row=>{
   rows.push(Array.from({length:sheet.columnCount},(_,i)=>{const c=row.getCell(i+1);let v:any=c.value;
    if(v && typeof v==='object' && 'formula' in v) v=v.result;
    if(v instanceof Date) return v.toISOString().slice(0,10);
    if(v && typeof v==='object') return 'richText' in v ? v.richText.map((t:any)=>t.text).join('') : String(v.text??'');
    if(typeof v==='number' && /^0+$/.test(c.numFmt||'')) return String(v).padStart(c.numFmt.length,'0');
    return String(v??''); }));
  });return {name:sheet.name,rows};
 })};
}
export async function metadata(db:DB,actor:Actor) {
 allowed(actor);
 return {
  reports:(await db.query('SELECT r.*,s.report_date,s.created_at AS imported_at,u.name AS uploader FROM dn_reports r LEFT JOIN dn_snapshots s ON s.id=r.current_snapshot LEFT JOIN users u ON u.id=s.created_by ORDER BY r.created_at DESC')).rows,
  views:(await db.query('SELECT * FROM dn_saved_views ORDER BY name,id')).rows,
  users:(await db.query("SELECT DISTINCT u.id,u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE NOT u.disabled AND ('DN_TRACKER_EDIT'=ANY(u.permissions||r.permissions) OR u.role_id='ADMIN') ORDER BY u.name,u.id")).rows,
 };
}
const mappingSchema=z.object(Object.fromEntries(fields.map(k=>[k,z.number().int().min(-1).max(99)])) as Record<typeof fields[number],z.ZodNumber>);
export async function preview(db:DB,actor:Actor,raw:unknown) {
 allowed(actor,'MANAGE');
 const v=z.object({reportId:z.string().uuid().optional(),name:z.string().trim().min(1).max(150),filename:z.string().max(250),reportDate:z.iso.date(),header:z.number().int().min(0).max(100),dateOrder:z.enum(['ISO','DMY','MDY']).default('ISO'),mapping:mappingSchema,rows:z.array(z.array(z.string().max(2000)).max(100)).min(2).max(20001)}).parse(raw);
 const parsed=parseRows(v.rows,v.mapping,v.header,v.dateOrder);
 const groups=groupLines(parsed.lines);
 assert(groups.length,400,'No valid delivery notes found');
 // Exact duplicates must be reviewed rather than silently double counted or removed.
 const seen=new Set<string>();
 for(const l of parsed.lines) { const {row,review,...content}=l; const key=digest(content); if(seen.has(key)) parsed.issues.push({row,message:'Duplicate source row: remove or correct it before committing'});seen.add(key); }
 const labels=new Map<string,Set<string>>();
 for(const g of groups) {const set=labels.get(g.customerKey)||new Set<string>();set.add(g.customer);labels.set(g.customerKey,set);}
 const ambiguous=[...labels].filter(([,names])=>names.size>1).map(([key,names])=>({key,names:[...names]}));
 return db.transaction(async tx=>{
  let report=v.reportId ? await one(tx,'SELECT * FROM dn_reports WHERE id=$1 FOR UPDATE',[v.reportId]) : null;
  if(v.reportId) assert(report&&!report.archived,404,'Active report not found');
  if(!report) report=await one(tx,'INSERT INTO dn_reports(id,name,created_by) VALUES($1,$2,$3) RETURNING *',[randomUUID(),v.name,actor.id]);
  const old=(await tx.query('SELECT * FROM dn_entries WHERE snapshot_id=$1',[report!.current_snapshot])).rows;
  const oldMap=new Map(old.map(r=>[r.identity_key,r]));
  const entries=groups.map(g=>({...g,identity:digest(g.identity),digest:digest(g.lines.map(({row,...l}:any)=>l))}));
  const added=entries.filter(g=>!oldMap.has(g.identity)).map(g=>g.docNo);
  const changed=entries.filter(g=>oldMap.has(g.identity)&&oldMap.get(g.identity)!.digest!==g.digest).map(g=>g.docNo);
  const keys=new Set(entries.map(g=>g.identity));
  const missing=old.filter(g=>!keys.has(g.identity_key)).map(g=>g.doc_no);
  const resolved=(await tx.query("SELECT n.identity_key FROM dn_notes n WHERE n.report_id=$1 AND n.stage='RESOLVED'",[report!.id])).rows;
  const resolvedChanged=entries.filter(g=>resolved.some(n=>n.identity_key===g.identity)&&oldMap.get(g.identity)?.digest!==g.digest).map(g=>g.docNo);
  const comparison={added,changed,missing,resolvedChanged,ambiguous,notes:entries.length,rows:parsed.lines.length,customers:new Set(entries.map(g=>g.customerKey)).size};
  const id=randomUUID();
  await tx.query("INSERT INTO dn_snapshots(id,report_id,filename,report_date,created_by,state,base_version,digest,issues,comparison) VALUES($1,$2,$3,$4,$5,'PREVIEW',$6,$7,$8,$9)",[id,report!.id,v.filename,v.reportDate,actor.id,report!.version,digest(entries),json(parsed.issues),json(comparison)]);
  for(const g of entries) await tx.query('INSERT INTO dn_entries(snapshot_id,identity_key,customer_key,customer,customer_code,doc_no,doc_date,billing,outstanding,has_returns,search_text,quantities,lines,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,g.identity,g.customerKey,g.customer,g.customerCode,g.docNo,g.date,g.billing,g.outstanding,g.hasReturns,[g.customer,g.customerCode,g.docNo,...g.lines.map((l:any)=>l.itemCode+' '+l.itemName)].join(' '),json(g.quantities),json(g.lines),g.digest]);
  return {id,reportId:report!.id,comparison,issues:parsed.issues,sample:entries.slice(0,10)};
 });
}
export async function commit(db:DB,actor:Actor,id:string,raw:unknown) {
 allowed(actor,'MANAGE'); const v=z.object({acknowledge:z.boolean()}).parse(raw);
 return db.transaction(async tx=>{
  const s=await one(tx,'SELECT * FROM dn_snapshots WHERE id=$1 FOR UPDATE',[id]);assert(s,404,'Preview not found');
  const r=await one(tx,'SELECT * FROM dn_reports WHERE id=$1 FOR UPDATE',[s.report_id]);
  if(s.state==='CURRENT') return r;
  assert(!r!.archived && s.state==='PREVIEW' && r!.version===s.base_version,409,'Report changed. Preview the upload again');
  assert(!s.issues.length,400,'Correct all invalid or duplicate rows before committing');
  assert(v.acknowledge,400,'Confirm the import comparison');
  const entries=(await tx.query('SELECT * FROM dn_entries WHERE snapshot_id=$1',[id])).rows;
  for(const e of entries) {
   const n=await one(tx,"INSERT INTO dn_notes(id,report_id,identity_key) VALUES($1,$2,$3) ON CONFLICT(report_id,identity_key) DO UPDATE SET identity_key=EXCLUDED.identity_key RETURNING *",[randomUUID(),s.report_id,e.identity_key]);
   const old=await one(tx,'SELECT digest FROM dn_entries WHERE snapshot_id=$1 AND identity_key=$2',[r!.current_snapshot,e.identity_key]);
   if(n!.stage==='RESOLVED'&&old?.digest!==e.digest) await tx.query('UPDATE dn_notes SET needs_review=true,version=version+1,updated_at=now() WHERE id=$1',[n!.id]);
  }
  await tx.query("UPDATE dn_snapshots SET state='ARCHIVED' WHERE report_id=$1 AND state='CURRENT'",[s.report_id]);
  await tx.query("UPDATE dn_snapshots SET state='CURRENT' WHERE id=$1",[id]);
  await tx.query('UPDATE dn_reports SET current_snapshot=$2,version=version+1 WHERE id=$1',[s.report_id,id]);
  await audit(tx,actor.id,'DN_REPORT_REPLACED','dn_reports',s.report_id,{snapshot:r!.current_snapshot},{snapshot:id,...s.comparison});
  return {id:s.report_id};
 });
}
export const filterSchema=z.object({reportId:z.string().uuid(),snapshotId:z.string().uuid().optional(),q:z.string().max(150).default(''),include:z.array(z.string().max(250)).max(1000).default([]),exclude:z.array(z.string().max(250)).max(1000).default([]),group:z.string().uuid().optional(),billing:z.enum(['ALL','UNBILLED','NOT_INVOICED','PARTIAL','SETTLED','RETURNED','REVIEW']).default('UNBILLED'),stage:z.enum(['ALL',...stages]).default('ALL'),assignee:z.string().default(''),from:z.union([z.iso.date(),z.literal('')]).default(''),to:z.union([z.iso.date(),z.literal('')]).default(''),age:z.coerce.number().int().min(0).max(100000).default(0),minBalance:z.coerce.number().min(0).default(0),returns:z.boolean().default(false),presence:z.enum(['CURRENT','MISSING']).default('CURRENT'),sort:z.enum(['date','customer','docNo','outstanding','updated','stage','assignee','billing','age','notes']).default('date'),direction:z.enum(['asc','desc']).default('asc'),view:z.enum(['BOARD','CUSTOMERS','NOTES']).default('BOARD'),page:z.coerce.number().int().min(0).max(100000).default(0)});
async function source(db:DB, actor:Actor,raw:unknown) {
 allowed(actor); const f=filterSchema.parse(raw);const report=await one(db,'SELECT * FROM dn_reports WHERE id=$1',[f.reportId]);assert(report,404,'Report not found');
 const snapshot=f.snapshotId||report.current_snapshot;
 if(f.snapshotId) assert(await one(db,"SELECT id FROM dn_snapshots WHERE id=$1 AND report_id=$2 AND state<>'PREVIEW'",[snapshot,f.reportId]),404,'Snapshot not found');
 const args:any[]=[f.reportId,snapshot]; const bind=(x:any)=>{args.push(x);return '$'+args.length;};
 const conditions=['n.report_id=$1'];
 if(f.q) conditions.push(`e.search_text ILIKE ${bind('%'+f.q.replace(/[\\%_]/g,'\\$&')+'%')} ESCAPE '\\'`);
 if(f.include.length) conditions.push(`e.customer_key=ANY(${bind(f.include)}::text[])`);
 if(f.exclude.length) conditions.push(`NOT(e.customer_key=ANY(${bind(f.exclude)}::text[]))`);
 if(f.group) {const g=await one(db,"SELECT content FROM dn_saved_views WHERE id=$1 AND kind='GROUP'",[f.group]);assert(g,404,'Group not found');conditions.push(`e.customer_key=ANY(${bind(g.content.customers)}::text[])`);}
 if(f.billing==='UNBILLED') conditions.push('e.outstanding>0'); else if(f.billing!=='ALL') conditions.push(`e.billing=${bind(f.billing)}`);
 if(f.stage!=='ALL') conditions.push(`n.stage=${bind(f.stage)}`);
 if(f.assignee==='UNASSIGNED') conditions.push('n.assignee IS NULL'); else if(f.assignee) conditions.push(`n.assignee=${bind(z.string().uuid().parse(f.assignee))}`);
 if(f.from) conditions.push(`e.doc_date>=${bind(f.from)}::date`); if(f.to) conditions.push(`e.doc_date<=${bind(f.to)}::date`);
 if(f.age) conditions.push(`e.doc_date<=(now() AT TIME ZONE 'Asia/Riyadh')::date-${bind(f.age)}::int`);
 if(f.minBalance) conditions.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(e.lines) l WHERE (l->>'balance')::numeric>=${bind(f.minBalance)})`);
 if(f.returns) conditions.push('e.has_returns');
 const entry=f.presence==='MISSING' ? `JOIN LATERAL (SELECT x.* FROM dn_entries x JOIN dn_snapshots s ON s.id=x.snapshot_id WHERE s.report_id=n.report_id AND s.state<>'PREVIEW' AND x.identity_key=n.identity_key AND NOT EXISTS(SELECT 1 FROM dn_entries current WHERE current.snapshot_id=$2 AND current.identity_key=n.identity_key) ORDER BY s.created_at DESC,s.id DESC LIMIT 1) e ON true` : 'JOIN dn_entries e ON e.identity_key=n.identity_key AND e.snapshot_id=$2';
 const sql=`FROM dn_notes n ${entry} LEFT JOIN users u ON u.id=n.assignee WHERE ${conditions.join(' AND ')}`;
 return {f,args,sql,report};
}
export async function list(db:DB,actor:Actor,raw:unknown,all=false) {
 const {f,args,sql,report}=await source(db,actor,raw);
 const summary=await one(db,`SELECT count(*)::int notes,count(DISTINCT e.customer_key) FILTER(WHERE e.outstanding>0)::int customers,count(*) FILTER(WHERE e.outstanding>0)::int unbilled,COALESCE(sum(e.outstanding),0)::int lines,count(*) FILTER(WHERE e.outstanding>0 AND e.doc_date<=(now() AT TIME ZONE 'Asia/Riyadh')::date-30)::int aged ${sql}`,args);
 const counts=(await db.query(`SELECT n.stage,count(*)::int count ${sql} GROUP BY n.stage`,args)).rows;
 const sort={date:'e.doc_date',customer:'e.customer',docNo:'e.doc_no',outstanding:'e.outstanding',updated:'n.updated_at',stage:'n.stage',assignee:'u.name',billing:'e.billing',age:'e.doc_date',notes:'e.doc_no'}[f.sort];
 const dir=(f.sort==='age' ? f.direction==='asc'?'desc':'asc':f.direction).toUpperCase();
 const columns=`n.*,e.customer_key,e.customer,e.customer_code,e.doc_no,e.doc_date::text,e.billing,e.outstanding,e.has_returns,e.quantities,e.lines,u.name AS assignee_name,(SELECT content FROM dn_events h WHERE h.note_id=n.id ORDER BY created_at DESC,id DESC LIMIT 1) AS latest_followup,((now() AT TIME ZONE 'Asia/Riyadh')::date-e.doc_date)::int age`;
 let rows:any[];
 if(f.view==='CUSTOMERS') {
  const csort={date:'oldest',age:'oldest',customer:'customer',outstanding:'outstanding',updated:'updated_at',notes:'notes',docNo:'customer',stage:'customer',assignee:'customer',billing:'customer'}[f.sort];
  rows=(await db.query(`SELECT e.customer_key,min(e.customer) customer,count(*)::int notes,count(*) FILTER(WHERE e.outstanding>0)::int unbilled,sum(e.outstanding)::int outstanding,min(e.doc_date)::text oldest,max(n.updated_at) updated_at ${sql} GROUP BY e.customer_key ORDER BY ${csort} ${dir},e.customer_key ${all?'':`LIMIT 25 OFFSET ${f.page*25}`}`,args)).rows;
 } else if(f.view==='BOARD'&&!all) {
  rows=(await db.query(`SELECT * FROM (SELECT ${columns},row_number() OVER(PARTITION BY n.stage ORDER BY ${sort} ${dir} NULLS LAST,n.id) rank ${sql}) ranked WHERE rank<=${25*(f.page+1)} ORDER BY stage,rank`,args)).rows;
 } else rows=(await db.query(`SELECT ${columns} ${sql} ORDER BY ${sort} ${dir} NULLS LAST,n.id ${all?'':`LIMIT 25 OFFSET ${f.page*25}`}`,args)).rows;
 const total=f.view==='CUSTOMERS'?Number((await one(db,`SELECT count(DISTINCT e.customer_key)::int n ${sql}`,args))!.n):summary!.notes;
 return {rows,summary,counts,total,page:f.page,report,filters:f};
}
export async function directory(db:DB,actor:Actor,reportId:string) {
 allowed(actor);
 return {customers:(await db.query('SELECT DISTINCT e.customer_key,min(e.customer) customer FROM dn_entries e JOIN dn_reports r ON r.current_snapshot=e.snapshot_id WHERE r.id=$1 GROUP BY e.customer_key ORDER BY customer',[reportId])).rows,snapshots:(await db.query("SELECT s.id,s.filename,s.report_date::text,s.created_at,s.state,u.name uploader FROM dn_snapshots s JOIN users u ON u.id=s.created_by WHERE report_id=$1 AND state<>'PREVIEW' ORDER BY created_at DESC,id DESC",[reportId])).rows};
}
export async function detail(db:DB,actor:Actor,id:string,snapshot?:string) {
 allowed(actor);const note=await one(db,'SELECT * FROM dn_notes WHERE id=$1',[id]);assert(note,404,'DN not found');
 const rows=(await db.query("SELECT e.*,s.created_at FROM dn_entries e JOIN dn_snapshots s ON s.id=e.snapshot_id WHERE e.identity_key=$1 AND s.report_id=$2 AND s.state<>'PREVIEW' AND ($3::uuid IS NULL OR s.id=$3) ORDER BY s.created_at DESC,s.id DESC LIMIT 1",[note.identity_key,note.report_id,snapshot||null])).rows;
 const events=(await db.query('SELECT h.*,u.name actor FROM dn_events h JOIN users u ON u.id=h.actor_id WHERE note_id=$1 ORDER BY h.created_at DESC,h.id DESC',[id])).rows;
 return {...note,...rows[0],id:note.id,events};
}
export async function updateNote(db:DB,actor:Actor,id:string,raw:unknown) {
 allowed(actor);allowed(actor,'EDIT');const v=z.object({version:z.number().int().positive(),stage:z.enum(stages).optional(),assignee:z.string().uuid().nullable().optional(),comment:z.string().trim().max(2000).default(''),reviewed:z.boolean().default(false)}).strict().parse(raw);
 assert(v.stage||v.assignee!==undefined||v.comment||v.reviewed,400,'No change supplied');
 return db.transaction(async tx=>{
  const old=await one(tx,'SELECT * FROM dn_notes WHERE id=$1 FOR UPDATE',[id]);assert(old,404,'DN not found');assert(old.version===v.version,409,'Another staff member changed this DN. Refresh and try again');
  assert(v.stage!=='RESOLVED'||old.stage==='RESOLVED'||v.comment.length>=3,400,'Enter a resolution note');
  if(v.assignee) assert((await metadata(tx,actor)).users.some(u=>u.id===v.assignee),400,'Select an authorized active staff member');
  const updated=await one(tx,'UPDATE dn_notes SET stage=$2,assignee=$3,needs_review=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,v.stage??old.stage,v.assignee===undefined?old.assignee:v.assignee,v.reviewed?false:old.needs_review]);
  await tx.query('INSERT INTO dn_events(id,note_id,actor_id,kind,content,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),id,actor.id,v.stage?'MOVE':v.comment?'COMMENT':'UPDATE',v.comment||'Follow-up updated',json(old),json(updated)]);
  await audit(tx,actor.id,'DN_FOLLOWUP_UPDATE','dn_notes',id,old,updated);return updated;
 });
}
export async function saveView(db:DB,actor:Actor,id:string|undefined,raw:unknown) {
 allowed(actor,'MANAGE');const v=z.object({kind:z.enum(['PRESET','GROUP']),name:z.string().trim().min(1).max(100),version:z.number().int().positive().optional(),content:z.unknown()}).parse(raw);
 const content=v.kind==='GROUP'?z.object({customers:z.array(z.string().min(1).max(250)).max(1000)}).parse(v.content):filterSchema.omit({reportId:true,snapshotId:true,page:true}).parse(v.content);
 return db.transaction(async tx=>{
  if(id) {const old=await one(tx,'SELECT * FROM dn_saved_views WHERE id=$1 FOR UPDATE',[id]);assert(old&&old.version===v.version,409,'Saved view changed. Refresh');assert(old.kind===v.kind,400,'Cannot change saved view kind');await tx.query('UPDATE dn_saved_views SET name=$2,content=$3,version=version+1,updated_at=now() WHERE id=$1',[id,v.name,json(content)]);}
  else {id=randomUUID();await tx.query('INSERT INTO dn_saved_views(id,kind,name,content,created_by) VALUES($1,$2,$3,$4,$5)',[id,v.kind,v.name,json(content),actor.id]);}
  await audit(tx,actor.id,'DN_VIEW_SAVE','dn_saved_views',id,null,{name:v.name,kind:v.kind});return {id};
 });
}
export async function removeView(db:DB,actor:Actor,id:string,version:number) {
 allowed(actor,'MANAGE');return db.transaction(async tx=>{const r=await tx.query('DELETE FROM dn_saved_views WHERE id=$1 AND version=$2 RETURNING id',[id,version]);assert(r.rows.length,409,'Saved view changed. Refresh');await audit(tx,actor.id,'DN_VIEW_DELETE','dn_saved_views',id);return {ok:true};});
}
export async function archive(db:DB,actor:Actor,id:string,version:number) {
 allowed(actor,'MANAGE');return db.transaction(async tx=>{const r=await tx.query('UPDATE dn_reports SET archived=NOT archived,version=version+1 WHERE id=$1 AND version=$2 RETURNING *',[id,version]);assert(r.rows.length,409,'Report changed. Refresh');await audit(tx,actor.id,'DN_REPORT_ARCHIVE','dn_reports',id,null,r.rows[0]);return r.rows[0];});
}
