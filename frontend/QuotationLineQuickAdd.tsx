"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";
import { buildLookupLineRequest } from "./lookup-pricing";
import { visibleLevels } from "./levels";
import { wheelSafeNumberInputProps } from "./number-input";

export default function QuotationLineQuickAdd({
  t,
  user,
  online,
  onAdd,
  onAddCustom,
}: {
  t: Translate;
  user: any;
  online: boolean;
  onAdd: (line: any) => void;
  onAddCustom: (partNumber: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [results, setResults] = useState<any[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!online) {
      setResults([]);
      setHighlightedIndex(-1);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setHighlightedIndex(-1);
      setSearching(false);
      return;
    }
    setSearching(true);
    const current = ++generation.current;
    const timer = setTimeout(async () => {
      try {
        const found = await api("search?q=" + encodeURIComponent(trimmed));
        if (current === generation.current) {
          const top = found.slice(0, 12);
          setResults(top);
          setHighlightedIndex(top.length > 0 ? 0 : -1);
          setError("");
        }
      } catch (e) {
        if (current === generation.current) setError((e as Error).message);
      } finally {
        if (current === generation.current) setSearching(false);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [query, online]);

  async function addCatalog(item: any) {
    if (!online || busy) return;
    setBusy(true);
    setError("");
    try {
      const baseInput = buildLookupLineRequest(
        item.id,
        item.defaultLevel ?? "END_CUSTOMER",
        quantity,
        "0",
      );
      const selectedLevel = visibleLevels(item).find(
        (level) => level.code === (item.defaultLevel ?? "END_CUSTOMER"),
      );
      const input =
        selectedLevel?.entryMode === "MARKUP" ||
        selectedLevel?.method === "COST_MARKUP"
          ? { ...baseInput, markup: "0" }
          : baseInput;
      const price = await api("pricing", "POST", input);
      onAdd({
        productId: item.id,
        sellingLevel: item.defaultLevel ?? "END_CUSTOMER",
        partNumber: item.partNumber,
        description: item.description,
        unit: item.unit,
        quantityPrecision: item.quantityPrecision,
        sellingLevels: visibleLevels(item),
        input,
        price,
        offline: false,
      });
      setQuery("");
      setQuantity("1");
      setResults([]);
      setHighlightedIndex(-1);
      inputRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (results.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (results.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      }
      return;
    }
    if (e.key === "Enter") {
      if (results.length > 0 && highlightedIndex >= 0 && results[highlightedIndex]) {
        e.preventDefault();
        void addCatalog(results[highlightedIndex]);
        return;
      }
      if (query.trim()) {
        e.preventDefault();
        onAddCustom(query.trim());
        setQuery("");
        setResults([]);
        setHighlightedIndex(-1);
        return;
      }
    }
    if (e.key === "Escape") {
      setResults([]);
      setHighlightedIndex(-1);
    }
  }

  const showDropdown = !!results.length || (!!query.trim() && !searching);

  return (
    <>
      <tr className="quote-inline-add">
        <td>
          <input
            ref={inputRef}
            placeholder={t(
              "Type part number to add or search",
              "اكتب رقم الصنف للإضافة أو البحث",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </td>
        <td>
          <input
            type="number"
            min="0.000001"
            step="any"
            {...wheelSafeNumberInputProps}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </td>
        <td></td>
        <td>—</td>
        <td>—</td>
        <td>
          <div className="actions">
            <button
              disabled={!query.trim()}
              onClick={() => {
                onAddCustom(query.trim());
                setQuery("");
                setResults([]);
                setHighlightedIndex(-1);
              }}
            >
              {t("Add as custom", "إضافة كمخصص")}
            </button>
          </div>
        </td>
      </tr>
      {showDropdown && (
        <tr className="quote-inline-results">
          <td colSpan={6}>
            {!!results.length ? (
              <div className="inline-lookup-results" role="listbox">
                {results.map((item, i) => (
                  <button
                    type="button"
                    key={item.id}
                    className={i === highlightedIndex ? "is-highlighted" : ""}
                    disabled={busy}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => void addCatalog(item)}
                  >
                    <div className="inline-lookup-item-head">
                      <strong>{item.partNumber}</strong>
                      {item.brand && (
                        <span className="inline-lookup-brand">{item.brand}</span>
                      )}
                      <small>{item.masterExcl}</small>
                    </div>
                    <span className="inline-lookup-desc">{item.description}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="muted inline-lookup-empty">
                {t(
                  "No product match. Press Enter or click 'Add as custom' to add as custom item.",
                  "لا يوجد صنف مطابق. اضغط Enter أو انقر على 'إضافة كمخصص' للإضافة كعنصر مخصص.",
                )}
              </div>
            )}
            {error && <div className="notice error">{error}</div>}
          </td>
        </tr>
      )}
    </>
  );
}
