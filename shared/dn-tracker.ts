import Decimal from 'decimal.js';
export const stages = ['REVIEW','FOLLOW_UP','READY','RESOLVED'] as const;
export const stageNames: Record<string, [string,string]> = {
 REVIEW:['To review','للمراجعة'], FOLLOW_UP:['Following up','قيد المتابعة'], READY:['Ready to bill','جاهز للفوترة'], RESOLVED:['Resolved','تمت المتابعة']
};
export const fields = ['date','docNo','customer','customerCode','itemCode','itemName','unit','qty','invoiced','invoiceRet','deliveryRet','balance'] as const;
export type DNField = typeof fields[number];
export const fieldNames: Record<DNField,[string,string]> = {
 date:['DN date','تاريخ الإذن'],docNo:['DN number','رقم الإذن'],customer:['Customer','العميل'],customerCode:['Customer code','رمز العميل'],itemCode:['Item code','رمز الصنف'],itemName:['Description','الوصف'],unit:['Unit','الوحدة'],qty:['Quantity','الكمية'],invoiced:['Invoiced','المفوتر'],invoiceRet:['Invoice returns','مرتجع الفاتورة'],deliveryRet:['Delivery returns','مرتجع التسليم'],balance:['Outstanding balance','الرصيد المتبقي']
};
export const billingNames: Record<string,[string,string]> = { NOT_INVOICED:['Not invoiced','غير مفوتر'],PARTIAL:['Partially invoiced','مفوتر جزئياً'],SETTLED:['No outstanding balance','لا يوجد رصيد متبقٍ'],RETURNED:['Settled with returns','مسوّى مع مرتجعات'],REVIEW:['Review figures','مراجعة الأرقام'] };
export const normalizeCustomer = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
export const displayDate = (value: unknown) => {const s=String(value??'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.split('-').reverse().join('-'):s;};
export function numberValue(raw: unknown, optional = false): string | null {
 const s = String(raw ?? '').trim().replace(/[٠-٩]/g,x=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/٬/g,',').replace(/٫/g,'.');
 if (!s) return optional ? '0' : null;
 if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(s)) return null;
 const n = new Decimal(s.replaceAll(',',''));
 return n.abs().lte('999999999999') ? n.toString() : null;
}
export function dateValue(raw: unknown): string | null {
 const s = String(raw ?? '').trim();
 if (/^\d+(\.\d+)?$/.test(s) && Number(s)>10000 && Number(s)<100000) return new Date(Date.UTC(1899,11,30)+Math.floor(Number(s))*86400000).toISOString().slice(0,10);
 const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
 if (!m) return null;
 const date = `${m[1]}-${m[2]}-${m[3]}`;
 const parsed = new Date(date+'T00:00:00Z');
 return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===date ? date : null;
}
export function detectMapping(headers: string[]): Record<DNField, number> {
 const patterns: Record<DNField,RegExp> = { date:/date|تاريخ/i,docNo:/doc|dn\b|رقم.*إذن/i,customer:/^(customer|company|customer name|اسم العميل|العميل)$/i,customerCode:/customer.*code|رمز العميل/i,itemCode:/^(item code|code|sku|رمز الصنف)$/i,itemName:/description|item name|وصف/i,unit:/^unit$|الوحدة/i,qty:/^qty$|quantity|الكمية/i,invoiced:/^(invoiced|invoice qty|المفوتر)$/i,invoiceRet:/inv.*ret|مرتجع الفاتورة/i,deliveryRet:/del.*ret|مرتجع التسليم/i,balance:/balance|outstanding|الرصيد/i };
 return Object.fromEntries(fields.map(k=>[k,headers.findIndex(h=>patterns[k].test(h.trim()) || (k==='customer' && /^cust[.\s]*name$/i.test(h.trim())))])) as Record<DNField,number>;
}
export type DNLine = Record<DNField,string> & { row: number; review: boolean };
export function parseRows(rows: string[][], mapping: Record<DNField,number>, header: number, dateOrder: 'ISO'|'DMY'|'MDY' = 'ISO') {
 const issues: { row:number; message:string }[] = [], lines: DNLine[] = [];
 const required: DNField[] = ['date','docNo','customer','balance'];
 for (const k of required) if (mapping[k]<0) throw new Error(`Map ${k}`);
 if (mapping.itemCode<0 && mapping.itemName<0) throw new Error('Map item description or reference');
 const mapped = fields.map(k=>mapping[k]).filter(i=>i>=0);
 if (new Set(mapped).size !== mapped.length) throw new Error('Each column can only be mapped once');
 rows.slice(header+1).forEach((row,index)=>{
  if (row.every(v=>!String(v).trim())) return;
  const line = Object.fromEntries(fields.map(k=>[k,mapping[k]<0 ? '' : String(row[mapping[k]]??'').trim()])) as DNLine;
  line.row = header+index+2;
  let dateRaw=line.date;
  if (dateOrder!=='ISO') { const m=dateRaw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/); if(m) dateRaw=`${m[3]}-${(dateOrder==='DMY'?m[2]:m[1]).padStart(2,'0')}-${(dateOrder==='DMY'?m[1]:m[2]).padStart(2,'0')}`; }
  const date=dateValue(dateRaw);
  if(!date || !line.docNo || !line.customer || (!line.itemCode && !line.itemName)) { issues.push({row:line.row,message:'Missing customer, DN number, item, or valid date'}); return; }
  line.date=date;
  for (const k of ['qty','invoiced','invoiceRet','deliveryRet','balance'] as const) {
   const n=numberValue(line[k],k!=='balance' && mapping[k]<0);
   if(n===null) { issues.push({row:line.row,message:`Invalid or missing ${k}`}); return; }
   line[k]=n;
  }
  line.unit ||= '—';
  line.review=['qty','invoiced','invoiceRet','deliveryRet','balance'].some(k=>new Decimal(line[k as DNField]).lt(0)) || (mapping.qty>=0 && (new Decimal(line.balance).gt(line.qty) || new Decimal(line.invoiced).gt(line.qty)));
  lines.push(line);
 });
 return {lines,issues};
}
export function groupLines(lines: DNLine[]) {
 const groups = new Map<string,any>();
 for(const l of lines) {
  const customerKey=l.customerCode ? `CODE:${normalizeCustomer(l.customerCode)}` : `NAME:${normalizeCustomer(l.customer)}`;
  const identity=JSON.stringify([customerKey,l.docNo,l.date]);
  if(!groups.has(identity)) groups.set(identity,{identity,customerKey,customer:l.customer,customerCode:l.customerCode,docNo:l.docNo,date:l.date,lines:[],quantities:{},outstanding:0,hasReturns:false,billing:'SETTLED'});
  const g=groups.get(identity); g.lines.push(l);
  if(new Decimal(l.balance).gt(0)) { g.outstanding++;g.quantities[l.unit]=new Decimal(g.quantities[l.unit]||0).add(l.balance).toString(); }
  g.hasReturns ||= new Decimal(l.invoiceRet).gt(0)||new Decimal(l.deliveryRet).gt(0);
 }
 return [...groups.values()].map(g=>({...g,billing:g.lines.some((l:DNLine)=>l.review) ? 'REVIEW' : g.outstanding ? g.lines.some((l:DNLine)=>new Decimal(l.invoiced).gt(0))?'PARTIAL':'NOT_INVOICED' : g.hasReturns?'RETURNED':'SETTLED'}));
}
