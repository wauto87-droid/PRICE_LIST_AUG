"use client";

import { useEffect, useState } from "react";
import { api, type Translate } from "./api";

export function priceHistoryItemKey(line: any) {
  if (line.productId) return `CATALOG:${line.productId}`;
  if (line.input?.reusableItemId) return `REUSABLE:${line.input.reusableItemId}`;
  const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  if (line.partNumber || line.input?.partNumber) return `CUSTOM-REF:${normalize(line.partNumber || line.input.partNumber)}`;
  return `CUSTOM-DESC:${normalize(line.description || line.input?.description || "")}`;
}

export default function RecentQuotationPrices({ line, customer, quotationId, t, onClose }: { line: any; customer: any; quotationId?: string; t: Translate; onClose: () => void }) {
  const [stage, setStage] = useState<"ALL" | "DRAFT" | "ISSUED">("ALL");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<any>({ items: [], hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true); setError("");
    const query = new URLSearchParams({ itemKey: priceHistoryItemKey(line), stage, customerNumber: customer?.number?.trim() ?? "", customerName: customer?.name ?? "", page: String(page), pageSize: stage === "ALL" ? "20" : "10" });
    if (quotationId) query.set("excludeQuotationId", quotationId);
    api(`quotation-price-history?${query}`).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [stage, page, line, customer?.number, customer?.name, quotationId]);

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="card modal recent-price-modal" role="dialog" aria-modal="true">
    <div className="section-title"><div><h3>{t("Recent prices", "الأسعار السابقة")} · {line.partNumber || line.input?.partNumber}</h3><p className="muted">{t("Quotation activity is pricing history, not confirmed sales.", "سجل عروض الأسعار ليس مبيعات مؤكدة.")}</p></div><button onClick={onClose}>×</button></div>
    <div className="tabs"><button className={stage === "ALL" ? "primary" : ""} onClick={() => { setStage("ALL"); setPage(0); }}>{t("All prices", "كل الأسعار")}</button><button className={stage === "ISSUED" ? "primary" : ""} onClick={() => { setStage("ISSUED"); setPage(0); }}>{t("Issued quotations", "العروض المصدرة")}</button><button className={stage === "DRAFT" ? "primary" : ""} onClick={() => { setStage("DRAFT"); setPage(0); }}>{t("Draft prices", "أسعار المسودات")}</button></div>
    {loading ? <p>{t("Loading…", "جارٍ التحميل…")}</p> : error ? <div className="notice error">{error}</div> : !data.items.length ? <div className="notice">{t("No Draft or Issued quotation prices were found for this item.", "لم يتم العثور على أسعار مسودة أو عروض مصدرة لهذا الصنف.")}</div> : <div className="table-scroll"><table><thead><tr><th>{t("Quotation", "العرض")}</th><th className="recent-price-part">{t("Part Number", "رقم الصنف")}</th><th>{t("Customer", "العميل")}</th><th>{t("Staff / date", "الموظف / التاريخ")}</th><th>{t("Qty / level", "الكمية / المستوى")}</th><th>{t("Rate", "النسبة")}</th><th>{t("Unit excl./incl. VAT", "الوحدة قبل/بعد الضريبة")}</th></tr></thead><tbody>{data.items.map((x: any) => <tr key={x.id} className={x.same_customer ? "same-customer-price" : ""}><td><b>{x.quotation_number}</b><span className={`badge ${x.stage === "ISSUED" ? "success" : ""}`}>{x.stage === "ISSUED" ? t("Issued", "مصدر") : t("Draft", "مسودة")}</span>{x.same_customer && <span className="badge success">{t("Same customer", "نفس العميل")}</span>}</td><td className="recent-price-part"><b>{x.part_number || "—"}</b></td><td>{x.customer_name || t("Walk-in Customer", "عميل نقدي")}</td><td>{x.staff_name}<br/><small>{new Date(x.last_seen_at).toLocaleString()}</small></td><td>{x.quantity}<br/><small>{x.selling_level}</small></td><td>{x.adjustment_mode === "MARKUP" ? `${Number(x.effective_markup)}% ${t("markup", "زيادة")}` : `${Number(x.effective_discount)}% ${t("discount", "خصم")}`}</td><td><b>SAR {x.final_excl}</b><br/><small>SAR {x.final_incl}</small></td></tr>)}</tbody></table></div>}
    <div className="actions"><button disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Previous", "السابق")}</button><button disabled={!data.hasMore} onClick={() => setPage(page + 1)}>{t("View more", "عرض المزيد")}</button></div>
  </section></div>;
}
