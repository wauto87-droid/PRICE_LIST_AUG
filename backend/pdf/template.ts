export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function quotationHtml(q: any, settings: any, logo: string) {
  const s = q.company_snapshot ?? settings,
    e = escapeHtml;
  const both = s.pdfUnitPrices === "BOTH",
    incl = s.pdfUnitPrices === "INCL";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(q.number)}</title><style>
  @page{size:A4;margin:16mm 12mm}*{box-sizing:border-box}body{font-family:'Noto Sans Arabic',Arial,sans-serif;color:#202027;font-size:11px;margin:0}header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #cc0000;padding-bottom:16px}img{width:78px;height:88px;object-fit:contain}h1{font-size:22px;margin:0}h2{font-size:17px;color:#cc0000;margin:5px 0}.arabic{direction:rtl}section{margin:18px 0;display:flex;justify-content:space-between}table{width:100%;border-collapse:collapse}th{background:#f4f4f6;text-align:start;font-size:10px}td,th{padding:9px 5px;border-bottom:1px solid #ddd}thead{display:table-header-group}tr{break-inside:avoid}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.totals{margin:20px 0 0 auto;width:280px}.totals div{display:flex;justify-content:space-between;padding:8px}.grand{background:#fff0f0;font-size:16px;border-top:2px solid #cc0000;font-weight:bold}footer{margin-top:25px;color:#666;border-top:1px solid #ddd;padding-top:12px}.draft{color:#cc0000}small{display:block;color:#666}.no-print{padding:12px;background:#fff3d6}@media print{.no-print{display:none}}
  </style></head><body><header><img src="${logo}" alt="AMT Electric"><div><h1>${e(s.companyName)}</h1><div class="arabic">${e(s.companyArabic)}</div><h2>QUOTATION / عرض سعر</h2></div><div><strong>${e(q.number)}</strong><br>${e(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium" }).format(new Date(q.issued_at ?? q.created_at)))}<br><span class="draft">${q.status === "DRAFT" ? "DRAFT · مسودة" : ""}</span></div></header>
  <section><div><strong>Customer / العميل</strong><br>${e(q.customer.name || "Walk-in Customer")}<br>${e(q.customer.number)} ${e(q.customer.mobile)}</div><div>Reference / المرجع<br>${e(q.customer.reference)}</div></section>
  <table><thead><tr><th>Part / الصنف</th><th>Description / الوصف</th><th>Qty / الكمية</th><th>Unit ${incl ? "incl." : "excl."} VAT${both ? "<small>Incl. VAT</small>" : ""}</th><th>Discount<br>الخصم</th><th>Excl. VAT<br>قبل الضريبة</th><th>VAT<br>الضريبة</th><th>Total<br>الإجمالي</th></tr></thead><tbody>${q.lines.map((l: any) => `<tr><td>${e(l.partNumber)}</td><td>${e(l.description)}</td><td class="num">${e(l.price.quantity)} ${e(l.unit)}</td><td class="num">${e(incl ? l.price.finalIncl : l.price.finalExcl)}${both ? `<small>${e(l.price.finalIncl)}</small>` : ""}</td><td class="num">${e(l.price.effectiveDiscount)}%</td><td class="num">${e(l.price.subtotal)}</td><td class="num">${e(l.price.vatAmount)}<small>${e(l.price.vatRate)}%</small></td><td class="num">${e(l.price.total)}</td></tr>`).join("")}</tbody></table>
  <div class="totals"><div><span>Subtotal / المجموع</span><span>${e(q.totals.subtotal)}</span></div><div><span>VAT / الضريبة</span><span>${e(q.totals.vat)}</span></div><div class="grand"><span>Total / الإجمالي</span><span>${e(s.currency)} ${e(q.totals.total)}</span></div></div><footer>Quotation only — not a tax invoice. / عرض سعر فقط — ليس فاتورة ضريبية.<br>Unit VAT-inclusive values are rounded for display. Totals use line-level VAT rounding.</footer></body></html>`;
}
