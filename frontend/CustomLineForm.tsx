"use client";
import { useEffect, useState } from "react";
import { calculateCustom, customLineInput } from "@/backend/pricing/engine";
import type { Translate } from "./api";
import { api } from "./api";
import { wheelSafeNumberInputProps } from "./number-input";
import { humanizeCustomLineError } from "./custom-line-errors";
const blank = (partNumber = "") => ({
  partNumber,
  description: "",
  unit: "pcs",
  quantity: "1",
  unitPriceExcl: "",
  discount: "0",
  reusableItemId: undefined as string | undefined,
});
export default function CustomLineForm({
  t,
  vat,
  onAdd,
  suggestedPart = "",
}: {
  t: Translate;
  vat: string;
  onAdd: (line: any) => void;
  suggestedPart?: string;
}) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(blank()),
    [error, setError] = useState(""),
    [savedItems, setSavedItems] = useState<any[]>([]),
    [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!open && suggestedPart.trim())
      setValue((current) => ({ ...current, partNumber: suggestedPart.trim() }));
  }, [suggestedPart, open]);
  useEffect(() => {
    if (!open) return;
    const queries = [value.partNumber.trim(), value.description.trim()].filter(
      (query, index, all) => query && all.indexOf(query) === index,
    );
    const timer = setTimeout(
      () =>
        Promise.all(
          (queries.length ? queries : [""]).map((query) =>
            api("reusable-custom-items?q=" + encodeURIComponent(query)),
          ),
        )
          .then((groups) =>
            setSavedItems([
              ...new Map(
                groups.flat().map((item: any) => [item.id, item]),
              ).values(),
            ]),
          )
          .catch(() => setSavedItems([])),
      250,
    );
    return () => clearTimeout(timer);
  }, [open, value.partNumber, value.description]);
  function useSaved(item: any) {
    setValue({
      partNumber: item.reference || "",
      description: item.description,
      unit: item.unit,
      quantity: "1",
      unitPriceExcl: String(item.suggestedUnitPrice),
      discount: String(item.suggestedDiscount),
      reusableItemId: item.id,
    });
    setError("");
  }
  async function add() {
    try {
      const reference = value.partNumber.trim();
      if (reference) {
        setChecking(true);
        const matches: any[] = await api(
          "search?q=" + encodeURIComponent(reference),
        );
        const exact = matches.find(
          (item) => String(item.partNumber ?? "").trim().toUpperCase() ===
            reference.toUpperCase(),
        );
        if (exact)
          throw new Error(
            `Part reference matches catalog item ${exact.partNumber}. Use the catalog item instead`,
          );
      }
      const input = customLineInput.parse({ type: "CUSTOM", ...value });
      onAdd({
        source: "CUSTOM",
        partNumber: input.partNumber || "CUSTOM",
        description: input.description,
        unit: input.unit,
        quantityPrecision: 6,
        input,
        price: calculateCustom(input, vat),
        pending: false,
      });
      setValue(blank());
      setError("");
      setOpen(false);
    } catch (reason) {
      setError(humanizeCustomLineError((reason as Error).message));
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="custom-line-entry">
      <button
        type="button"
        className="custom-line-toggle"
        onClick={() => setOpen((current) => !current)}
      >
        + {t("Add custom item", "إضافة صنف مخصص")}
      </button>
      {open && (
        <div className="custom-line-form">
          <div className="custom-line-head">
            <div>
              <span className="eyebrow">
                {t("QUOTATION-ONLY ITEM", "صنف لعرض السعر فقط")}
              </span>
              <p>
                {t(
                  "This item will not be added to the product catalog.",
                  "لن تتم إضافة هذا الصنف إلى قائمة المنتجات.",
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t("Close", "إغلاق")}
            >
              ×
            </button>
          </div>
          {!!savedItems.length && (
            <div className="reusable-custom-results">
              <strong>
                {t("Reusable custom items", "الأصناف المخصصة المحفوظة")}
              </strong>
              {savedItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => useSaved(item)}
                >
                  <span>
                    {item.reference || t("No reference", "بدون مرجع")} ·{" "}
                    {item.description}
                  </span>
                  <small>
                    {item.suggestedUnitPrice} · {item.suggestedDiscount}%
                  </small>
                  <b>{t("Use existing item", "استخدام الصنف الموجود")}</b>
                </button>
              ))}
            </div>
          )}
          <div className="form-grid custom-line-fields">
            <label>
              {t("Part / reference (optional)", "الصنف / المرجع (اختياري)")}
              <input
                value={value.partNumber}
                maxLength={100}
                onChange={(e) =>
                  setValue({ ...value, partNumber: e.target.value })
                }
              />
            </label>
            <label className="custom-description">
              {t("Description", "الوصف")}
              <input
                value={value.description}
                maxLength={1000}
                onChange={(e) =>
                  setValue({ ...value, description: e.target.value })
                }
              />
            </label>
            <label>
              {t("Quantity", "الكمية")}
              <input
                type="number"
                min="0.000001"
                step="any"
                {...wheelSafeNumberInputProps}
                value={value.quantity}
                onChange={(e) =>
                  setValue({ ...value, quantity: e.target.value })
                }
              />
            </label>
            <label>
              {t("Unit", "الوحدة")}
              <input
                value={value.unit}
                maxLength={20}
                onChange={(e) => setValue({ ...value, unit: e.target.value })}
              />
            </label>
            <label>
              {t("Unit price excl. VAT", "سعر الوحدة قبل الضريبة")}
              <input
                type="number"
                min="0"
                step="0.01"
                {...wheelSafeNumberInputProps}
                value={value.unitPriceExcl}
                onChange={(e) =>
                  setValue({ ...value, unitPriceExcl: e.target.value })
                }
              />
            </label>
            <label>
              {t("Discount % (optional)", "الخصم % (اختياري)")}
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                {...wheelSafeNumberInputProps}
                value={value.discount}
                onChange={(e) =>
                  setValue({ ...value, discount: e.target.value })
                }
              />
            </label>
          </div>
          <p className="muted">
            {t(
              `VAT ${vat}% is calculated automatically.`,
              `سيتم احتساب ضريبة ${vat}% تلقائياً.`,
            )}
          </p>
          {error && <div className="notice error">{error}</div>}
          <button
            type="button"
            className="primary"
            disabled={checking}
            onClick={() => void add()}
          >
            {t("Add to quotation", "إضافة إلى عرض السعر")}
          </button>
        </div>
      )}
    </div>
  );
}
