"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";

export default function QuotationInlineSearch({
  t,
  online,
  disabled,
  rowNumber,
  onSelectProduct,
  onAddCustom,
}: {
  t: Translate;
  online: boolean;
  disabled?: boolean;
  rowNumber: number;
  onSelectProduct: (product: any) => void;
  onAddCustom: (partNumber: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const generation = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!online) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setShowDropdown(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const current = ++generation.current;
    const timer = setTimeout(async () => {
      try {
        const found = await api("search?q=" + encodeURIComponent(trimmed));
        if (current === generation.current) {
          const top = Array.isArray(found) ? found.slice(0, 10) : [];
          setResults(top);
          setHighlightedIndex(top.length > 0 ? 0 : -1);
          setShowDropdown(true);
        }
      } catch {
        if (current === generation.current) {
          setResults([]);
        }
      } finally {
        if (current === generation.current) {
          setSearching(false);
        }
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [query, online]);

  function handleSelect(item: any) {
    onSelectProduct(item);
    setQuery("");
    setResults([]);
    setShowDropdown(false);
  }

  function handleCustom(part: string) {
    onAddCustom(part);
    setQuery("");
    setResults([]);
    setShowDropdown(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (results.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : 0,
        );
        setShowDropdown(true);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (results.length > 0) {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : results.length - 1,
        );
        setShowDropdown(true);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showDropdown && highlightedIndex >= 0 && results[highlightedIndex]) {
        handleSelect(results[highlightedIndex]);
        return;
      }
      if (query.trim()) {
        handleCustom(query.trim());
      }
      return;
    }
    if (e.key === "Escape") {
      setShowDropdown(false);
      setHighlightedIndex(-1);
    }
  }

  return (
    <div
      className="quotation-inline-search-wrap"
      style={{ position: "relative", width: "100%", minWidth: "220px" }}
    >
      <input
        ref={inputRef}
        data-cart-field="partNumber"
        data-cart-row={rowNumber - 1}
        className="quotation-inline-search-input"
        placeholder={t(
          "Type part number to add or search...",
          "اكتب رقم الصنف للإضافة أو البحث...",
        )}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!showDropdown) setShowDropdown(true);
        }}
        onFocus={() => {
          if (query.trim()) setShowDropdown(true);
        }}
        onBlur={() => {
          setShowDropdown(false);
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          minHeight: "32px",
          padding: "4px 8px",
          fontSize: "12px",
          borderRadius: "6px",
          border: "1px solid var(--line, #cbd5e1)",
          background: "var(--surface, #fff)",
        }}
      />
      {searching && (
        <span
          style={{
            position: "absolute",
            insetInlineEnd: "8px",
            insetBlockStart: "50%",
            transform: "translateY(-50%)",
            fontSize: "10px",
            color: "var(--muted, #64748b)",
            pointerEvents: "none",
          }}
        >
          {t("Searching...", "جارٍ البحث...")}
        </span>
      )}
      {showDropdown && query.trim() && (
        <div
          className="quotation-inline-dropdown"
          role="listbox"
          style={{
            position: "absolute",
            insetBlockStart: "100%",
            insetInlineStart: 0,
            zIndex: 100,
            minWidth: "320px",
            maxWidth: "480px",
            width: "max-content",
            background: "#fff",
            border: "1px solid var(--line, #cbd5e1)",
            borderRadius: "8px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            maxHeight: "260px",
            overflowY: "auto",
            padding: "4px",
            marginTop: "2px",
          }}
        >
          {results.length > 0 ? (
            results.map((item, idx) => (
              <button
                type="button"
                key={item.id || idx}
                className={idx === highlightedIndex ? "is-highlighted" : ""}
                style={{
                  display: "grid",
                  gap: "2px",
                  width: "100%",
                  textAlign: "start",
                  padding: "6px 10px",
                  border:
                    idx === highlightedIndex
                      ? "1px solid var(--primary, #0052cc)"
                      : "1px solid transparent",
                  borderRadius: "6px",
                  background:
                    idx === highlightedIndex ? "#f0f7ff" : "transparent",
                  cursor: "pointer",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(item);
                }}
                onMouseEnter={() => setHighlightedIndex(idx)}
              >
                <div
                  className="inline-lookup-item-head"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <strong style={{ fontSize: "12px", color: "#0f172a" }}>
                    {item.partNumber}
                  </strong>
                  <div
                    style={{
                      display: "flex",
                      gap: "6px",
                      alignItems: "center",
                    }}
                  >
                    {item.brand && (
                      <span
                        className="inline-lookup-brand"
                        style={{
                          fontSize: "10px",
                          padding: "1px 5px",
                          background: "#f1f5f9",
                          borderRadius: "3px",
                        }}
                      >
                        {item.brand}
                      </span>
                    )}
                    {item.masterExcl && (
                      <small
                        style={{
                          fontWeight: 600,
                          color: "#166534",
                          fontSize: "11px",
                        }}
                      >
                        {item.masterExcl}
                      </small>
                    )}
                  </div>
                </div>
                {item.description && (
                  <span
                    className="inline-lookup-desc"
                    style={{
                      fontSize: "11px",
                      color: "#64748b",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {item.description}
                  </span>
                )}
              </button>
            ))
          ) : (
            <div
              style={{
                padding: "8px 12px",
                fontSize: "12px",
                color: "#64748b",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span>
                {t(
                  "No catalog match found.",
                  "لم يتم العثور على صنف مطابق في الكتالوج.",
                )}
              </span>
              <button
                type="button"
                className="link-button"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--primary, #0052cc)",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: "12px",
                  fontWeight: 600,
                  textAlign: "start",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleCustom(query.trim());
                }}
              >
                {t(
                  `Add "${query.trim()}" as custom line`,
                  `إضافة "${query.trim()}" كبند مخصص`,
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
