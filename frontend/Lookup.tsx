"use client";
import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";
import { levelLabel, visibleLevels } from "./levels";
import {
  clampHighlightedIndex,
  moveHighlightedIndex,
  suggestionOptionId,
  topSuggestions,
} from "./lookup-suggestions";
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
    [discount, setDiscount] = useState("0"),
    [quantity, setQuantity] = useState("1"),
    [price, setPrice] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [searching, setSearching] = useState(false),
    [suggestionsOpen, setSuggestionsOpen] = useState(false),
    [highlightedIndex, setHighlightedIndex] = useState(-1),
    [stamp, setStamp] = useState("");
  const searchRef = useRef<HTMLInputElement>(null),
    comboboxId = useRef(`lookup-combobox-${Math.random().toString(36).slice(2)}`),
    generation = useRef(0),
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
      if (!query.trim()) {
        setResults([]);
        setSuggestionsOpen(false);
        setHighlightedIndex(-1);
        return;
      }
      setSearching(true);
      setError("");
      try {
        let rows: any[] = [];
        if (online) {
          rows = await api("search?q=" + encodeURIComponent(query));
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
              .includes(query.toLowerCase()),
          );
          setStamp(cache.at || "");
        }
        if (current === searchGeneration.current) {
          setResults(rows);
          setSuggestionsOpen(rows.length > 0);
        }
      } catch (e) {
        if (current === searchGeneration.current)
          setError((e as Error).message);
      } finally {
        if (current === searchGeneration.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, online, settings.allowOfflineCache, user.id]);
  useEffect(() => {
    const current = ++generation.current;
    setPrice(null);
    if (!selected) return;
    if (!online) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(
      () =>
        api("pricing", "POST", {
          productId: selected.id,
          sellingLevel,
          quantity,
          discount,
          override: false,
          reason: "",
        })
          .then((p) => {
            if (current === generation.current) {
              setPrice(p);
              setError("");
            }
          })
          .catch((e) => {
            if (current === generation.current) setError(e.message);
          })
          .finally(() => {
            if (current === generation.current) setBusy(false);
          }),
      120,
    );
    return () => clearTimeout(timer);
  }, [selected, sellingLevel, quantity, discount, online]);
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
    setSellingLevel(p.defaultLevel ?? "END_CUSTOMER");
    setQuantity("1");
    setDiscount("0");
    setPrice(null);
    setError("");
    setSuggestionsOpen(false);
    setHighlightedIndex(-1);
  }
  function chooseLevel(code: string) {
    if (sellingLevel === code) return;
    generation.current++;
    setPrice(null);
    setBusy(online);
    setSellingLevel(code);
  }
  function add() {
    if (!selected || busy || (!price && online)) return;
    if (!online && !settings.allowOfflineCache) return;
    onAdd({
      productId: selected.id,
      sellingLevel,
      partNumber: selected.partNumber,
      sellingLevels: visibleLevels(selected),
      description: selected.description,
      unit: selected.unit,
      quantityPrecision: selected.quantityPrecision,
      input: {
        productId: selected.id,
        sellingLevel,
        quantity,
        discount,
        override: price?.overridden ?? false,
        reason: price?.overrideReason ?? "",
      },
      price,
      offline: !online,
    });
    setSelected(null);
    setQuery("");
    setResults([]);
    setSuggestionsOpen(false);
    setHighlightedIndex(-1);
    setPrice(null);
    searchRef.current?.focus();
  }
  async function override() {
    if (!price || !selected) return;
    const current = generation.current;
    const reason = prompt(
      t(
        "WARNING: Below-minimum pricing requires explicit approval. Enter the reason for this override.",
        "تحذير: السعر أقل من الحد الأدنى. أدخل سبب التجاوز.",
      ),
    );
    if (!reason?.trim()) return;
    try {
      const p = await api("pricing", "POST", {
        productId: selected.id,
        sellingLevel,
        quantity,
        discount,
        override: true,
        reason,
      });
      if (current !== generation.current) return;
      if (
        !(await showConfirm(
          t(
            `Minimum-protected price: SAR ${price.finalExcl}. Requested final price: SAR ${p.finalExcl}. Confirm override?`,
            `السعر المحمي: ${price.finalExcl} ر.س. السعر المطلوب: ${p.finalExcl} ر.س. تأكيد التجاوز؟`,
          ),
        ))
      )
        return;
      setPrice({ ...p, overrideReason: reason });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const selectedPrice =
    selected && visibleLevels(selected).find((l) => l.code === sellingLevel);
  const filteredResults = categoryFilter
    ? results.filter(
        (product) => (product.category || "UNCATEGORIZED") === categoryFilter,
      )
    : results;
  const filteredSuggestions = topSuggestions(filteredResults, 8);
  const resultCategories = [...new Set(results.map((p) => p.category || ""))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const activeSuggestion =
    highlightedIndex >= 0 ? filteredSuggestions[highlightedIndex] : null;
  const estimate = selectedPrice
    ? new Decimal(selectedPrice.masterExcl)
        .mul(
          new Decimal(1).sub(
            new Decimal(/^\d+(\.\d*)?$/.test(discount) ? discount : "0").div(
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
                  suggestionsOpen && highlightedIndex >= 0
                    ? suggestionOptionId(comboboxId.current, highlightedIndex)
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
                  if (filteredSuggestions.length) setSuggestionsOpen(true);
                }}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCategoryFilter("");
                  setSuggestionsOpen(!!e.target.value.trim());
                  setHighlightedIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSuggestionsOpen(filteredSuggestions.length > 0);
                    setHighlightedIndex((current) =>
                      moveHighlightedIndex(current, "next", filteredSuggestions.length),
                    );
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSuggestionsOpen(filteredSuggestions.length > 0);
                    setHighlightedIndex((current) =>
                      moveHighlightedIndex(
                        current,
                        "previous",
                        filteredSuggestions.length,
                      ),
                    );
                    return;
                  }
                  if (e.key === "Enter") {
                    if (suggestionsOpen && activeSuggestion) {
                      e.preventDefault();
                      choose(activeSuggestion);
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
              {!!filteredResults.length && (
                <span className="lookup-result-count">
                  {filteredResults.length} {t("shown", "معروض")}
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
                      (highlightedIndex === index ? " active" : "") +
                      (selected?.id === p.id ? " chosen" : "")
                    }
                    key={p.id}
                    role="option"
                    aria-selected={highlightedIndex === index}
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
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {stamp && !online && (
          <div className="notice">
            {t("Last synced", "آخر مزامنة")}: {new Date(stamp).toLocaleString()}
          </div>
        )}
        {!!results.length && (
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
        {!!results.length && (
          <div className="search-results lookup-results-panel">
            <div className="lookup-results-header">
              <div>
                <div className="eyebrow">{t("MATCHING PARTS", "الأصناف المطابقة")}</div>
                <h3>{t("Choose a product to price", "اختر صنفاً للتسعير")}</h3>
              </div>
            </div>
            <div className="result-head tier-result-head">
              <span>{t("Part / description", "الصنف / الوصف")}</span>
              <span>
                {t("Main selling price", "سعر البيع الرئيسي")}
              </span>
            </div>
            {filteredResults.map((p) => (
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
                  inputMode="decimal"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={discount}
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
                  ? t("FINAL PRICE", "السعر النهائي") +
                    " · " +
                    levelLabel(sellingLevel, t)
                  : t(
                      "OFFLINE ESTIMATE — NOT VALIDATED",
                      "تقدير دون اتصال — غير معتمد",
                    )}
              </div>
              {price?.maxDiscount !== undefined && (
                <p className="muted">
                  {t("Salesman limit", "حد المندوب")}:{" "}
                  {price.maxDiscount}%
                </p>
              )}
              {price ? (
                <>
                  <div className="price-pair counter-prices">
                    <div>
                      <label>{t("Excl. VAT", "قبل الضريبة")}</label>
                      <strong>{price.finalExcl}</strong>
                    </div>
                    <div>
                      <label>{t("Incl. VAT", "شامل الضريبة")}</label>
                      <strong>{price.finalIncl}</strong>
                    </div>
                  </div>
                  {price.minimumReached && (
                    <p className="notice">
                      {t(
                        "Minimum selling price reached",
                        "تم الوصول إلى أقل سعر بيع",
                      )}
                    </p>
                  )}
                  {price.discountLimited && (
                    <p className="notice">
                      {t(
                        `Your discount limit is ${user.maxDiscount}%. Price adjusted.`,
                        `حد الخصم المسموح ${user.maxDiscount}%. تم تعديل السعر.`,
                      )}
                    </p>
                  )}
                  {price.overridden && (
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
                      <b>SAR {price.subtotal}</b>
                    </span>
                    <span>
                      VAT {price.vatRate}% <b>{price.vatAmount}</b>
                    </span>
                    <span>
                      {t("TOTAL INCL. VAT", "الإجمالي شامل الضريبة")}{" "}
                      <b>SAR {price.total}</b>
                    </span>
                  </div>
                </>
              ) : (
                <p>
                  {online
                    ? t("Calculating…", "جارٍ الحساب…")
                    : t(
                        `Offline estimate: SAR ${estimate} excl. VAT. Final price requires online validation.`,
                        `تقدير دون اتصال: ${estimate} ر.س قبل الضريبة. يتطلب السعر النهائي التحقق عبر الإنترنت.`,
                      )}
                </p>
              )}
            </div>
            {user.permissions.includes("OVERRIDE_MINIMUM_PRICE") &&
              price?.minimumReached && (
                <button className="link-button" onClick={override}>
                  {t("Request below-minimum override", "طلب تجاوز الحد الأدنى")}
                </button>
              )}
            <button
              className="primary add-button"
              onClick={add}
              disabled={
                busy ||
                (online && !price) ||
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
    </div>
  );
}
