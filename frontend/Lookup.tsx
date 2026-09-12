"use client";
import { useEffect, useRef, useState } from "react";
import { ProductImageGallery } from "./ProductImages";
import Decimal from "decimal.js";
import { api, type Translate } from "./api";
import { buildLookupLineRequest, previewLookupPrice } from "./lookup-pricing";
import { levelLabel, visibleLevels } from "./levels";
import {
  discountSafeNumberInputProps,
  wheelSafeNumberInputProps,
} from "./number-input";
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
import CustomLineForm from "./CustomLineForm";
export default function Lookup({
  t,
  onAdd,
  user,
  settings,
  online,
}: {
  t: Translate;
  onAdd: (line: any) => void;
  user: any;
  settings: any;
  online: boolean;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [sellingLevel, setSellingLevel] = useState("END_CUSTOMER"),
    [categoryFilter, setCategoryFilter] = useState(""),
    [discount, setDiscount] = useState(""),
    [markup, setMarkup] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [price, setPrice] = useState<{
      input: {
        sellingLevel: string;
        quantity: string;
        discount: string;
        markup?: string;
      };
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
  const lastCalculation = useRef<{ key: string; id: string } | null>(null);
  const captureInFlight = useRef(new Set<string>());
  async function recordCalculation(payload: any) {
    if (captureInFlight.current.has(payload.calculationId)) return;
    captureInFlight.current.add(payload.calculationId);
    try {
      await api("price-watcher/capture", "POST", {
        interactionId: payload.interactionId,
        calculationId: payload.calculationId,
        line: payload.line,
      });
    } catch {
      // History is an administrative record; lookup stays usable if capture
      // is temporarily unavailable.
    } finally {
      captureInFlight.current.delete(payload.calculationId);
    }
  }
  const searchRef = useRef<HTMLInputElement>(null),
    discountRef = useRef<HTMLInputElement>(null),
    finalPriceRef = useRef<HTMLDivElement>(null),
    revealFinalPriceAfterValidation = useRef(false),
    comboboxId = useRef(
      `lookup-combobox-${Math.random().toString(36).slice(2)}`,
    ),
    pricingGeneration = useRef(0),
    searchGeneration = useRef(0),
    watcherEventId = useRef("");

  const selectedLevel = selected
    ? visibleLevels(selected).find((level) => level.code === sellingLevel)
    : undefined;
  const staffMarkupMode =
    selectedLevel?.entryMode === "MARKUP" ||
    selectedLevel?.method === "COST_MARKUP";
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
                  method: l.method,
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
            rows.length > 0 &&
              !isSelectedLookupQuery(trimmedQuery, selected?.partNumber),
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
  }, [
    query,
    online,
    selected?.partNumber,
    settings.allowOfflineCache,
    user.id,
  ]);
  useEffect(() => {
    if (!selected) return;
    setError("");
    setRequestDialogOpen(false);
    setDiscountRequestReason("");
    setRequestFeedback("");
  }, [selected?.id, sellingLevel, quantity, discount, markup]);
  useEffect(() => {
    const current = ++pricingGeneration.current;
    if (!selected || !online) {
      setPricingBusy(false);
      return;
    }
    setPricingBusy(true);
    setPrice(null);
    let input;
    try {
      input = buildLookupLineRequest(
        selected.id,
        sellingLevel as any,
        quantity,
        staffMarkupMode ? "0" : discount,
        staffMarkupMode ? markup : undefined,
      );
    } catch (e) {
      setPricingBusy(false);
      setError((e as Error).message);
      return;
    }
    const interactionId = watcherEventId.current;
    const calculationKey = JSON.stringify({ interactionId, input });
    if (lastCalculation.current?.key !== calculationKey)
      lastCalculation.current = {
        key: calculationKey,
        id: crypto.randomUUID(),
      };
    const calculationId = lastCalculation.current.id;
    api("pricing", "POST", input)
      .then((p) => {
        if (current !== pricingGeneration.current) return;
        void recordCalculation({ interactionId, calculationId, line: input });
        setPrice({
          input: {
            sellingLevel: input.sellingLevel,
            quantity: input.quantity,
            discount: input.discount,
            markup: input.markup,
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
  }, [
    selected,
    sellingLevel,
    quantity,
    discount,
    markup,
    staffMarkupMode,
    online,
  ]);
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
    watcherEventId.current = crypto.randomUUID();
    lastCalculation.current = null;
    setSelected(p);
    setQuery(p.partNumber);
    setSellingLevel(p.defaultLevel ?? "END_CUSTOMER");
    setQuantity("1");
    setDiscount("");
    setMarkup("");
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
    if (!online && (!settings.allowOfflineCache || staffMarkupMode)) return;
    let input;
    try {
      input = {
        ...buildLookupLineRequest(
          selected.id,
          sellingLevel as any,
          quantity,
          staffMarkupMode ? "0" : discount,
          staffMarkupMode ? markup : undefined,
        ),
        ...(watcherEventId.current
          ? { watcherEventId: watcherEventId.current }
          : {}),
      };
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
      void api("price-watcher/cart", "POST", {
        interactionId: input.watcherEventId,
        line: input,
      }).catch(() => undefined);
      setPrice({
        input: {
          sellingLevel: input.sellingLevel,
          quantity: input.quantity,
          discount: input.discount,
          markup: input.markup,
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
    watcherEventId.current = "";
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
      input = buildLookupLineRequest(
        selected.id,
        sellingLevel as any,
        quantity,
        discount,
      );
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
  const selectedPrice = selectedLevel;
  const normalizedSelectedPart = normalizeLookupQuery(selected?.partNumber);
  const filteredResults = categoryFilter
    ? results.filter(
        (product) => (product.category || "UNCATEGORIZED") === categoryFilter,
      )
    : results;
  const visibleResults = relatedLookupResults(filteredResults, selected);
  const filteredSuggestions = topSuggestions(filteredResults, 8);
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
  const showCategoryFilter =
    !!selected && showRelatedMatches && !!results.length;
  function resetLookup() {
    setSelected(null);
    setQuery("");
    setResults([]);
    setCategoryFilter("");
    setSuggestionsOpen(false);
    setShowRelatedMatches(false);
    setHighlightedIndex(-1);
    setPrice(null);
    setMarkup("");
    setError("");
    setRequestFeedback("");
    setRequestDialogOpen(false);
    setDiscountRequestReason("");
    searchRef.current?.focus();
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k")
        return;
      if (document.activeElement === searchRef.current) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      if (
        filteredSuggestions.length &&
        !isSelectedLookupQuery(query, selected?.partNumber)
      ) {
        setSuggestionsOpen(true);
        setHighlightedIndex((current) =>
          activeSuggestionIndex(current, filteredSuggestions.length),
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredSuggestions.length, query, selected?.partNumber]);
  let displayPrice = price?.value ?? null;
  let previewOnly = false;
  let previewError = "";
  try {
    if (selected) {
      const input = buildLookupLineRequest(
        selected.id,
        sellingLevel as any,
        quantity,
        staffMarkupMode ? "0" : discount,
        staffMarkupMode ? markup : undefined,
      );
      const matchesValidated =
        price?.input &&
        price.input.sellingLevel === input.sellingLevel &&
        price.input.quantity === input.quantity &&
        price.input.discount === input.discount &&
        price.input.markup === input.markup;
      if (!matchesValidated && !staffMarkupMode) {
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
  const estimate =
    selectedPrice && !staffMarkupMode
      ? new Decimal(selectedPrice.masterExcl)
          .mul(
            new Decimal(1).sub(
              new Decimal(
                /^\d+(\.\d*)?$/.test(discount) ? discount || "0" : "0",
              ).div(100),
            ),
          )
          .toFixed(2)
      : "0.00";
  const unitVat = displayPrice
    ? new Decimal(displayPrice.finalIncl)
        .minus(displayPrice.finalExcl)
        .toDecimalPlaces(2)
        .toFixed(2)
    : "";
  useEffect(() => {
    if (
      !revealFinalPriceAfterValidation.current ||
      pricingBusy ||
      !displayPrice
    )
      return;
    revealFinalPriceAfterValidation.current = false;
    const node = finalPriceRef.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight)
      node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pricingBusy, displayPrice]);
  return (
    <div className="lookup-layout lookup-compact">
      <section
        className={"card lookup-card" + (selected ? " has-selection" : "")}
      >
        <CustomLineForm
          t={t}
          vat={String(settings.vat)}
          onAdd={onAdd}
          suggestedPart={query}
        />
        <div className="lookup-search-panel">
          <div className="eyebrow">{t("PART LOOKUP", "البحث عن صنف")}</div>
          <div className="lookup-title-row">
            <div>
              <h2>
                {t("Find the right part fast", "اعثر على الصنف الصحيح بسرعة")}
              </h2>
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
                aria-expanded={
                  suggestionsOpen && filteredSuggestions.length > 0
                }
                aria-controls={comboboxId.current}
                aria-activedescendant={
                  suggestionsOpen && resolvedHighlightedIndex >= 0
                    ? suggestionOptionId(
                        comboboxId.current,
                        resolvedHighlightedIndex,
                      )
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
                      activeSuggestionIndex(
                        current,
                        filteredSuggestions.length,
                      ),
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
                        activeSuggestionIndex(
                          current,
                          filteredSuggestions.length,
                        ),
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
                        activeSuggestionIndex(
                          current,
                          filteredSuggestions.length,
                        ),
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
              {!!filteredSuggestions.length && !selected && (
                <span className="lookup-result-count">
                  {filteredSuggestions.length} {t("shown", "معروض")}
                </span>
              )}
            </div>
            {selected && (
              <div className="lookup-selected-actions actions wrap">
                {hasRelatedMatches && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setShowRelatedMatches((current) => !current)}
                  >
                    {showRelatedMatches
                      ? t(
                          `Hide similar matches (${visibleResults.length})`,
                          `إخفاء النتائج المشابهة (${visibleResults.length})`,
                        )
                      : t(
                          `Show similar matches (${visibleResults.length})`,
                          `عرض النتائج المشابهة (${visibleResults.length})`,
                        )}
                  </button>
                )}
                <button
                  type="button"
                  className="link-button"
                  onClick={resetLookup}
                >
                  {t("New search", "بحث جديد")}
                </button>
              </div>
            )}
            {suggestionsOpen && !!filteredSuggestions.length && (
              <div
                id={comboboxId.current}
                className="lookup-suggestions"
                role="listbox"
                aria-label={t(
                  "Suggested matching products",
                  "اقتراحات الأصناف المطابقة",
                )}
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
                            (l) =>
                              l.code === (p.defaultLevel ?? "END_CUSTOMER"),
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
        {!!visibleResults.length && !!selected && showRelatedMatches && (
          <div className="search-results lookup-results-panel">
            <div className="lookup-results-header">
              <div>
                <div className="eyebrow">
                  {t("MATCHING PARTS", "الأصناف المطابقة")}
                </div>
                <h3>{t("Related matches", "نتائج ذات صلة")}</h3>
              </div>
            </div>
            {showCategoryFilter && (
              <div className="actions wrap lookup-filters lookup-filter-bar">
                <label className="grow">
                  {t("Category filter", "تصفية الفئة")}
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="">{t("All categories", "كل الفئات")}</option>
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
            <div className="result-head tier-result-head">
              <span>{t("Part / description", "الصنف / الوصف")}</span>
              <span>{t("Main selling price", "سعر البيع الرئيسي")}</span>
            </div>
            {visibleResults.map((p) => (
              <button
                className={
                  "result tier-result" +
                  (selected?.id === p.id ? " selected-result" : "")
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
            <div className="lookup-selected-workspace">
              <div className="lookup-selected-main">
                <div className="product-heading">
                  <div>
                    <h2>{selected.partNumber}</h2>
                    <p>{selected.description}</p>
                    {(selected.details?.manufacturer ||
                      selected.details?.specifications?.length ||
                      selected.details?.applications?.length) && (
                      <details className="lookup-product-details">
                        <summary>
                          {t("Product details", "تفاصيل المنتج")}
                        </summary>
                        <p>
                          {[
                            selected.details.manufacturer,
                            selected.details.productType,
                            selected.details.series,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {!!selected.details.specifications?.length && (
                          <dl>
                            {selected.details.specifications.map(
                              (spec: any, index: number) => (
                                <div key={index}>
                                  <dt>{spec.label}</dt>
                                  <dd>{spec.value}</dd>
                                </div>
                              ),
                            )}
                          </dl>
                        )}
                        {!!selected.details.applications?.length && (
                          <p>
                            {t("Applications", "الاستخدامات")}:{" "}
                            {selected.details.applications.join(", ")}
                          </p>
                        )}
                      </details>
                    )}
                  </div>
                  <span className="pill">
                    {[selected.brand, selected.category]
                      .filter(Boolean)
                      .join(" · ") || t("Catalog item", "صنف كتالوج")}
                  </span>
                </div>
                <section className="selling-level-selector">
                  <label className="selling-level-select">
                    <span>{t("SELLING LEVEL", "مستوى البيع")}</span>
                    <select
                      value={sellingLevel}
                      onChange={(event) => chooseLevel(event.target.value)}
                    >
                      {visibleLevels(selected).map((level) => (
                        <option key={level.code} value={level.code}>
                          {levelLabel(level.code, t)} — SAR {level.masterExcl}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                {selected.imageCount > 0 && (
                  <ProductImageGallery productId={selected.id} t={t} />
                )}
              </div>
              <div className="lookup-selected-side">
                <div className="field-pair lookup-compact-fields">
                  <label>
                    {staffMarkupMode
                      ? t("MARKUP %", "نسبة الزيادة %")
                      : t("DISCOUNT %", "الخصم %")}
                    <input
                      ref={discountRef}
                      inputMode="decimal"
                      type="number"
                      min="0"
                      max={staffMarkupMode ? undefined : "100"}
                      step="0.01"
                      {...discountSafeNumberInputProps}
                      value={staffMarkupMode ? markup : discount}
                      placeholder="0"
                      onChange={(e) =>
                        staffMarkupMode
                          ? setMarkup(e.target.value)
                          : setDiscount(e.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        revealFinalPriceAfterValidation.current = true;
                        if (!pricingBusy && displayPrice) {
                          const node = finalPriceRef.current;
                          const bounds = node?.getBoundingClientRect();
                          if (
                            node &&
                            bounds &&
                            (bounds.top < 0 ||
                              bounds.bottom > window.innerHeight)
                          )
                            node.scrollIntoView({
                              behavior: "smooth",
                              block: "nearest",
                            });
                          revealFinalPriceAfterValidation.current = false;
                        }
                      }}
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
                      {...wheelSafeNumberInputProps}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") add();
                      }}
                    />
                  </label>
                </div>
                <div
                  ref={finalPriceRef}
                  className="final-price lookup-final-price-compact"
                >
                  <div className="eyebrow">
                    {online
                      ? t(
                          previewOnly
                            ? "FINAL UNIT PRICE EXCL. VAT — VALIDATED ON ADD"
                            : "FINAL UNIT PRICE EXCL. VAT",
                          previewOnly
                            ? "معاينة سعر الوحدة النهائي قبل الضريبة — يتم التحقق عند الإضافة"
                            : "سعر الوحدة النهائي قبل الضريبة",
                        )
                      : t(
                          "OFFLINE ESTIMATE — NOT VALIDATED",
                          "تقدير دون اتصال — غير معتمد",
                        )}
                  </div>
                  {!staffMarkupMode &&
                    displayPrice?.discountLimitSource === "ZERO_FLOOR" && (
                      <p className="muted">
                        No minimum-price restriction; discount up to 100%
                      </p>
                    )}
                  {staffMarkupMode && displayPrice?.maxMarkup !== undefined && (
                    <p className="muted">
                      {t("Markup limit", "حد الزيادة")}:{" "}
                      {displayPrice.maxMarkup}%
                    </p>
                  )}
                  {!staffMarkupMode &&
                    displayPrice?.maxDiscount !== undefined &&
                    displayPrice.discountLimitSource !== "ZERO_FLOOR" && (
                      <p className="muted">
                        {t("Salesman limit", "حد المندوب")}:{" "}
                        {displayPrice.maxDiscount}%
                      </p>
                    )}
                  {displayPrice ? (
                    <>
                      <div className="final-unit-price">
                        <span>SAR</span>
                        <strong>{displayPrice.finalExcl}</strong>
                      </div>
                      <div className="unit-price-details">
                        <span>
                          {t("VAT per unit", "ضريبة الوحدة")}{" "}
                          {displayPrice.vatRate}%<b>SAR {unitVat}</b>
                        </span>
                        <span>
                          {t("Unit incl. VAT", "الوحدة شاملة الضريبة")}
                          <b>SAR {displayPrice.finalIncl}</b>
                        </span>
                      </div>
                      {previewOnly && (
                        <p className="muted">
                          {t(
                            "Instant browser preview. The server confirms the protected final price when you add this line.",
                            "معاينة فورية داخل المتصفح. يؤكد الخادم السعر النهائي المحمي عند إضافة هذا البند.",
                          )}
                        </p>
                      )}
                      {!staffMarkupMode && displayPrice.minimumReached && (
                        <p className="notice">
                          {t(
                            "Minimum selling price reached",
                            "تم الوصول إلى أقل سعر بيع",
                          )}
                        </p>
                      )}
                      {staffMarkupMode && displayPrice.markupLimited && (
                        <p className="notice">
                          {t(
                            `Markup adjusted to the current allowed limit of ${displayPrice.maxMarkup ?? user.maxDiscount}%.`,
                            `تم تعديل الزيادة إلى الحد المسموح الحالي ${displayPrice.maxMarkup ?? user.maxDiscount}%.`,
                          )}
                        </p>
                      )}
                      {!staffMarkupMode && displayPrice.discountLimited && (
                        <p className="notice">
                          {t(
                            `Discount adjusted to the current allowed limit of ${displayPrice.maxDiscount ?? user.maxDiscount}%.`,
                            `تم تعديل الخصم إلى الحد المسموح الحالي ${displayPrice.maxDiscount ?? user.maxDiscount}%.`,
                          )}
                        </p>
                      )}
                      {!staffMarkupMode && displayPrice.overridden && (
                        <p className="notice error">
                          {t(
                            "Authorized minimum-price override",
                            "تجاوز الحد الأدنى المصرح به",
                          )}
                        </p>
                      )}
                      <div className="line-summary lookup-line-totals">
                        <span>
                          {t("QUANTITY", "الكمية")}
                          <b>
                            {quantity} {selected.unit}
                          </b>
                        </span>
                        <span>
                          {t(
                            "LINE TOTAL EXCL. VAT",
                            "إجمالي السطر قبل الضريبة",
                          )}{" "}
                          <b>SAR {displayPrice.subtotal}</b>
                        </span>
                        <span>
                          {t(
                            "LINE TOTAL INCL. VAT",
                            "إجمالي السطر شامل الضريبة",
                          )}{" "}
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
                              : staffMarkupMode
                                ? "Enter a valid quantity and markup to preview the price."
                                : "Enter a valid quantity and discount to preview the price.",
                            pricingBusy
                              ? "جارٍ تحميل التحقق الأساسي…"
                              : staffMarkupMode
                                ? "أدخل كمية ونسبة زيادة صالحتين لمعاينة السعر."
                                : "أدخل كمية وخصماً صالحين لمعاينة السعر.",
                          )
                        : t(
                            staffMarkupMode
                              ? "Cost-based markup requires online price validation."
                              : `Offline estimate: SAR ${estimate} excl. VAT. Final price requires online validation.`,
                            staffMarkupMode
                              ? "تسعير الزيادة حسب التكلفة يتطلب التحقق عبر الإنترنت."
                              : `تقدير دون اتصال: ${estimate} ر.س قبل الضريبة. يتطلب السعر النهائي التحقق عبر الإنترنت.`,
                          )}
                    </p>
                  )}
                </div>
                {requestFeedback && (
                  <div className="notice">{requestFeedback}</div>
                )}
                <div className="lookup-action-row">
                  {!staffMarkupMode && displayPrice?.minimumReached && (
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
                      (!online &&
                        (!settings.allowOfflineCache || staffMarkupMode))
                    }
                  >
                    {t("＋ ADD TO CART", "＋ أضف إلى السلة")}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
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
