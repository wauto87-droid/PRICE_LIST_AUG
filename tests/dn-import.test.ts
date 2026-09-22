import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { embedded, migrate } from '../backend/core/db';
import { setup, login, authenticate, sessionCookie } from '../backend/auth/service';
import { preview, commit, list, detail, clearReport, readWorkbook, updateNote } from '../backend/dn-tracker/service';
import { exportReport } from '../backend/dn-tracker/export';
import { detectMapping, parseRows, displayDate } from '../shared/dn-tracker';
import { reviewDuplicates } from '../backend/dn-tracker/duplicates';

const headers=['Date','Document No','Cust.Name','Item Code','Item Name','Unit','Qty','Invoiced','Invoice Returned','Delivery Returned','Balance'];
const line=['17-09-2026','1822','Customer','HEATER','Heater plug','PCS','5','0','0','0','5'];
const input=(rows=[headers,line,line])=>({name:'Test DN',filename:'test.csv',reportDate:'2026-09-22',header:0,dateOrder:'DMY',mapping:detectMapping(headers),rows});

test('duplicate groups preserve fractions, require decisions and reject stale group IDs',()=>{
 const half=[...line];half[3]='HALF';half[6]=half[10]='0.5';
 const parsed=parseRows([headers,line,line,half,half],detectMapping(headers),0,'DMY');
 assert.equal(parsed.issues.length,0);
 const initial=reviewDuplicates(parsed.lines,{});
 assert.equal(initial.unresolved,2);
 const reviewed=reviewDuplicates(parsed.lines,{[initial.duplicates[0].id]:'KEEP_ALL',[initial.duplicates[1].id]:'KEEP_FIRST'});
 assert.equal(reviewed.included.length,3);assert.equal(reviewed.excluded[0].balance,'0.5');
 assert.throws(()=>reviewDuplicates(parsed.lines,{['0'.repeat(64)]:'KEEP_ALL'}),/review changed/);
 assert.equal(displayDate(parsed.lines[0].date),'17-09-2026');
 for(const [column,value] of [[0,'31-02-2026'],[2,''],[10,'bad']] as const){const invalid=[...line];invalid[column]=value;assert.equal(parseRows([headers,invalid],detectMapping(headers),0,'DMY').issues.length,1);}
});

test('reviewed import, exports, retries, stale previews, permissions and clear/archive',async()=>{
 const db=await embedded();
 try {
  await migrate(db);process.env.SETUP_TOKEN='dn-import-test-setup-token-long-enough';
  await setup(db,{token:process.env.SETUP_TOKEN,username:'admin',password:'abcd',name:'Admin',companyName:'AMT'});
  const signed=await login(db,{username:'admin',password:'abcd'});
  const actor=await authenticate(db,new Request('http://localhost',{headers:{Cookie:sessionCookie(signed.token).split(';')[0]}}));
  const denied={...actor,role:'STAFF',permissions:[]};
  await assert.rejects(()=>preview(db,denied,input()));
  for(const choice of ['KEEP_ALL','KEEP_FIRST'] as const){
   let p=await preview(db,actor,input());
   assert.equal(p.comparison.duplicateReview.unresolved,1);assert.equal(p.issues.length,0);
   await assert.rejects(()=>commit(db,actor,p.id,{acknowledge:true}),/each repeated/);
   p=await preview(db,actor,{...input(),previewId:p.id,duplicateDecisions:{[p.comparison.duplicateReview.groups[0].id]:choice}});
   const count=choice==='KEEP_ALL'?2:1;
   assert.equal(p.comparison.rows,count);assert.equal(p.comparison.excludedRows,2-count);
   await commit(db,actor,p.id,{acknowledge:true});await commit(db,actor,p.id,{acknowledge:true});
   const filters={reportId:p.reportId};const data=await list(db,actor,filters);
   assert.equal(data.total,1);assert.equal(data.rows[0].quantities.PCS,String(count*5));
   const savedDetail:any=await detail(db,actor,data.rows[0].id);
   assert.equal(savedDetail.lines.length,count);
   const exported=await exportReport(db,actor,{filters,format:'XLSX'});
   const book=new ExcelJS.Workbook();await book.xlsx.load(exported.bytes as any);
   assert.equal(book.worksheets[0].rowCount,count+1);
   assert.equal(book.worksheets[0].getCell('K2').value,5);
   const reportCount=(await db.query('SELECT count(*)::int n FROM dn_reports')).rows[0].n;
   assert.equal(reportCount,choice==='KEEP_ALL'?1:2);
   const staged=await preview(db,actor,{...input(),reportId:p.reportId});
   await updateNote(db,actor,data.rows[0].id,{version:1,stage:'FOLLOW_UP',comment:'Call customer'});
   await assert.rejects(()=>clearReport(db,denied,p.reportId,data.report.version));
   await assert.rejects(()=>clearReport(db,actor,p.reportId,1),/Report changed/);
   await clearReport(db,actor,p.reportId,data.report.version);
   assert.equal((await list(db,actor,filters)).total,0);
   assert.equal((await list(db,actor,{...filters,snapshotId:p.id})).total,1);
   assert.equal((await detail(db,actor,data.rows[0].id)).events.length,1);
   await assert.rejects(()=>commit(db,actor,staged.id,{acknowledge:true}),/Report changed/);
   const reimport=await preview(db,actor,{...input(),reportId:p.reportId,duplicateDecisions:{[p.comparison.duplicateReview.groups[0].id]:choice}});
   await commit(db,actor,reimport.id,{acknowledge:true});
   assert.equal((await list(db,actor,filters)).rows[0].stage,'FOLLOW_UP');
  }
  if(process.env.DN_SAMPLE_FILE){
   const upload=await readWorkbook(actor,new File([await fs.readFile(process.env.DN_SAMPLE_FILE)],'sample.xls'));
   const rows=upload.sheets[0].rows;
   let p=await preview(db,actor,{...input(rows),dateOrder:'ISO'});
   assert.equal(p.comparison.customers,77);assert.equal(p.comparison.notes,291);assert.equal(p.comparison.rows,554);
   assert.deepEqual(p.comparison.duplicateReview.groups[0].rows.map(r=>r.row),[537,538]);
   for(const choice of ['KEEP_ALL','KEEP_FIRST'] as const){
    p=await preview(db,actor,{...input(rows),dateOrder:'ISO',reportId:p.reportId,duplicateDecisions:{[p.comparison.duplicateReview.groups[0].id]:choice}});
    assert.equal(p.comparison.rows,choice==='KEEP_ALL'?554:553);
    assert.equal(p.comparison.notes,291);assert.equal(p.comparison.customers,77);
    await commit(db,actor,p.id,{acknowledge:true});
    const data=await list(db,actor,{reportId:p.reportId,billing:'ALL',view:'NOTES'},true);
    assert.equal(data.total,291);
    const dn=data.rows.find(r=>r.doc_no==='1822');
    const heater=dn.lines.filter((l:any)=>l.itemCode==='HEATER PLUG 2 PIN');
    assert.equal(heater.reduce((sum:number,l:any)=>sum+Number(l.balance),0),choice==='KEEP_ALL'?10:5);
    const exported=await exportReport(db,actor,{filters:{reportId:p.reportId,billing:'ALL'},format:'XLSX'});
    const book=new ExcelJS.Workbook();await book.xlsx.load(exported.bytes as any);
    assert.equal(book.worksheets[0].rowCount,choice==='KEEP_ALL'?555:554);
   }
  }
 } finally {await db.close?.();}
});
