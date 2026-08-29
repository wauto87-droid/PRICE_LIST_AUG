"use client";
import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { api, type Translate } from "./api";
import {
  buildLookupLineRequest,
  previewLookupPrice,
} from "./lookup-pricing";
import { levelLabel, visibleLevels } from "./levels";
import {
  activeSuggestionIndex,
  clampHighlightedIndex,
  moveHighlightedIndex,
  suggestionOptionId,
  topSuggestions,
} from "./lookup-suggestions";
import {
  isSelectedLookupQuery,
  normalizeLookupQuery,
  relatedLookupResults,
} from "./lookup-view";
export default function Lookup({
  t,
  onAdd,
  user,
  settings,
  online,
  showAside = true,
}: {
  t: Translate;
  onAdd: (line: any) => void;
  user: any;
  settings: any;
  online: boolean;
  showAside?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [sellingLevel, setSellingLevel] = useState("END_CUSTOMER"),
    [categoryFilter, setCategoryFilter] = useState(""),
    [discount, setDiscount] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [price, setPrice] = useState<{
      input: { sellingLevel: string; quantity: string; discount: string };
      value: any;
    } | null>(null),
    [error, setError] = useState(""),
    [pricingBusy, setPricingBusy] = useState(false),
    [adding, setAdding] = useState(false),
    [requestBusy, setRequestBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [suggestionsOpen, setSuggestionsOpen] = useState(false),
    [showRelatedMatches, setShowRelatedMatches] = useState(false),
    [highlightedIndex, setHighlightedIndex] = useState(-1),
    [stamp, setStamp] = useState(""),
    [requestDialogOpen, setRequestDialogOpen] = useState(false),
    [discountRequestReason, setDiscountRequestReason] = useState(""),
    [requestFeedback, setRequestFeedback] = useState("");
  const searchRef = useRef<HTMLInputElement>(null),
    discountRef = useRef<HTMLInputElement>(null),
    comboboxId = useRef(`lookup-combobox-${Math.random().toString(36).slice(2)}`),
    pricingGeneration = useRef(0),
    searchGeneration = useRef(0);
  useEffect(() => {
    if (!online && !settings.allowOfflineCache) {
      setSelected(null);
      setResults([]);
      setSuggestionsOpen(false);
      setHighlightedIndex(-1);
    }
  }, [online, settings.allowOfflineCache]);
  useEffect(() => {
    const current = ++searchGeneration.current;
    const timer = setTimeout(async () => {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        setResults([]);
        setSuggestionsOpen(false);
        setHighlightedIndex(-1);
        setShowRelatedMatches(false);
        return;
      }
      if (isSelectedLookupQuery(trimmedQuery, selected?.partNumber)) {
        setSearching(false);
        setSuggestionsOpen(false);
        setHighlightedIndex(-1);
        return;
      }
      setSearching(true);
      setError("");
      try {
        let rows: any[] = [];
        if (online) {
          rows = await api("search?q=" + encodeURIComponent(trimmedQuery));
          setStamp(new Date().toISOString());
          if (settings.allowOfflineCache) {
            const safe = rows.map(
              ({
                id,
                partNumber,
                description,
                brand,
                category,
                unit,
                quantityPrecision,
                masterExcl,
                masterIncl,
                vat,
                version,
                sellingLevels,
                defaultLevel,
              }: any) => ({
                id,
                partNumber,
                description,
                brand,
                category,
                unit,
                quantityPrecision,
                masterExcl,
                masterIncl,
                vat,
                version,
                defaultLevel,
                sellingLevels: sellingLevels?.map((l: any) => ({
                  code: l.code,
                  masterExcl: l.masterExcl,
                  masterIncl: l.masterIncl,
                })),
              }),
            );
            localStorage.setItem(
              "amt-products-" + user.id,
              JSON.stringify({ rows: safe, at: new Date().toISOString() }),
            );
          }
        } else if (settings.allowOfflineCache) {
          const cache = JSON.parse(
            localStorage.getItem("amt-products-" + user.id) || "{}",
          );
          rows = (cache.rows || []).filter((p: any) =>
            (p.partNumber + " " + p.description)
              .toLowerCase()
              .includes(trimmedQuery.toLowerCase()),
          );
          setStamp(cache.at || "");
        }
        if (current === searchGeneration.current) {
          setResults(rows);
          setSuggestionsOpen(
            rows.length > 0 && !isSelectedLookupQuery(trimmedQuery, selected?.partNumber),
          );
        }
      } catch (e) {
        if (current === searchGeneration.current)
          setError((e as Error).message);
      } finally {
        if (current === searchGeneration.current) setSearching(false);
      }
    }, 90);
    return () => clearTimeout(timer);
  }, [query, online, selected?.partNumber, settings.allowOfflineCache, user.id]);
  useEffect(() => {
    if (!selected) return;
    setError("");
    setRequestDialogOpen(false);
    setDiscountRequestReason("");
    setRequestFeedback("");
  }, [selected?.id, sellingLevel, quantity, discount]);
  useEffect(() => {
    if (!selected || !online) {
      setPricingBusy(false);
      return;
    }
    const current = ++pricingGeneration.current;
    setPricingBusy(true);
    setPrice(null);
    api("pricing", "POST", {
      productId: selected.id,
      sellingLevel: selected.defaultLevel ?? "END_CUSTOMER",
      quantity: "1",
      discount: "0",
      override: false,
      reason: "",
    })
      .then((p) => {
        if (current !== pricingGeneration.current) return;
        setPrice({
          input: {
            sellingLevel: selected.defaultLevel ?? "END_CUSTOMER",
            quantity: "1",
            discount: "0",
          },
          value: p,
        });
        setError("");
      })
      .catch((e) => {
        if (current === pricingGeneration.current) setError(e.message);
      })
      .finally(() => {
        if (current === pricingGeneration.current) setPricingBusy(false);
      });
  }, [selected?.id, online]);
  useEffect(() => {
    if (selected) discountRef.current?.focus();
  }, [selected?.id]);
  useEffect(() => {
    setHighlightedIndex((current) =>
      clampHighlightedIndex(current, filteredSuggestions.length),
    );
  }, [categoryFilter, results.length, query]);
  useEffect(() => {
    if (!suggestionsOpen || highlightedIndex < 0) return;
    const node = document.getElementById(
      suggestionOptionId(comboboxId.current, highlightedIndex),
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, suggestionsOpen]);
  function choose(p: any) {
    setSelected(p);
    setQuery(p.partNumber);
    setSellingLevel(p.defaultLevel ?? "END_CUSTOMER");
    setQuantity("1");
    setDiscount("");
    setPrice(null);
    setError("");
    setSuggestionsOpen(false);
    setShowRelatedMatches(false);
    setHighlightedIndex(-1);
  }
  function chooseLevel(code: string) {
    if (sellingLevel === code) return;
    setSellingLevel(code);
  }
  async function add() {
    if (!selected || adding) return;
    if (!online && !settings.allowOfflineCache) return;
    let input;
    try {
      input = buildLookupLineRequest(selected.id, sellingLevel as any, quantity, discount);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!online) {
      onAdd({
        productId: selected.id,
        sellingLevel,
        partNumber: selected.partNumber,
        sellingLevels: visibleLevels(selected),
        description: selected.description,
        unit: selected.unit,
        quantityPrecision: selected.quantityPrecision,
        input,
        price: previewLookupPrice(selected, user, {
          sellingLevel: input.sellingLevel,
          quantity: input.quantity,
          discount: input.discount,
          override: false,
          reason: "",
        }),
        offline: true,
      });
      setSelected(null);
      setQuery("");
      setResults([]);
      setSuggestionsOpen(false);
      setShowRelatedMatches(false);
      setHighlightedIndex(-1);
      setPrice(null);
      searchRef.current?.focus();
      return;
    }
    setAdding(true);
    setError("");
    try {
      const validated = await api("pricing", "POST", input);
      setPrice({
        input: {
          sellingLevel: input.sellingLevel,
          quantity: input.quantity,
          discount: input.discount,
        },
        value: validated,
      });
      onAdd({
        productId: selected.id,
        sellingLevel,
        partNumber: selected.partNumber,
        sellingLevels: visibleLevels(selected),
        description: selected.description,
        unit: selected.unit,
        quantityPrecision: selected.quantityPrecision,
        input,
        price: validated,
        offline: false,
      });
    } catch (e) {
      setError((e as Error).message);
      return;
    } finally {
      setAdding(false);
    }
    setSelected(null);
    setQuery("");
    setResults([]);
    setSuggestionsOpen(false);
    setShowRelatedMatches(false);
    setHighlightedIndex(-1);
    setPrice(null);
    searchRef.current?.focus();
  }
  async function submitDiscountRequest() {
    if (!selected) return;
    let input;
    try {
      input = buildLookupLineRequest(selected.id, sellingLevel as any, quantity, discount);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (!discountRequestReason.trim()) {
      setError(
        t(
          "A reason is required before sending a discount request.",
          "سبب الطلب مطلوب قبل إرسال طلب الخصم.",
        ),
      );
      return;
    }
    setRequestBusy(true);
    try {
      const request = await api("discount-requests", "POST", {
        productId: input.productId,
        sellingLevel: input.sellingLevel,
        quantity: input.quantity,
        discount: input.discount,
        reason: discountRequestReason,
      });
      setRequestDialogOpen(false);
      setDiscountRequestReason("");
      setRequestFeedback(
        t(
          `Discount request sent for ${request.partNumber}. Requested SAR ${request.requestedFinalPrice} against protected SAR ${request.protectedPrice}.`,
          `تم إرسال طلب خصم للصنف ${request.partNumber}. السعر المطلوب ${request.requestedFinalPrice} ر.س مقابل السعر المحمي ${request.protectedPrice} ر.س.`,
        ),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRequestBusy(false);
    }
  }
  const selectedPrice =
    selected && visibleLevels(selected).find((l) => l.code === sellingLevel);
  const normalizedSelectedPart = normalizeLookupQuery(selected?.partNumber);
  const filteredResults = categoryFilter
    ? results.filter(
        (product) => (product.category || "UNCATEGORIZED") === categoryFilter,
      )
    : results;
  const visibleResults = relatedLookupResults(filteredResults, selected);
  const filteredSuggestions = topSuggestions(filteredResults, 8);
  const relatedMatchesVisible = !selected || showRelatedMatches;
  const hasRelatedMatches = !!selected && visibleResults.length > 0;
  const resolvedHighlightedIndex = activeSuggestionIndex(
    highlightedIndex,
    filteredSuggestions.length,
  );
  const resultCategories = [...new Set(results.map((p) => p.category || ""))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const activeSuggestion =
    resolvedHighlightedIndex >= 0
      ? filteredSuggestions[resolvedHighlightedIndex]
      : null;
  let displayPrice = price?.value ?? null;
  let previewOnly = false;
  let previewError = "";
  try {
    if (selected) {
      const input = buildLookupLineRequest(
        selected.id,
        sellingLevel as any,
        quantity,
        discount,
      );
      const matchesValidated =
        price?.input &&
        price.input.sellingLevel === input.sellingLevel &&
        price.input.quantity === input.quantity &&
        price.input.discount === input.discount;
      if (!matchesValidated) {
        displayPrice = previewLookupPrice(selected, user, {
          sellingLevel: input.sellingLevel,
          quantity: input.quantity,
          discount: input.discount,
          override: false,
          reason: "",
        });
        previewOnly = true;
      }
    }
  } catch (e) {
    previewError = (e as Error).message;
    displayPrice = null;
  }
  const activeError = previewError || error;
  const estimate = selectedPrice
    ? new Decimal(selectedPrice.masterExcl)
        .mul(
          new Decimal(1).sub(
            new Decimal(/^\d+(\.\d*)?$/.test(discount) ? discount || "0" : "0").div(
              100,
            ),
          ),
        )
        .toFixed(2)
    : "0.00";
  return (
    <div className={"lookup-layout" + (showAside ? "" : " lookup-compact")}>
      <section className="card lookup-card">
        <div className="lookup-search-panel">
          <div className="eyebrow">{t("PART LOOKUP", "البحث عن صنف")}</div>
          <div className="lookup-title-row">
            <div>
              <h2>{t("Find the right part fast", "اعثر على الصنف الصحيح بسرعة")}</h2>
              <p>
                {t(
                  "Search by part number, old reference, description, brand, or category.",
                  "ابحث برقم الصنف أو المرجع القديم أو الوصف أو العلامة أو الفئة.",
                )}
              </p>
            </div>
            {!!filteredResults.length && (
              <span className="pill">
                {filteredResults.length} {t("matches", "نتائج")}
              </span>
            )}
          </div>
          <div className="lookup-search-stack">
            <div
              className={
                "search-box lookup-combobox" +
                (suggestionsOpen && filteredSuggestions.length ? " open" : "")
              }
            >
              <span aria-hidden="true">⌕</span>
              <input
                ref={searchRef}
                autoFocus
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestionsOpen && filteredSuggestions.length > 0}
                aria-controls={comboboxId.current}
                aria-activedescendant={
                  suggestionsOpen && resolvedHighlightedIndex >= 0
                    ? suggestionOptionId(comboboxId.current, resolvedHighlightedIndex)
                    : undefined
                }
                aria-label={t(
                  "Search part number or description",
                  "البحث برقم الصنف أو الوصف",
                )}
                placeholder={t(
                  "Search Part No. or Description…",
                  "ابحث برقم الصنف أو الوصف…",
                )}
                value={query}
                onFocus={() => {
                  if (
                    filteredSuggestions.length &&
                    !isSelectedLookupQuery(query, selected?.partNumber)
                  ) {
                    setSuggestionsOpen(true);
                    setHighlightedIndex((current) =>
                      activeSuggestionIndex(current, filteredSuggestions.length),
                    );
                  }
                }}
                onChange={(e) => {
                  const nextQuery = e.target.value;
                  const keepsSelection =
                    !!selected &&
                    normalizeLookupQuery(nextQuery) === normalizedSelectedPart;
                  setQuery(nextQuery);
                  setCategoryFilter("");
                  setShowRelatedMatches(false);
                  setSuggestionsOpen(!!nextQuery.trim() && !keepsSelection);
                  if (selected && !keepsSelection) {
                    setSelected(null);
                    setPrice(null);
                  }
                  setHighlightedIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSuggestionsOpen(filteredSuggestions.length > 0);
                    setHighlightedIndex((current) =>
                      moveHighlightedIndex(
                        activeSuggestionIndex(current, filteredSuggestions.length),
                        "next",
                        filteredSuggestions.length,
                      ),
                    );
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSuggestionsOpen(filteredSuggestions.length > 0);
                    setHighlightedIndex((current) =>
                      moveHighlightedIndex(
                        activeSuggestionIndex(current, filteredSuggestions.length),
                        "previous",
                        filteredSuggestions.length,
                      ),
                    );
                    return;
                  }
                  if (e.key === "Enter") {
                    if (suggestionsOpen && filteredSuggestions.length) {
                      e.preventDefault();
                      choose(
                        filteredSuggestions[
                          activeSuggestionIndex(
                            highlightedIndex,
                            filteredSuggestions.length,
                          )
                        ],
                      );
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSuggestionsOpen(false);
                    setHighlightedIndex(-1);
                  }
                }}
              />
              <kbd>{t("Enter", "إدخال")}</kbd>
            </div>
            <div className="lookup-search-meta">
              <span className="muted">
                {searching
                  ? t("Searching…", "جارٍ البحث…")
                  : query.trim()
                    ? t(
                        "Use Up/Down to move and Enter to choose.",
                        "استخدم أعلى وأسفل للتنقل ثم إدخال للاختيار.",
                      )
                    : t(
                        "Type to see matching parts instantly.",
                        "ابدأ الكتابة لرؤية الأصناف المطابقة فوراً.",
                      )}
              </span>
              {!!visibleResults.length && (
                <span className="lookup-result-count">
                  {visibleResults.length} {t("shown", "معروض")}
                </span>
              )}
            </div>
            {suggestionsOpen && !!filteredSuggestions.length && (
              <div
                id={comboboxId.current}
                className="lookup-suggestions"
                role="listbox"
                aria-label={t("Suggested matching products", "اقتراحات الأصناف المطابقة")}
              >
                {filteredSuggestions.map((p, index) => (
                  <button
                    id={suggestionOptionId(comboboxId.current, index)}
                    type="button"
                    className={
                      "lookup-suggestion" +
                      (resolvedHighlightedIndex === index ? " active" : "") +
                      (selected?.id === p.id ? " chosen" : "")
                    }
                    key={p.id}
                    role="option"
                    aria-selected={resolvedHighlightedIndex === index}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(p);
                    }}
                  >
                    <span className="lookup-suggestion-copy">
                      <strong>{p.partNumber}</strong>
                      <small>{p.description}</small>
                      <small>
                        {[p.brand, p.category].filter(Boolean).join(" · ") ||
                          t("Catalog item", "صنف كتالوج")}
                      </small>
                    </span>
                    <span className="lookup-suggestion-price">
                      {(() => {
                        const level =
                          visibleLevels(p).find(
                            (l) => l.code === (p.defaultLevel ?? "END_CUSTOMER"),
                          ) || visibleLevels(p)[0];
                        return level ? (
                          <>
                            <b>{level.masterExcl}</b>
                            <small>{levelLabel(level.code, t)}</small>
                          </>
                        ) : null;
                      })()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {activeError && (
          <div role="alert" className="notice error">
            {activeError}
          </div>
        )}
        {stamp && !online && (
          <div className="notice">
            {t("Last synced", "آخر مزامنة")}: {new Date(stamp).toLocaleString()}
          </div>
        )}
        {!!results.length && (!selected || showRelatedMatches) && (
          <div className="actions wrap lookup-filters lookup-filter-bar">
            <label className="grow">
              {t("Category filter", "تصفية الفئة")}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">
                  {t("All categories", "كل الفئات")}
                </option>
                {resultCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <div className="lookup-filter-note">
              {t(
                "Filter the current matches without running a new search.",
                "قم بتصفية النتائج الحالية دون تشغيل بحث جديد.",
              )}
            </div>
          </div>
        )}
        {!!visibleResults.length && relatedMatchesVisible && (
          <div className="search-results lookup-results-panel">
            <div className="lookup-results-header">
              <div>
                <div className="eyebrow">{t("MATCHING PARTS", "الأصناف المطابقة")}</div>
                <h3>
                  {selected
                    ? t("Related matches", "نتائج ذات صلة")
                    : t("Choose a product to price", "اختر صنفاً للتسعير")}
                </h3>
              </div>
            </div>
            <div className="result-head tier-result-head">
              <span>{t("Part / description", "الصنف / الوصف")}</span>
              <span>
                {t("Main selling price", "سعر البيع الرئيسي")}
              </span>
            </div>
            {visibleResults.map((p) => (
              <button
                className={
                  "result tier-result" + (selected?.id === p.id ? " selected-result" : "")
                }
                key={p.id}
                onClick={() => choose(p)}
              >
                <span>
                  <strong>{p.partNumber}</strong>
                  <small>{p.description}</small>
                  <small>
                    {[p.brand, p.category].filter(Boolean).join(" · ") ||
                      t("Catalog item", "صنف كتالوج")}
                  </small>
                </span>
                <span className="result-levels">
                  {(() => {
                    const level =
                      visibleLevels(p).find(
                        (l) => l.code === (p.defaultLevel ?? "END_CUSTOMER"),
                      ) || visibleLevels(p)[0];
                    return level ? (
                      <span className="result-level default">
                        <span>{levelLabel(level.code, t)}</span>
                        <b>{level.masterExcl}</b>
                        <small>
                          {t("Incl. VAT", "شامل الضريبة")} {level.masterIncl}
                        </small>
                      </span>
                    ) : null;
                  })()}
                </span>
              </button>
            ))}
          </div>
        )}
        {!selected && !results.length && (
          <div className="empty-state lookup-empty-state">
            <div className="empty-symbol">⌕</div>
            <h2>{t("Start with a part search", "ابدأ بالبحث عن صنف")}</h2>
            <p>
              {t(
                "Type a part number or description to open suggestions, compare matches, and price the selected item.",
                "اكتب رقم الصنف أو الوصف لفتح الاقتراحات ومقارنة النتائج وتسعير الصنف المحدد.",
              )}
            </p>
            <div className="hint-chips">
              <span>{t("Part number", "رقم الصنف")}</span>
              <span>{t("Old reference", "المرجع القديم")}</span>
              <span>{t("Description", "الوصف")}</span>
              <span>{t("Brand", "العلامة التجارية")}</span>
            </div>
          </div>
        )}
        {selected && (
          <>
            <div className="product-heading">
              <div>
                <h2>{selected.partNumber}</h2>
                <p>{selected.description}</p>
              </div>
              <span className="pill">
                {[selected.brand, selected.category]
                  .filter(Boolean)
                  .join(" · ") || t("Catalog item", "صنف كتالوج")}
              </span>
            </div>
            {hasRelatedMatches && (
              <div className="actions wrap">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowRelatedMatches((current) => !current)}
                >
                  {showRelatedMatches
                    ? t("Hide related matches", "إخفاء النتائج ذات الصلة")
                    : t(
                        `Show related matches (${visibleResults.length})`,
                        `عرض النتائج ذات الصلة (${visibleResults.length})`,
                      )}
                </button>
              </div>
            )}
            <div
              className="selling-levels"
              role="group"
              aria-label={t("Price option", "خيار السعر")}
            >
              {visibleLevels(selected).map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={
                    "selling-level" +
                    (sellingLevel === l.code ? " selected" : "")
                  }
                  aria-pressed={sellingLevel === l.code}
                  onClick={() => chooseLevel(l.code)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      chooseLevel(l.code);
                    }
                  }}
                >
                  <span>
                    {levelLabel(l.code, t)} {sellingLevel === l.code ? "✓" : ""}
                  </span>
                  {l.code === (selected.defaultLevel ?? "END_CUSTOMER") && (
                    <small>{t("Main price", "السعر الرئيسي")}</small>
                  )}
                  <strong>{l.masterExcl}</strong>
                  <span>{t("Excl. VAT · SAR", "قبل الضريبة · ر.س")}</span>
                  <small>
                    {t("Incl. VAT", "شامل الضريبة")} {l.masterIncl}
                  </small>
                </button>
              ))}
            </div>
            <div className="field-pair">
              <label>
                {t("DISCOUNT %", "الخصم %")}
                <input
                  ref={discountRef}
                  inputMode="decimal"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={discount}
                  placeholder="0"
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </label>
              <label>
                {t("QUANTITY", "الكمية")} · {selected.unit}
                <input
                  inputMode="decimal"
                  type="number"
                  min={selected.quantityPrecision ? "0.001" : "1"}
                  step={
                    selected.quantityPrecision
                      ? Math.pow(10, -selected.quantityPrecision)
                      : 1
                  }
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") add();
                  }}
                />
              </label>
            </div>
            <div className="final-price">
              <div className="eyebrow">
                {online
                  ? t(
                      previewOnly
                        ? "PREVIEW PRICE — VALIDATED ON ADD"
                        : "FINAL PRICE",
                      previewOnly
                        ? "سعر معاينة — يتم التحقق عند الإضافة"
                        : "السعر النهائي",
                    ) +
                    " · " +
                    levelLabel(sellingLevel, t)
                  : t(
                      "OFFLINE ESTIMATE — NOT VALIDATED",
                      "تقدير دون اتصال — غير معتمد",
                    )}
              </div>
              {displayPrice?.maxDiscount !== undefined && (
                <p className="muted">
                  {t("Salesman limit", "حد المندوب")}:{" "}
                  {displayPrice.maxDiscount}%
                </p>
              )}
              {displayPrice ? (
                <>
                  <div className="price-pair counter-prices">
                    <div>
                      <label>{t("Excl. VAT", "قبل الضريبة")}</label>
                      <strong>{displayPrice.finalExcl}</strong>
                    </div>
                    <div>
                      <label>{t("Incl. VAT", "شامل الضريبة")}</label>
                      <strong>{displayPrice.finalIncl}</strong>
                    </div>
                  </div>
                  {previewOnly && (
                    <p className="muted">
                      {t(
                        "Instant browser preview. The server confirms the protected final price when you add this line.",
                        "معاينة فورية داخل المتصفح. يؤكد الخادم السعر النهائي المحمي عند إضافة هذا البند.",
                      )}
                    </p>
                  )}
                  {displayPrice.minimumReached && (
                    <p className="notice">
                      {t(
                        "Minimum selling price reached",
                        "تم الوصول إلى أقل سعر بيع",
                      )}
                    </p>
                  )}
                  {displayPrice.discountLimited && (
                    <p className="notice">
                      {t(
                        `Discount adjusted to the current allowed limit of ${displayPrice.maxDiscount ?? user.maxDiscount}%.`,
                        `تم تعديل الخصم إلى الحد المسموح الحالي ${displayPrice.maxDiscount ?? user.maxDiscount}%.`,
                      )}
                    </p>
                  )}
                  {displayPrice.overridden && (
                    <p className="notice error">
                      {t(
                        "Authorized minimum-price override",
                        "تجاوز الحد الأدنى المصرح به",
                      )}
                    </p>
                  )}
                  <div className="line-summary">
                    <span>
                      {t("TOTAL EXCL. VAT", "الإجمالي قبل الضريبة")}{" "}
                      <b>SAR {displayPrice.subtotal}</b>
                    </span>
                    <span>
                      VAT {displayPrice.vatRate}% <b>{displayPrice.vatAmount}</b>
                    </span>
                    <span>
                      {t("TOTAL INCL. VAT", "الإجمالي شامل الضريبة")}{" "}
                      <b>SAR {displayPrice.total}</b>
                    </span>
                  </div>
                </>
              ) : (
                <p>
                  {online
                    ? t(
                        pricingBusy
                          ? "Loading base validation…"
                          : "Enter a valid quantity and discount to preview the price.",
                        pricingBusy
                          ? "جارٍ تحميل التحقق الأساسي…"
                          : "أدخل كمية وخصماً صالحين لمعاينة السعر.",
                      )
                    : t(
                        `Offline estimate: SAR ${estimate} excl. VAT. Final price requires online validation.`,
                        `تقدير دون اتصال: ${estimate} ر.س قبل الضريبة. يتطلب السعر النهائي التحقق عبر الإنترنت.`,
                  )}
                </p>
              )}
            </div>
            {requestFeedback && <div className="notice">{requestFeedback}</div>}
            {displayPrice?.minimumReached && (
              <button
                className="link-button"
                onClick={() => {
                  setError("");
                  setRequestFeedback("");
                  setRequestDialogOpen(true);
                }}
              >
                {t("Request discount approval", "طلب اعتماد خصم")}
              </button>
            )}
            <button
              className="primary add-button"
              onClick={add}
              disabled={
                adding ||
                !!previewError ||
                (!online && !settings.allowOfflineCache)
              }
            >
              {t("＋ ADD TO CART", "＋ أضف إلى السلة")}
            </button>
          </>
        )}
      </section>
      {showAside && (
        <aside className="lookup-aside">
          <div className="eyebrow">
            {t("BUILT FOR YOUR COUNTER", "مصمم لخدمة العملاء")}
          </div>
          <h2>{t("Stay in one flow from search to draft.", "ابق في مسار واحد من البحث إلى المسودة.")}</h2>
          <p>
            {t(
              "Pick a product on the left, then review customer details and quotation lines on the right without losing your place.",
              "اختر الصنف من اليسار ثم راجع بيانات العميل وبنود عرض السعر من اليمين دون فقدان مكانك.",
            )}
          </p>
          <ol>
            <li>
              {t(
                "Search by part number, old code, or description",
                "ابحث برقم الصنف أو الرمز القديم أو الوصف",
              )}
            </li>
            <li>{t("Choose the right selling level", "اختر مستوى البيع المناسب")}</li>
            <li>{t("Save the draft with confidence", "احفظ المسودة بثقة")}</li>
          </ol>
          <div className="aside-note">
            {t(
              "Server-side pricing still protects VAT, limits, and minimum-price rules before issuing the final quotation.",
              "لا يزال التسعير على الخادم يحمي الضريبة والحدود وقواعد الحد الأدنى قبل إصدار عرض السعر النهائي.",
            )}
          </div>
        </aside>
      )}
      {requestDialogOpen && selected && displayPrice?.minimumReached && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="section-title">
              <h2>{t("Request discount approval", "طلب اعتماد خصم")}</h2>
              <button
                type="button"
                disabled={requestBusy}
                onClick={() => setRequestDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="notice">
              {selected.partNumber} · {selected.description}
            </div>
            <div className="form-grid">
              <label>
                {t("Selling level", "مستوى البيع")}
                <input value={levelLabel(sellingLevel, t)} readOnly />
              </label>
              <label>
                {t("Quantity", "الكمية")}
                <input value={quantity} readOnly />
              </label>
              <label>
                {t("Requested discount", "الخصم المطلوب")}
                <input value={`${discount || "0"}%`} readOnly />
              </label>
              <label>
                {t("Protected price", "السعر المحمي")}
                <input value={`SAR ${displayPrice.finalExcl}`} readOnly />
              </label>
              <label>
                {t("Requested final price", "السعر النهائي المطلوب")}
                <input value={`SAR ${estimate}`} readOnly />
              </label>
              <label>
                {t("Current total incl. VAT", "الإجمالي الحالي شامل الضريبة")}
                <input value={`SAR ${displayPrice.total}`} readOnly />
              </label>
              <label className="grow" style={{ gridColumn: "1 / -1" }}>
                {t("Reason", "السبب")}
                <textarea
                  rows={4}
                  value={discountRequestReason}
                  onChange={(e) => setDiscountRequestReason(e.target.value)}
                  placeholder={t(
                    "Why is this price needed? This reason is required and will be visible to admin.",
                    "لماذا تحتاج هذا السعر؟ هذا السبب مطلوب وسيظهر للإدارة.",
                  )}
                />
              </label>
            </div>
            <div className="actions footer-actions">
              <button
                type="button"
                disabled={requestBusy}
                onClick={() => setRequestDialogOpen(false)}
              >
                {t("Cancel", "إلغاء")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={requestBusy || !discountRequestReason.trim()}
                onClick={submitDiscountRequest}
              >
                {requestBusy
                  ? t("Sending…", "جارٍ الإرسال…")
                  : t("Submit request", "إرسال الطلب")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
