import { documentSettings } from "../quotations/settings";
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
    e = escapeHtml,
    config = documentSettings(s),
    wm = config.watermark;
  const both = s.pdfUnitPrices === "BOTH",
    incl = s.pdfUnitPrices === "INCL";
  logo = s.brandingAssets?.logo || config.logo || logo;
  const wmImage = wm.useLogo ? logo : wm.image;
  const watermark = wm.enabled
    ? `<div class="watermark" aria-hidden="true" style="opacity:${wm.opacity};width:${wm.size}px;top:${wm.position === "TOP" ? "20%" : wm.position === "BOTTOM" ? "80%" : "50%"};transform:translate(-50%,-50%) rotate(${wm.rotation}deg)">${wmImage ? `<img src="${e(wmImage)}" alt="">` : ""}<div dir="auto">${e(wm.text)}</div></div>`
    : "";
  const detail = (label: string, value: string) =>
    value
      ? `<div><strong>${e(label)}:</strong> <span dir="auto">${e(value)}</span></div>`
      : "";
  const company = [
    detail("Legal name / الاسم القانوني", config.legalName),
    detail("VAT / الرقم الضريبي", config.vatRegistration),
    detail("CR / السجل التجاري", config.commercialRegistration),
    detail(
      "Address / العنوان",
      [config.address, config.city, config.country].filter(Boolean).join(", "),
    ),
    detail(
      "Contact / الاتصال",
      [config.phone, config.email, config.website].filter(Boolean).join(" · "),
    ),
  ].join("");
  const terms = s.quotation
    ? [
        detail("Valid for / الصلاحية", `${config.validityDays} days / أيام`),
        detail("Delivery / التسليم", config.delivery),
        detail("Payment / الدفع", config.payment),
        detail(
          "Bank / البنك",
          [config.bankName, config.accountName, config.iban]
            .filter(Boolean)
            .join(" · "),
        ),
        detail("Notes / ملاحظات", config.notes),
        detail("Terms", config.termsEnglish),
        detail("الشروط", config.termsArabic),
        detail("Signature / التوقيع", config.signatureLabel),
      ].join("")
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(q.number)}</title><style>
 @page{size:A4;margin:16mm 12mm}*{box-sizing:border-box}body{font-family:'Noto Sans Arabic',Arial,sans-serif;color:#202027;font-size:11px;font-weight:600;margin:0}main{position:relative;z-index:1}header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:3px solid #cc0000;padding-bottom:16px}header img{width:78px;height:88px;object-fit:contain}h1{font-size:22px;margin:0}h2{font-size:17px;color:#cc0000;margin:5px 0}.arabic{direction:rtl}section{margin:18px 0;display:flex;justify-content:space-between;gap:15px}table{width:100%;border-collapse:collapse}th{background:#f4f4f6;text-align:start;font-size:10px}td,th{padding:9px 5px;border-bottom:1px solid #ddd}thead{display:table-header-group}tr{break-inside:avoid}td{overflow-wrap:anywhere}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.totals{margin:20px 0 0 auto;width:280px;break-inside:avoid}.totals div{display:flex;justify-content:space-between;padding:8px}.grand{background:#fff0f0;font-size:16px;border-top:2px solid #cc0000;font-weight:800}footer{margin-top:25px;color:#555;border-top:1px solid #ddd;padding-top:12px}.draft{color:#cc0000}small{display:block;color:#555;font-size:9px;font-weight:700}.watermark{position:fixed;left:50%;z-index:0;pointer-events:none;text-align:center;font-size:32px;font-weight:800;overflow-wrap:anywhere}.watermark img{width:100%;height:auto;max-height:450px;object-fit:contain}.company,.terms{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9}.company{margin-top:12px}.terms{margin-top:24px}.terms>div{margin:5px 0}.no-print{padding:12px;background:#fff3d6}@media print{.no-print{display:none}}
 </style></head><body>${watermark}<main><header><img src="${e(logo)}" alt="AMT Electric"><div><h1>${e(s.companyName)}</h1><div class="arabic">${e(s.companyArabic)}</div><h2>QUOTATION / عرض سعر</h2></div><div><strong>${e(q.number)}</strong><br>${e(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium" }).format(new Date(q.issued_at ?? q.created_at)))}<br><span class="draft">${q.status === "DRAFT" ? "DRAFT · مسودة" : ""}</span></div></header>
 <div class="company">${company}</div><section><div><strong>Customer / العميل</strong><br>${e(q.customer.name || "Walk-in Customer")}<br>${e(q.customer.number)} ${e(q.customer.mobile)}${q.customer.notes ? `<br><small>Notes / ملاحظات</small><span dir="auto">${e(q.customer.notes)}</span>` : ""}</div><div>Reference / المرجع<br>${e(q.customer.reference)}</div></section>
 <table><thead><tr><th>Part / الصنف</th><th>Description / الوصف</th><th>Qty / الكمية</th><th>Unit ${incl ? "incl." : "excl."} VAT${both ? "<small>Incl. VAT</small>" : ""}</th><th>Discount<br>الخصم</th><th>Excl. VAT<br>قبل الضريبة</th><th>VAT<br>الضريبة</th><th>Total<br>الإجمالي</th></tr></thead><tbody>${q.lines.map((l: any) => `<tr><td>${e(l.partNumber)}</td><td>${e(l.description)}</td><td class="num">${e(l.price.quantity)} ${e(l.unit)}</td><td class="num">${e(incl ? l.price.finalIncl : l.price.finalExcl)}${both ? `<small>${e(l.price.finalIncl)}</small>` : ""}</td><td class="num">${e(l.price.effectiveDiscount)}%</td><td class="num">${e(l.price.subtotal)}</td><td class="num">${e(l.price.vatAmount)}<small>${e(l.price.vatRate)}%</small></td><td class="num">${e(l.price.total)}</td></tr>`).join("")}</tbody></table>
 <div class="totals"><div><span>Subtotal / المجموع</span><span>${e(q.totals.subtotal)}</span></div><div><span>VAT / الضريبة</span><span>${e(q.totals.vat)}</span></div><div class="grand"><span>Total / الإجمالي</span><span>${e(s.currency)} ${e(q.totals.total)}</span></div></div><div class="terms">${terms}</div><footer>${e(config.footer)}<br>Quotation only — not a tax invoice. / عرض سعر فقط — ليس فاتورة ضريبية.<br>Unit VAT-inclusive values are rounded for display. Totals use line-level VAT rounding.</footer></main></body></html>`;
}
