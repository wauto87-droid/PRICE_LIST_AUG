"use client";

import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";

const cleanLine = (line: any) => {
  const { watcherEventId, importMeta, ...input } = line.input ?? line;
  return {
    ...input,
    type: input.type ?? (line.source === "CUSTOM" ? "CUSTOM" : "CATALOG"),
    ...(line.productId ? { productId: line.productId } : {}),
  };
};

export default function QuotationTemplates({ t, cart, onUse }: { t: Translate; cart: any; onUse: (cart: any, message?: string) => void }) {
  const [data, setData] = useState<any>({ items: [], availableUsers: [] });
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = () => api("quotation-templates").then(setData).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function useTemplate(item: any) {
    if (cart.lines?.length && !await showConfirm(t("Replace the current quotation with this template?", "استبدال عرض السعر الحالي بهذا القالب؟"))) return;
    setBusy(true);
    try {
      const result = await api(`quotation-templates/${item.id}/instantiate`, "POST", {});
      onUse({ customer: result.customer, lines: result.lines, templateId: item.id, templateVersion: item.version }, result.warnings?.join(" "));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function saveTemplate() {
    if (!selected) return;
    const content = { customer: cart.customer, includeFields: selected.includeFields, lines: cart.lines.map(cleanLine) };
    const payload = { name: selected.name, description: selected.description, status: selected.status, content, userIds: selected.userIds, ...(selected.id ? { version: selected.version } : {}) };
    setBusy(true);
    try {
      await api(`quotation-templates${selected.id ? "/" + selected.id : ""}`, selected.id ? "PUT" : "POST", payload);
      setSelected(null);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const start = (item?: any) => setSelected(item
    ? { ...item, includeFields: item.content.includeFields, userIds: item.users.map((u: any) => u.id) }
    : { name: "", description: "", status: "ACTIVE", includeFields: [], userIds: [] });

  if (!data.manage && !data.items.length) return null;
  if (!open) return <button className="primary" onClick={() => setOpen(true)}>{t("Quotation Templates", "قوالب عروض الأسعار")}</button>;

  return <section className="stack">
    <div className="section-title"><div><h3>{t("Quotation Templates", "قوالب عروض الأسعار")}</h3><p className="muted">{t("Catalog prices are recalculated when a template is used.", "تُعاد حساب أسعار القائمة عند استخدام القالب.")}</p></div><div className="actions">{data.manage && <button className="primary" onClick={() => start()}>{t("Save current cart as template", "حفظ السلة الحالية كقالب")}</button>}<button onClick={() => setOpen(false)}>{t("Close", "إغلاق")}</button></div></div>
    {error && <div className="notice error">{error}</div>}
    <div className="cards">{data.items.map((x: any) => <article className="card" key={x.id}>
      <h3>{x.name}</h3><p>{x.description}</p><small>{x.content.lines.length} {t("items", "أصناف")} · {x.status}</small>
      <div className="actions wrap"><button className="primary" disabled={busy || x.status !== "ACTIVE"} onClick={() => void useTemplate(x)}>{t("Use template", "استخدام القالب")}</button>{data.manage && <><button onClick={() => start(x)}>{t("Replace from current cart / settings", "استبدال من السلة / الإعدادات")}</button><button onClick={() => void api(`quotation-templates/${x.id}/duplicate`, "POST", {}).then(load).catch((e) => setError(e.message))}>{t("Duplicate", "نسخ")}</button><button className="danger" onClick={() => void (async () => { if (await showConfirm(t("Delete this template?", "حذف هذا القالب؟"))) { await api(`quotation-templates/${x.id}`, "DELETE", { version: x.version }); await load(); } })()}>{t("Delete", "حذف")}</button></>}</div>
    </article>)}</div>
    {selected && <div className="modal-backdrop"><section className="card modal">
      <h3>{t("Template settings", "إعدادات القالب")}</h3>
      <label>{t("Name", "الاسم")}<input value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })}/></label>
      <label>{t("Description", "الوصف")}<textarea value={selected.description} onChange={(e) => setSelected({ ...selected, description: e.target.value })}/></label>
      <label>{t("Status", "الحالة")}<select value={selected.status} onChange={(e) => setSelected({ ...selected, status: e.target.value })}><option value="ACTIVE">{t("Active", "نشط")}</option><option value="ARCHIVED">{t("Archived", "مؤرشف")}</option></select></label>
      <fieldset><legend>{t("Include fields", "الحقول المضمنة")}</legend>{[["name", t("Customer name", "اسم العميل")], ["number", t("Customer Code", "رمز العميل")], ["mobile", t("Mobile", "الجوال")], ["reference", t("Reference", "المرجع")], ["notes", t("Notes", "ملاحظات")]].map(([k, label]) => <label key={k}><input type="checkbox" checked={selected.includeFields.includes(k)} onChange={(e) => setSelected({ ...selected, includeFields: e.target.checked ? [...selected.includeFields, k] : selected.includeFields.filter((x: string) => x !== k) })}/>{label}</label>)}</fieldset>
      <fieldset><legend>{t("Permitted users", "المستخدمون المسموح لهم")}</legend>{data.availableUsers.map((u: any) => <label key={u.id}><input type="checkbox" checked={selected.userIds.includes(u.id)} onChange={(e) => setSelected({ ...selected, userIds: e.target.checked ? [...selected.userIds, u.id] : selected.userIds.filter((x: string) => x !== u.id) })}/>{u.name} ({u.username})</label>)}</fieldset>
      <div className="actions"><button onClick={() => setSelected(null)}>{t("Cancel", "إلغاء")}</button><button className="primary" disabled={busy || !selected.name.trim() || !cart.lines.length} onClick={() => void saveTemplate()}>{t("Save current cart", "حفظ السلة الحالية")}</button></div>
    </section></div>}
  </section>;
}
