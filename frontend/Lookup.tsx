"use client";
import { useEffect, useRef, useState } from "react";
import Decimal from "decimal.js";
import { api, type Translate } from "./api";
import { levelLabel, visibleLevels } from "./levels";
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
    [stamp, setStamp] = useState("");
  const searchRef = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    searchGeneration = useRef(0);
  useEffect(() => {
    if (!online && !settings.allowOfflineCache) {
      setSelected(null);
      setResults([]);
    }
  }, [online, settings.allowOfflineCache]);
  useEffect(() => {
    const current = ++searchGeneration.current;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
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
        if (current === searchGeneration.current) setResults(rows);
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
  function choose(p: any) {
    setSelected(p);
    setSellingLevel(p.defaultLevel ?? "END_CUSTOMER");
    setQuantity("1");
    setDiscount("0");
    setPrice(null);
    setError("");
    setResults([]);
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
        !confirm(
          t(
            `Minimum-protected price: SAR ${price.finalExcl}. Requested final price: SAR ${p.finalExcl}. Confirm override?`,
            `السعر المحمي: ${price.finalExcl} ر.س. السعر المطلوب: ${p.finalExcl} ر.س. تأكيد التجاوز؟`,
          ),
        )
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
  const resultCategories = [...new Set(results.map((p) => p.category || ""))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
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
        <div className="eyebrow">{t("PART LOOKUP", "البحث عن صنف")}</div>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            autoFocus
            aria-label={t(
              "Search part number or description",
              "البحث برقم الصنف أو الوصف",
            )}
            placeholder={t(
              "Search Part No. or Description…",
              "ابحث برقم الصنف أو الوصف…",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) choose(results[0]);
              if (e.key === "Escape") {
                setResults([]);
                setSelected(null);
              }
            }}
          />
          <kbd>↵</kbd>
        </label>
        {searching && <p className="muted">{t("Searching…", "جارٍ البحث…")}</p>}
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
          <div className="actions wrap lookup-filters">
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
          </div>
        )}
        {!!results.length && (
          <div className="search-results">
            <div className="result-head tier-result-head">
              <span>{t("Part / description", "الصنف / الوصف")}</span>
              <span>
                {t("Main selling price", "سعر البيع الرئيسي")}
              </span>
            </div>
            {filteredResults.map((p) => (
              <button
                className="result tier-result"
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
          <div className="empty-state">
            <div className="empty-symbol">⌕</div>
            <h2>{t("The right price. Right away.", "السعر الصحيح، فوراً.")}</h2>
            <p>
              {t(
                "Search your catalog to check a price and start a quotation.",
                "ابحث في الكتالوج للتحقق من السعر وإنشاء عرض سعر.",
              )}
            </p>
            <div className="hint-chips">
              <span>{t("Part number", "رقم الصنف")}</span>
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
      {showAside && <aside className="lookup-aside">
        <div className="eyebrow">
          {t("BUILT FOR YOUR COUNTER", "مصمم لخدمة العملاء")}
        </div>
        <h2>{t("Search. Price. Quote.", "ابحث. سعّر. اعرض.")}</h2>
        <p>
          {t(
            "One catalog. Clear VAT. Confident pricing.",
            "كتالوج واحد. ضريبة واضحة. تسعير موثوق.",
          )}
        </p>
        <ol>
          <li>
            {t(
              "Find any part or old reference",
              "ابحث عن الصنف أو المرجع القديم",
            )}
          </li>
          <li>{t("Set quantity and discount", "حدد الكمية والخصم")}</li>
          <li>
            {t(
              "Save, review, and send a quotation",
              "احفظ وراجع وأرسل عرض السعر",
            )}
          </li>
        </ol>
        <div className="aside-note">
          {t(
            "Prices are checked by the server before a quotation is issued.",
            "يتم التحقق من الأسعار على الخادم قبل إصدار عرض السعر.",
          )}
        </div>
      </aside>}
    </div>
  );
}
