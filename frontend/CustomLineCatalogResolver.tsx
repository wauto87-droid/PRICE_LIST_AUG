"use client";
import { useEffect, useId, useState } from "react";
import { api, type Translate } from "./api";

export default function CustomLineCatalogResolver({
  t,
  sourceReference,
  sourceDescription,
  identicalCount,
  canRemember,
  online,
  disabled,
  onReplace,
}: {
  t: Translate;
  sourceReference: string;
  sourceDescription: string;
  identicalCount: number;
  canRemember: boolean;
  online: boolean;
  disabled: boolean;
  onReplace: (
    product: any,
    scope: "ROW" | "ALL_IDENTICAL",
    remember: boolean,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [scope, setScope] = useState<"ROW" | "ALL_IDENTICAL">("ROW"),
    [remember, setRemember] = useState(false),
    [highlighted, setHighlighted] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const listId = useId();

  useEffect(() => {
    if (!open || selected || !online || !query.trim()) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void api("search?q=" + encodeURIComponent(query.trim()))
        .then((items) => {
          if (!active) return;
          setResults(items.slice(0, 5));
          setHighlighted(0);
          setError("");
        })
        .catch((reason) => {
          if (active) setError((reason as Error).message);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, online, query, selected]);

  const close = () => {
    setOpen(false);
    setSelected(null);
    setResults([]);
    setScope("ROW");
    setRemember(false);
    setError("");
  };
  const start = () => {
    setQuery(sourceReference.trim() || sourceDescription.trim());
    setOpen(true);
    setSelected(null);
    setScope("ROW");
    setRemember(false);
    setError("");
  };

  if (!open)
    return (
      <button
        type="button"
        className="link-button custom-catalog-find"
        disabled={disabled || !online}
        onClick={start}
      >
        {t("Find catalog item", "البحث في قائمة الأسعار")}
      </button>
    );

  return (
    <div className="custom-catalog-resolver">
      <div className="custom-catalog-resolver-head">
        <strong>{t("Replace with catalog item", "الاستبدال بصنف من القائمة")}</strong>
        <button type="button" onClick={close} aria-label={t("Close", "إغلاق")}>
          ×
        </button>
      </div>
      {!selected ? (
        <>
          <input
            autoFocus
            value={query}
            role="combobox"
            aria-controls={listId}
            aria-expanded={!!results.length}
            placeholder={t("Search part number or description", "ابحث برقم الصنف أو الوصف")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
              if (!results.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlighted((value) => (value + 1) % results.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((value) => (value - 1 + results.length) % results.length);
              } else if (event.key === "Enter") {
                event.preventDefault();
                setSelected(results[highlighted]);
                setResults([]);
              }
            }}
          />
          {!!results.length && (
            <div id={listId} role="listbox" className="custom-catalog-results">
              {results.map((item, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className={index === highlighted ? "active" : ""}
                  key={item.id}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => {
                    setSelected(item);
                    setResults([]);
                  }}
                >
                  <strong>{item.partNumber}</strong>
                  <span title={item.description}>{item.description}</span>
                  <small>SAR {item.masterExcl}</small>
                </button>
              ))}
            </div>
          )}
          {!results.length && query.trim() && (
            <small className="muted">
              {t("Type to search the catalog.", "اكتب للبحث في قائمة الأسعار.")}
            </small>
          )}
        </>
      ) : (
        <div className="custom-catalog-confirm">
          <div>
            <small>{t("Custom source", "الصنف المخصص")}</small>
            <strong>{sourceReference || t("No reference", "بدون مرجع")}</strong>
            <span>{sourceDescription}</span>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <small>{t("Catalog product", "صنف قائمة الأسعار")}</small>
            <strong>{selected.partNumber}</strong>
            <span>{selected.description}</span>
          </div>
          <label className="span-all">
            <input
              type="radio"
              name={`${listId}-scope`}
              checked={scope === "ROW"}
              onChange={() => setScope("ROW")}
            />
            {t("Replace this row", "استبدال هذا الصف")}
          </label>
          {sourceReference.trim() && identicalCount > 1 && (
            <label className="span-all">
              <input
                type="radio"
                name={`${listId}-scope`}
                checked={scope === "ALL_IDENTICAL"}
                onChange={() => setScope("ALL_IDENTICAL")}
              />
              {t(
                `Replace all ${identicalCount} identical custom rows`,
                `استبدال جميع الصفوف المخصصة المتطابقة (${identicalCount})`,
              )}
            </label>
          )}
          {canRemember && sourceReference.trim() && (
            <label className="span-all custom-catalog-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              {t(
                "Remember this external code for future delivery imports",
                "تذكر هذا الرمز الخارجي لاستيرادات التسليم المستقبلية",
              )}
            </label>
          )}
          <div className="actions wrap span-all">
            <button type="button" onClick={() => setSelected(null)} disabled={busy}>
              {t("Back", "رجوع")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void onReplace(selected, scope, remember)
                  .then(close)
                  .catch((reason) => setError((reason as Error).message))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t("Checking pricing…", "جارٍ فحص السعر…") : t("Confirm replacement", "تأكيد الاستبدال")}
            </button>
          </div>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
