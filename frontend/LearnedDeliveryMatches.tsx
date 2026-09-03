"use client";

import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";

export default function LearnedDeliveryMatches({ t }: { t: Translate }) {
  const [data, setData] = useState<any>({ items: [] });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("NEWEST");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<any>(null);
  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async (nextPage = page) => {
    try {
      setData(await api(`learned-delivery-matches?${new URLSearchParams({ q, status, sort, page: String(nextPage), pageSize: "20" })}`));
      setPage(nextPage); setError("");
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(0); }, [status, sort]);
  useEffect(() => {
    if (!productQuery.trim()) { setProducts([]); return; }
    const timer = setTimeout(() => api(`search?q=${encodeURIComponent(productQuery)}`).then((x) => setProducts(x.slice(0, 5))).catch(() => setProducts([])), 250);
    return () => clearTimeout(timer);
  }, [productQuery]);
  async function save() {
    if (!edit?.product_id) return;
    setBusy(true);
    try {
      await api(`learned-delivery-matches/${encodeURIComponent(edit.normalized)}`, "PUT", { alias: edit.label, productId: edit.product_id, version: edit.version });
      setEdit(null); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section>
    <div className="form-grid three"><label>{t("Search external code or catalog item", "ابحث برمز خارجي أو صنف")}<input value={q} onChange={(e) => setQ(e.target.value)}/></label><label>{t("Catalog status", "حالة الصنف")}<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">{t("All", "الكل")}</option><option value="ACTIVE">{t("Active", "نشط")}</option><option value="ARCHIVED">{t("Archived", "مؤرشف")}</option></select></label><label>{t("Sort", "الترتيب")}<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="NEWEST">{t("Newest", "الأحدث")}</option><option value="OLDEST">{t("Oldest", "الأقدم")}</option><option value="CODE_ASC">{t("Code A–Z", "الرمز تصاعدياً")}</option><option value="CODE_DESC">{t("Code Z–A", "الرمز تنازلياً")}</option><option value="MOST_USED">{t("Most used", "الأكثر استخداماً")}</option></select></label><button onClick={() => void load(0)}>{t("Search", "بحث")}</button></div>
    {error && <div className="notice error">{error}</div>}
    <p className="muted">{data.total ?? 0} {t("learned matches. Changes affect future imports only.", "مطابقة محفوظة. التغييرات تؤثر على الاستيرادات المستقبلية فقط.")}</p>
    <div className="table-scroll"><table><thead><tr><th>{t("External code", "الرمز الخارجي")}</th><th>{t("Catalog item", "صنف القائمة")}</th><th>{t("Usage", "الاستخدام")}</th><th>{t("Created by / date", "أنشأها / التاريخ")}</th><th>{t("Actions", "الإجراءات")}</th></tr></thead><tbody>{data.items.map((x: any) => <tr key={x.normalized}><td><b>{x.label}</b></td><td>{x.part_number}<br/><small>{x.description}</small>{!x.active && <span className="badge danger">{t("Archived", "مؤرشف")}</span>}</td><td>{x.usage_count}<br/><small>{x.last_used_at ? new Date(x.last_used_at).toLocaleString() : t("Never", "لم يُستخدم")}</small></td><td>{x.creator_name || t("Legacy / unknown", "قديم / غير معروف")}<br/><small>{new Date(x.created_at).toLocaleString()}</small></td><td><button onClick={() => { setEdit(x); setProductQuery(x.part_number); }}>{t("Edit / reassign", "تعديل / إعادة ربط")}</button><button className="danger" disabled={busy} onClick={() => void (async () => { if (!await showConfirm(t("Delete this learned match? Existing quotations will not change.", "حذف هذه المطابقة؟ لن تتغير عروض الأسعار الحالية."))) return; try { await api(`learned-delivery-matches/${encodeURIComponent(x.normalized)}`, "DELETE", { version: x.version }); await load(); } catch (e) { setError((e as Error).message); } })()}>{t("Delete", "حذف")}</button></td></tr>)}</tbody></table></div>
    <div className="actions"><button disabled={page <= 0} onClick={() => void load(page - 1)}>{t("Previous", "السابق")}</button><span>{page + 1} / {data.totalPages ?? 1}</span><button disabled={page + 1 >= (data.totalPages ?? 1)} onClick={() => void load(page + 1)}>{t("Next", "التالي")}</button></div>
    {edit && <div className="modal-backdrop"><section className="card modal"><h3>{t("Edit learned delivery match", "تعديل مطابقة إذن التسليم")}</h3><label>{t("External code", "الرمز الخارجي")}<input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })}/></label><label>{t("Find correct catalog item", "ابحث عن الصنف الصحيح")}<input value={productQuery} onChange={(e) => setProductQuery(e.target.value)}/></label><div className="stack">{products.map((p) => <button key={p.id} className={edit.product_id === p.id ? "primary" : ""} onClick={() => setEdit({ ...edit, product_id: p.id, part_number: p.partNumber })}><b>{p.partNumber}</b> · {p.description}</button>)}</div><p>{t("Selected", "المحدد")}: <b>{edit.part_number}</b></p><div className="actions"><button onClick={() => setEdit(null)}>{t("Cancel", "إلغاء")}</button><button className="primary" disabled={busy} onClick={() => void save()}>{t("Save", "حفظ")}</button></div></section></div>}
  </section>;
}
