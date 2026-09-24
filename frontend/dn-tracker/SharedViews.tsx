"use client";
import { useState } from "react";
import { api } from "../api";
import { DNDialog } from "./controls";
import CustomerSelectionTable from "./CustomerSelectionTable";
export default function SharedViews({
  meta,
  directory,
  filters,
  t,
  close,
  refresh,
  initial,
}: any) {
  const [tab, setTab] = useState(
      initial?.kind === "PRESET" ? "PRESET" : "GROUP",
    ),
    [draft, setDraft] = useState<any>(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState<any>();
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const requestClose = () => (draft ? setConfirm({ kind: "CLOSE" }) : close());
  const requestTab = (next: string) => {
    if (next === tab) return;
    if (draft) setConfirm({ kind: "SWITCH", tab: next });
    else setTab(next);
  };
  const requestCancel = () =>
    draft ? setConfirm({ kind: "CANCEL" }) : setDraft(null);
  const edit = (v: any) =>
    setDraft({ ...v, customers: v.content.customers || [] });
  const create = (kind: string) =>
    setDraft(
      kind === "GROUP"
        ? { kind, name: "", customers: [] }
        : { kind, name: "", content: filters },
    );
  const list = meta.views.filter((v: any) => v.kind === tab);
  return (
    <DNDialog
      title={t(
        "Shared presets & customer groups",
        "العروض المحفوظة ومجموعات العملاء",
      )}
      close={requestClose}
      wide
    >
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="dn-manager-tabs">
        <button
          className={tab === "GROUP" ? "primary" : ""}
          onClick={() => requestTab("GROUP")}
        >
          {t("Customer groups", "مجموعات العملاء")}
        </button>
        <button
          className={tab === "PRESET" ? "primary" : ""}
          onClick={() => requestTab("PRESET")}
        >
          {t("Saved presets", "العروض المحفوظة")}
        </button>
      </div>
      {!draft ? (
        <>
          <div className="actions">
            <button className="primary" onClick={() => create(tab)}>
              {tab === "GROUP"
                ? t("New customer group", "مجموعة عملاء جديدة")
                : t("Save current view", "حفظ العرض الحالي")}
            </button>
          </div>
          <div className="dn-saved-grid">
            {list.map((v: any) => (
              <article className="dn-saved-view" key={v.id}>
                <strong>{v.name}</strong>
                <small>
                  {v.kind === "GROUP"
                    ? `${v.content.customers?.length || 0} ${t("companies", "شركة")}`
                    : t(
                        "Filters, sorting and view",
                        "المرشحات والترتيب والعرض",
                      )}
                </small>
                <div className="actions">
                  <button onClick={() => edit(v)}>{t("Edit", "تعديل")}</button>
                  <button
                    onClick={() =>
                      setDraft({
                        ...v,
                        id: undefined,
                        version: undefined,
                        name: v.name + " " + t("Copy", "نسخة"),
                        customers: v.content.customers || [],
                      })
                    }
                  >
                    {t("Duplicate", "نسخ")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => setConfirm({ kind: "DELETE", view: v })}
                  >
                    {t("Delete", "حذف")}
                  </button>
                </div>
              </article>
            ))}
            {!list.length && (
              <p className="dn-empty">
                {t("Nothing saved here yet.", "لا توجد عناصر محفوظة بعد.")}
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="dn-view-editor">
          <label>
            {t("Name", "الاسم")}
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          {draft.kind === "GROUP" ? (
            <CustomerSelectionTable
              label={t("Group customers", "عملاء المجموعة")}
              customers={directory.customers}
              value={draft.customers}
              onChange={(customers) => setDraft({ ...draft, customers })}
              t={t}
            />
          ) : (
            <>
              <p>
                {t(
                  "This preset stores the current filters, sorting and selected view. Excluded companies take precedence over included companies.",
                  "يحفظ هذا العرض المرشحات والترتيب والعرض الحالي. استبعاد الشركات له الأولوية على التضمين.",
                )}
              </p>
              <CustomerSelectionTable
                label={t("Include customers", "تضمين العملاء")}
                customers={directory.customers}
                value={draft.content.include || []}
                onChange={(include) =>
                  setDraft({ ...draft, content: { ...draft.content, include } })
                }
                t={t}
              />
              <CustomerSelectionTable
                label={t("Exclude customers", "استبعاد العملاء")}
                customers={directory.customers}
                value={draft.content.exclude || []}
                onChange={(exclude) =>
                  setDraft({ ...draft, content: { ...draft.content, exclude } })
                }
                t={t}
              />
              <button onClick={() => setDraft({ ...draft, content: filters })}>
                {t("Replace with current filters", "استبدال بالمرشحات الحالية")}
              </button>
            </>
          )}
          <div className="dn-dialog-footer">
            <button onClick={requestCancel}>{t("Cancel", "إلغاء")}</button>
            <button
              className="primary"
              disabled={busy || !draft.name.trim()}
              onClick={() =>
                void run(async () => {
                  await api(
                    "dn-tracker/views" + (draft.id ? "/" + draft.id : ""),
                    draft.id ? "PUT" : "POST",
                    {
                      name: draft.name,
                      kind: draft.kind,
                      version: draft.version,
                      content:
                        draft.kind === "GROUP"
                          ? { customers: draft.customers }
                          : draft.content,
                    },
                  );
                  setDraft(null);
                })
              }
            >
              {t("Save", "حفظ")}
            </button>
          </div>
        </div>
      )}
      {confirm && (
        <div className="dn-inline-confirm" role="alertdialog" aria-modal="true">
          <div>
            <h3>
              {confirm.kind === "DELETE"
                ? t("Delete saved item?", "حذف العنصر المحفوظ؟")
                : t(
                    "Discard unsaved changes?",
                    "تجاهل التغييرات غير المحفوظة؟",
                  )}
            </h3>
            <p>
              {confirm.kind === "DELETE"
                ? t(
                    "This shared item will be removed.",
                    "سيتم حذف هذا العنصر المشترك.",
                  )
                : t("Your edits have not been saved.", "لم يتم حفظ تعديلاتك.")}
            </p>
            <div className="actions">
              <button onClick={() => setConfirm(null)}>
                {t("Cancel", "إلغاء")}
              </button>
              <button
                className="danger"
                onClick={() => {
                  const pending = confirm;
                  setConfirm(null);
                  if (pending.kind === "CLOSE") close();
                  else if (pending.kind === "SWITCH") {
                    setDraft(null);
                    setTab(pending.tab);
                  } else if (pending.kind === "CANCEL") setDraft(null);
                  else
                    void run(async () => {
                      await api(
                        "dn-tracker/views/" + pending.view.id,
                        "DELETE",
                        { version: pending.view.version },
                      );
                    });
                }}
              >
                {confirm.kind === "DELETE"
                  ? t("Delete", "حذف")
                  : t("Discard", "تجاهل")}
              </button>
            </div>
          </div>
        </div>
      )}
    </DNDialog>
  );
}
