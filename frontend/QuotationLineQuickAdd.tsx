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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    if (!online) {
      setResults([]);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const current = ++generation.current;
    const timer = setTimeout(async () => {
      try {
        const found = await api("search?q=" + encodeURIComponent(trimmed));
        if (current === generation.current) {
          setResults(found.slice(0, 5));
          setError("");
        }
      } catch (e) {
        if (current === generation.current) setError((e as Error).message);
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className="quote-inline-add">
        <td>
          <input
            placeholder={t(
              "Type part number to add or search",
              "اكتب رقم الصنف للإضافة أو البحث",
            )}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
              onClick={() => onAddCustom(query.trim())}
            >
              {t("Add as custom", "إضافة كمخصص")}
            </button>
          </div>
        </td>
      </tr>
      {!!results.length && (
        <tr className="quote-inline-results">
          <td colSpan={6}>
            <div className="inline-lookup-results">
              {results.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  disabled={busy}
                  onClick={() => void addCatalog(item)}
                >
                  <strong>{item.partNumber}</strong>
                  <span>{item.description}</span>
                  <small>{item.masterExcl}</small>
                </button>
              ))}
            </div>
            {!results.length && !!query.trim() && (
              <div className="muted">
                {t(
                  "No product match. Add it as a custom item.",
                  "لا يوجد صنف مطابق. أضفه كعنصر مخصص.",
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
