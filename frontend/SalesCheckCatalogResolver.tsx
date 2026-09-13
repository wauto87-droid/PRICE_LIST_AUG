"use client";
import { useEffect, useId, useRef, useState } from "react";
import { api, type Translate } from "./api";
import { nextCatalogResultHighlight } from "./catalog-result-navigation";

export default function SalesCheckCatalogResolver({
  t,
  reportId,
  row,
  identicalCount,
  onClose,
  onSuccess,
}: {
  t: Translate;
  reportId: string;
  row: any;
  identicalCount: number;
  onClose: () => void;
  onSuccess: (updatedCount: number, matchedPart: string) => void;
}) {
  const sourcePart = String(row.source_part || "").trim();
  const sourceDesc = String(row.description || "").trim();
  const [query, setQuery] = useState(sourcePart || sourceDesc);
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [scope, setScope] = useState<"ROW" | "ALL_IDENTICAL">("ROW");
  const [remember, setRemember] = useState(true);
  const [highlighted, setHighlighted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listId = useId();
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    resultRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [highlighted, results]);

  useEffect(() => {
    if (selected || !query.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void api("search?q=" + encodeURIComponent(query.trim()))
        .then((items) => {
          if (!active) return;
          setResults(items);
          setHighlighted(0);
          setError("");
        })
        .catch((err) => {
          if (active) setError((err as Error).message);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, selected]);

  const confirmMapping = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res: any = await api(`sales-price-checks/${reportId}/map-row`, "POST", {
        rowId: row.id,
        productId: selected.id,
        scope,
        remember,
      });
      onSuccess(res.updatedCount || 1, res.matchedPart || selected.partNumber);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const previewDiscount = () => {
    if (
      !selected ||
      row.sales_price === null ||
      row.sales_price === undefined ||
      row.sales_price === ""
    )
      return null;
    const list = Number(selected.masterExcl);
    const sale = Number(row.sales_price);
    if (!list || isNaN(list) || isNaN(sale)) return null;
    return ((list - sale) / list) * 100;
  };

  const discountVal = previewDiscount();

  return (
    <div
      className="sales-check-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sales-check-modal" role="dialog" aria-modal="true">
        <div className="sales-check-modal-head">
          <h3>
            {t("Map to catalog product", "ربط الصنف بالكتالوج")}
            {sourcePart && (
              <span style={{ opacity: 0.7, marginInlineStart: "6px" }}>
                · {sourcePart}
              </span>
            )}
          </h3>
          <button
            type="button"
            className="sales-check-modal-close"
            onClick={onClose}
            aria-label={t("Close", "إغلاق")}
          >
            ×
          </button>
        </div>

        <div className="sales-check-modal-body">
          {!selected ? (
            <div className="sales-check-search-wrap">
              <label>
                {t(
                  "Search catalog by part number or description",
                  "ابحث في الكتالوج برقم الصنف أو الوصف",
                )}
                <input
                  autoFocus
                  className="sales-check-search-input"
                  value={query}
                  role="combobox"
                  aria-controls={listId}
                  aria-expanded={!!results.length}
                  aria-autocomplete="list"
                  placeholder={t(
                    "e.g. BKD, MCB, Contactor, LC1...",
                    "مثال: BKD, MCB, قاطع...",
                  )}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") onClose();
                    if (!results.length) return;
                    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                      e.preventDefault();
                      setHighlighted((val) =>
                        nextCatalogResultHighlight(val, results.length, e.key),
                      );
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      setSelected(results[highlighted]);
                      setResults([]);
                    }
                  }}
                />
              </label>

              {!!results.length && (
                <div
                  id={listId}
                  role="listbox"
                  className="sales-check-combobox-results"
                >
                  {results.map((item, idx) => (
                    <button
                      type="button"
                      role="option"
                      key={item.id}
                      aria-selected={idx === highlighted}
                      className={`sales-check-combobox-item ${idx === highlighted ? "active" : ""}`}
                      ref={(el) => {
                        resultRefs.current[idx] = el;
                      }}
                      onMouseEnter={() => setHighlighted(idx)}
                      onClick={() => {
                        setSelected(item);
                        setResults([]);
                      }}
                    >
                      <div className="sales-check-combobox-row1">
                        <span className="sales-check-combobox-part">
                          {item.partNumber}
                        </span>
                        <span className="sales-check-combobox-price">
                          SAR {Number(item.masterExcl).toFixed(2)}
                        </span>
                      </div>
                      <span
                        className="sales-check-combobox-desc"
                        title={item.description}
                      >
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {!results.length && query.trim() && (
                <small className="muted" style={{ padding: "4px" }}>
                  {t(
                    "Searching catalog products...",
                    "جارٍ البحث في أصناف الكتالوج...",
                  )}
                </small>
              )}
            </div>
          ) : (
            <>
              <div className="sales-check-preview-box">
                <div className="sales-check-preview-side">
                  <span className="sales-check-preview-label">
                    {t("Source Item", "الصنف المصدر")}
                  </span>
                  <span className="sales-check-preview-part">
                    {sourcePart || "—"}
                  </span>
                  <span className="sales-check-preview-price">
                    {t("Sales Price", "سعر البيع")}: SAR{" "}
                    {Number(row.sales_price || 0).toFixed(2)}
                  </span>
                </div>

                <div className="sales-check-preview-arrow" aria-hidden="true">
                  ➔
                </div>

                <div className="sales-check-preview-side">
                  <span className="sales-check-preview-label">
                    {t("Catalog Product", "صنف الكتالوج")}
                  </span>
                  <span className="sales-check-preview-part">
                    {selected.partNumber}
                  </span>
                  <span className="sales-check-preview-price">
                    {t("List Price", "سعر القائمة")}: SAR{" "}
                    {Number(selected.masterExcl).toFixed(2)}
                  </span>
                </div>

                {discountVal !== null && (
                  <div className="sales-check-discount-calc">
                    <span>{t("New Discount %", "نسبة الخصم الجديدة")}:</span>
                    <strong>
                      {discountVal >= 0
                        ? `${discountVal.toFixed(2)}%`
                        : `+${Math.abs(discountVal).toFixed(2)}% ${t("Markup", "زيادة")}`}
                    </strong>
                  </div>
                )}
              </div>

              <div className="sales-check-options-box">
                <label className="sales-check-radio-label">
                  <input
                    type="radio"
                    name="mapping-scope"
                    checked={scope === "ROW"}
                    onChange={() => setScope("ROW")}
                  />
                  <span>
                    {t("Map this row only", "ربط هذا الصف فقط")} (#
                    {row.row_number})
                  </span>
                </label>

                {sourcePart && identicalCount > 1 && (
                  <label className="sales-check-radio-label">
                    <input
                      type="radio"
                      name="mapping-scope"
                      checked={scope === "ALL_IDENTICAL"}
                      onChange={() => setScope("ALL_IDENTICAL")}
                    />
                    <span>
                      {t(
                        `Map all ${identicalCount} identical rows with source part "${sourcePart}"`,
                        `ربط جميع الصفوف المتطابقة (${identicalCount}) التي تحمل الصنف "${sourcePart}"`,
                      )}
                    </span>
                  </label>
                )}

                {sourcePart && (
                  <label className="sales-check-remember-label">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    <span>
                      {t(
                        "Remember this external code for future price checks and delivery imports (Saved Alias)",
                        "تذكر هذا الرمز الخارجي لجميع الفحوصات واستيرادات التسليم المستقبلية (مطابقة محفوظة)",
                      )}
                    </span>
                  </label>
                )}
              </div>
            </>
          )}

          {error && <div className="notice error">{error}</div>}
        </div>

        <div className="sales-check-modal-footer">
          {selected ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                {t("Change selection", "تغيير الاختيار")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={confirmMapping}
              >
                {busy
                  ? t("Mapping...", "جارٍ الربط...")
                  : t("Confirm Mapping", "تأكيد الربط")}
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose} disabled={busy}>
              {t("Cancel", "إلغاء")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
