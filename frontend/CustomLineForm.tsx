"use client";
import { useEffect, useId, useState } from "react";
import { calculateCustom, customLineInput } from "@/backend/pricing/engine";
import type { Translate } from "./api";
import { api } from "./api";
import {
  discountSafeNumberInputProps,
  wheelSafeNumberInputProps,
} from "./number-input";
import { humanizeCustomLineError } from "./custom-line-errors";
import {
  formatReusableDiscount,
  formatReusablePrice,
  moveReusableIndex,
} from "./reusable-search";
const blank = (partNumber = "") => ({
  partNumber,
  description: "",
  unit: "pcs",
  quantity: "1",
  unitPriceExcl: "",
  discount: "",
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
  const searchId = useId(),
    resultsId = searchId + "-results";
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(blank()),
    [error, setError] = useState(""),
    [savedItems, setSavedItems] = useState<any[]>([]),
    [checking, setChecking] = useState(false),
    [searchQuery, setSearchQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [activeResult, setActiveResult] = useState(-1),
    [duplicateMatch, setDuplicateMatch] = useState<any>(null);
  useEffect(() => {
    if (!open && suggestedPart.trim())
      setValue((current) => ({ ...current, partNumber: suggestedPart.trim() }));
  }, [suggestedPart, open]);
  useEffect(() => {
    const query = searchQuery.trim();
    if (!open || !query) {
      setSavedItems([]);
      setSearching(false);
      setActiveResult(-1);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(
      () =>
        api("reusable-custom-items?q=" + encodeURIComponent(query))
          .then((items) => {
            if (!cancelled) {
              setSavedItems(items);
              setActiveResult(-1);
            }
          })
          .catch(() => {
            if (!cancelled) setSavedItems([]);
          })
          .finally(() => {
            if (!cancelled) setSearching(false);
          }),
      250,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, searchQuery]);
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
    setDuplicateMatch(null);
    setSearchQuery("");
    setSavedItems([]);
    setActiveResult(-1);
  }
  function closeForm() {
    setOpen(false);
    setSearchQuery("");
    setSavedItems([]);
    setActiveResult(-1);
    setDuplicateMatch(null);
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
          (item) =>
            String(item.partNumber ?? "")
              .trim()
              .toUpperCase() === reference.toUpperCase(),
        );
        if (exact)
          throw new Error(
            `Part reference matches catalog item ${exact.partNumber}. Use the catalog item instead`,
          );
      }
      if (!value.reusableItemId) {
        const resolved: any = await api(
          "reusable-custom-items/resolve",
          "POST",
          { reference, description: value.description },
        );
        if (resolved.match) {
          setDuplicateMatch(resolved.match);
          return;
        }
      }
      const input = customLineInput.parse({
        type: "CUSTOM",
        ...value,
        discount: String(value.discount ?? "").trim() || "0",
        watcherEventId: crypto.randomUUID(),
      });
      void api("price-watcher/cart", "POST", {
        interactionId: input.watcherEventId,
        line: input,
      }).catch(() => undefined);
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
      setSearchQuery("");
      setSavedItems([]);
      setDuplicateMatch(null);
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
        onClick={() => (open ? closeForm() : setOpen(true))}
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
              onClick={closeForm}
              aria-label={t("Close", "إغلاق")}
            >
              ×
            </button>
          </div>
          <div className="reusable-custom-search">
            <label htmlFor={searchId}>
              {t(
                "Search reusable custom items",
                "بحث في الأصناف المخصصة المحفوظة",
              )}
            </label>
            <div className="reusable-search-input">
              <input
                id={searchId}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={!!searchQuery.trim() && !!savedItems.length}
                aria-controls={resultsId}
                aria-activedescendant={
                  activeResult >= 0
                    ? `${searchId}-result-${savedItems[activeResult]?.id}`
                    : undefined
                }
                value={searchQuery}
                placeholder={t(
                  "Part number or description",
                  "رقم الصنف أو الوصف",
                )}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setDuplicateMatch(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveResult((current) =>
                      moveReusableIndex(
                        current,
                        e.key === "ArrowDown" ? 1 : -1,
                        savedItems.length,
                      ),
                    );
                  } else if (e.key === "Enter" && activeResult >= 0) {
                    e.preventDefault();
                    useSaved(savedItems[activeResult]);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setSearchQuery("");
                    setSavedItems([]);
                    setActiveResult(-1);
                  }
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label={t(
                    "Clear reusable search",
                    "مسح بحث الأصناف المحفوظة",
                  )}
                  onClick={() => {
                    setSearchQuery("");
                    setSavedItems([]);
                    setActiveResult(-1);
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {searching && (
              <small className="muted">{t("Searching…", "جارٍ البحث…")}</small>
            )}
            {!!searchQuery.trim() && !searching && !!savedItems.length && (
              <div
                id={resultsId}
                className="reusable-custom-results"
                role="listbox"
              >
                {savedItems.map((item, index) => (
                  <button
                    id={`${searchId}-result-${item.id}`}
                    role="option"
                    aria-selected={index === activeResult}
                    className={index === activeResult ? "active" : ""}
                    type="button"
                    key={item.id}
                    onMouseEnter={() => setActiveResult(index)}
                    onClick={() => useSaved(item)}
                  >
                    <span
                      title={`${item.reference || ""} · ${item.description}`}
                    >
                      <strong>
                        {item.reference || t("No reference", "بدون مرجع")}
                      </strong>
                      <em>{item.description}</em>
                    </span>
                    <small>
                      {formatReusablePrice(item.suggestedUnitPrice)} ·{" "}
                      {formatReusableDiscount(item.suggestedDiscount)}%
                    </small>
                    <b>{t("Use", "استخدام")}</b>
                  </button>
                ))}
              </div>
            )}
            {!!searchQuery.trim() && !searching && !savedItems.length && (
              <small className="muted">
                {t(
                  "No reusable items found.",
                  "لم يتم العثور على أصناف محفوظة.",
                )}
              </small>
            )}
          </div>
          {duplicateMatch && (
            <div className="reusable-duplicate-warning" role="alert">
              <span>
                <strong>
                  {t(
                    "This item already exists in the reusable list.",
                    "هذا الصنف موجود مسبقاً في القائمة المحفوظة.",
                  )}
                </strong>
                <small>
                  {duplicateMatch.reference || t("No reference", "بدون مرجع")} ·{" "}
                  {duplicateMatch.description}
                </small>
              </span>
              <button type="button" onClick={() => useSaved(duplicateMatch)}>
                {t("Use existing item", "استخدام الصنف الموجود")}
              </button>
            </div>
          )}
          <div className="form-grid custom-line-fields">
            <label>
              {t("Part / reference (optional)", "الصنف / المرجع (اختياري)")}
              <input
                value={value.partNumber}
                maxLength={100}
                onChange={(e) => {
                  setValue({ ...value, partNumber: e.target.value });
                  setDuplicateMatch(null);
                }}
              />
            </label>
            <label className="custom-description">
              {t("Description", "الوصف")}
              <input
                value={value.description}
                maxLength={1000}
                onChange={(e) => {
                  setValue({ ...value, description: e.target.value });
                  setDuplicateMatch(null);
                }}
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
                {...discountSafeNumberInputProps}
                value={
                  Number(String(value.discount ?? "").trim() || "0") === 0
                    ? ""
                    : value.discount
                }
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
