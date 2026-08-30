"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import ProductEditor, { blankProduct } from "./ProductEditor";
import { showConfirm } from "./confirm";

export default function ReusableCustomItems({ t }: { t: Translate }) {
  const [items, setItems] = useState<any[]>([]),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("ACTIVE"),
    [edit, setEdit] = useState<any>(null),
    [convert, setConvert] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = async () => {
    try {
      setItems(
        await api(
          `reusable-custom-items?admin=1&q=${encodeURIComponent(query)}&status=${status}`,
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [status]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const productInitial = (item: any) => ({
    ...blankProduct,
    partNumber: item.reference || "",
    description: item.description,
    unit: item.unit,
    method: "LIST_DISCOUNT",
    listPrice: String(item.suggested_unit_price),
    baseDiscount: String(item.suggested_discount),
    levels: [
      {
        code: "END_CUSTOMER",
        active: true,
        method: "LIST_DISCOUNT",
        listPrice: String(item.suggested_unit_price),
        baseDiscount: String(item.suggested_discount),
        markup: "0",
        fixedPrice: "0",
      },
    ],
    defaultLevel: "END_CUSTOMER",
  });
  return (
    <div className="reusable-admin">
      <div className="actions wrap">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(
            "Search reference or description",
            "بحث بالمرجع أو الوصف",
          )}
        />
        <button onClick={() => void load()}>{t("Search", "بحث")}</button>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ACTIVE">{t("Active", "نشط")}</option>
          <option value="CONVERTED">{t("Converted", "تم تحويله")}</option>
          <option value="ALL">{t("All", "الكل")}</option>
        </select>
      </div>
      <p className="muted">
        {t(
          "These are quotation-only reusable items. They are not catalog products until an Admin completes Add to Price List.",
          "هذه أصناف قابلة لإعادة الاستخدام في عروض الأسعار فقط، وليست منتجات حتى يكمل المدير إضافتها إلى قائمة الأسعار.",
        )}
      </p>
      {error && <div className="notice error">{error}</div>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("Reference", "المرجع")}</th>
              <th>{t("Description", "الوصف")}</th>
              <th>{t("Unit", "الوحدة")}</th>
              <th>{t("Suggested price", "السعر المقترح")}</th>
              <th>{t("Discount", "الخصم")}</th>
              <th>{t("Uses", "الاستخدام")}</th>
              <th>{t("Status", "الحالة")}</th>
              <th>{t("Actions", "الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.reference || "—"}</td>
                <td>{item.description}</td>
                <td>{item.unit}</td>
                <td>{item.suggested_unit_price}</td>
                <td>{item.suggested_discount}%</td>
                <td>
                  {item.usage_count}
                  <small>
                    {item.last_used_at
                      ? new Date(item.last_used_at).toLocaleDateString()
                      : ""}
                  </small>
                </td>
                <td>
                  <span className="pill">
                    {item.status}
                    {item.product_part ? ` · ${item.product_part}` : ""}
                  </span>
                </td>
                <td>
                  <div className="actions">
                    {item.status === "ACTIVE" && (
                      <>
                        <button
                          onClick={() =>
                            setEdit({
                              ...item,
                              suggestedUnitPrice: item.suggested_unit_price,
                              suggestedDiscount: item.suggested_discount,
                            })
                          }
                        >
                          {t("Edit", "تعديل")}
                        </button>
                        <button
                          className="primary"
                          onClick={() => setConvert(item)}
                        >
                          {t("Add to Price List", "إضافة إلى قائمة الأسعار")}
                        </button>
                      </>
                    )}
                    <button
                      className="danger"
                      onClick={() =>
                        void showConfirm(
                          t(
                            "Delete this reusable item? Existing quotations will remain unchanged.",
                            "حذف هذا الصنف المحفوظ؟ ستبقى عروض الأسعار الحالية بدون تغيير.",
                          ),
                        ).then((ok) => {
                          if (ok)
                            return run(async () => {
                              await api(
                                `reusable-custom-items/${item.id}`,
                                "DELETE",
                              );
                            });
                        })
                      }
                    >
                      {t("Delete", "حذف")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="modal-backdrop">
          <div className="card modal-card">
            <h3>{t("Edit reusable item", "تعديل الصنف المحفوظ")}</h3>
            <div className="form-grid">
              {[
                ["reference", "Reference", "المرجع"],
                ["description", "Description", "الوصف"],
                ["unit", "Unit", "الوحدة"],
                [
                  "suggestedUnitPrice",
                  "Suggested unit price excl. VAT",
                  "سعر الوحدة المقترح قبل الضريبة",
                ],
                [
                  "suggestedDiscount",
                  "Suggested discount %",
                  "الخصم المقترح %",
                ],
              ].map(([key, en, ar]) => (
                <label key={key}>
                  {t(en, ar)}
                  <input
                    type={key.startsWith("suggested") ? "number" : "text"}
                    value={edit[key]}
                    onChange={(e) =>
                      setEdit({ ...edit, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api(`reusable-custom-items/${edit.id}`, "PUT", {
                      reference: edit.reference,
                      description: edit.description,
                      unit: edit.unit,
                      suggestedUnitPrice: String(edit.suggestedUnitPrice),
                      suggestedDiscount: String(edit.suggestedDiscount),
                      version: edit.version,
                    });
                    setEdit(null);
                  })
                }
              >
                {t("Save", "حفظ")}
              </button>
              <button onClick={() => setEdit(null)}>
                {t("Cancel", "إلغاء")}
              </button>
            </div>
          </div>
        </div>
      )}
      {convert && (
        <div className="modal-backdrop">
          <ProductEditor
            t={t}
            initial={productInitial(convert)}
            actionBusy={busy}
            onClose={() => setConvert(null)}
            onSave={async (product) =>
              run(async () => {
                await api(
                  `reusable-custom-items/${convert.id}/convert`,
                  "POST",
                  { version: convert.version, product },
                );
                setConvert(null);
              })
            }
          />
        </div>
      )}
    </div>
  );
}
