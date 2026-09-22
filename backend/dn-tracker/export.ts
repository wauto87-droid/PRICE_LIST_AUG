import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import type { DB } from '../core/db';
import type { Actor } from '../auth/service';
import { list } from './service';
import { assert } from '../core/errors';
import { displayDate, stageNames, billingNames } from '../../shared/dn-tracker';
import { escapeHtml } from '../pdf/template';
export async function exportReport(db:DB,actor:Actor,raw:any) {
 const format=raw.format==='PDF'?'PDF':'XLSX',customers=raw.scope==='CUSTOMERS',ar=raw.language==='ar';
 const report=await list(db,actor,{...raw.filters,view:customers?'CUSTOMERS':'NOTES'},true);
 const label=(en:string,arabic:string)=>ar?arabic:en;
 const headings=customers?[label('Customer','العميل'),label('DNs','الأذونات'),label('Unbilled DNs','أذونات غير مفوترة'),label('Outstanding rows','صفوف متبقية'),label('Oldest DN','أقدم إذن')]:[label('Customer','العميل'),label('DN','الإذن'),label('Date','التاريخ'),label('Item','الصنف'),label('Description','الوصف'),label('Unit','الوحدة'),label('Qty','الكمية'),label('Invoiced','المفوتر'),label('Invoice return','مرتجع الفاتورة'),label('Delivery return','مرتجع التسليم'),label('Balance','المتبقي'),label('Billing','الفوترة'),label('Follow-up','المتابعة')];
 const rows:any[][]=customers?report.rows.map(r=>[r.customer,r.notes,r.unbilled,r.outstanding,displayDate(r.oldest)]):report.rows.flatMap(r=>r.lines.map((l:any)=>[r.customer,r.doc_no,displayDate(r.doc_date),l.itemCode,l.itemName,l.unit,Number(l.qty),Number(l.invoiced),Number(l.invoiceRet),Number(l.deliveryRet),Number(l.balance),billingNames[r.billing][ar?1:0],stageNames[r.stage][ar?1:0]]));
 assert(rows.length<=20000,400,'Narrow the export to 20,000 rows');
 if(format==='XLSX') {
  const book=new ExcelJS.Workbook();book.creator='AMT Electric';const sheet=book.addWorksheet(customers?'Customers':'Delivery notes',{views:[{state:'frozen',ySplit:1,rightToLeft:ar}]});
  sheet.addRow(headings);sheet.addRows(rows);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF174B57'}};
  sheet.columns.forEach((col,i)=>{col.width=i===0||i===4?34:18;});
  const dateCol=customers?5:3;sheet.eachRow((row,i)=>{if(i>1){const cell=row.getCell(dateCol);const val=String(cell.value);cell.value=new Date(val.split('-').reverse().join('-')+'T00:00:00Z');cell.numFmt='dd-mm-yyyy';}});
  const context=book.addWorksheet('Report context');context.addRows([['Report',report.report.name],['Filters',JSON.stringify(report.filters)],['Billing','Imported evidence; follow-up moves do not change billing figures']]);
  return {bytes:Buffer.from(await book.xlsx.writeBuffer()),type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',extension:'xlsx'};
 }
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:process.env.WHATSAPP_NO_SANDBOX==='true'?['--no-sandbox']:[]});
 try {
  const page=await browser.newPage();await page.route('**/*',r=>r.abort());
  await page.setContent(`<html dir="${ar?'rtl':'ltr'}"><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:9px;color:#172a32}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d5dfe2;padding:5px;text-align:start;overflow-wrap:anywhere}th{background:#edf4f5}tr{break-inside:avoid}thead{display:table-header-group}</style><h1>AMT · ${escapeHtml(report.report.name)}</h1><p>${escapeHtml(label('Billing is imported evidence. Follow-up stages do not change invoicing.','بيانات الفوترة مستوردة. مراحل المتابعة لا تغير الفواتير.'))}</p><p>${escapeHtml(JSON.stringify(report.filters))}</p><table><thead><tr>${headings.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${escapeHtml(String(v))}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`);
  return {bytes:await page.pdf({format:'A3',landscape:true,printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'}}),type:'application/pdf',extension:'pdf'};
 } finally {await browser.close();}
}
