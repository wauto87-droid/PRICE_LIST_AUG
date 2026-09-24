"use client";
import { useEffect, useMemo, useState } from "react";
import type { Translate } from "../api";

const clean = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
export default function CustomerSelectionTable({
  label,
  customers,
  value,
  onChange,
  t,
}: {
  label: string;
  customers: any[];
  value: string[];
  onChange: (value: string[]) => void;
  t: Translate;
}) {
  const [search, setSearch] = useState(""),
    [selectedOnly, setSelectedOnly] = useState(false),
    [sort, setSort] = useState<"customer" | "code">("customer"),
    [direction, setDirection] = useState<"asc" | "desc">("asc"),
    [page, setPage] = useState(0);
  const selected = new Set(value),
    available = new Map(customers.map((c) => [c.customer_key, c]));
  const unavailable = value.filter((key) => !available.has(key));
  const matches = useMemo(
    () =>
      customers
        .filter(
          (c) =>
            (!selectedOnly || selected.has(c.customer_key)) &&
            clean(`${c.customer} ${c.customer_code || ""}`).includes(
              clean(search),
            ),
        )
        .sort((a, b) => {
          const av = sort === "code" ? a.customer_code || "" : a.customer,
            bv = sort === "code" ? b.customer_code || "" : b.customer;
          return (
            av.localeCompare(bv, undefined, {
              numeric: true,
              sensitivity: "base",
            }) * (direction === "asc" ? 1 : -1)
          );
        }),
    [customers, value, search, selectedOnly, sort, direction],
  );
  const pages = Math.max(1, Math.ceil(matches.length / 25)),
    shown = matches.slice(page * 25, page * 25 + 25);
  useEffect(() => setPage((current) => Math.min(current, pages - 1)), [pages]);
  const setValues = (keys: string[]) => onChange([...new Set(keys)]);
  const sortBy = (field: "customer" | "code") => {
    setSort(field);
    setDirection(sort === field && direction === "asc" ? "desc" : "asc");
    setPage(0);
  };
  return (
    <section className="dn-company-picker" aria-label={label}>
      <div className="dn-company-heading">
        <div>
          <strong>{label}</strong>
          <small>
            {customers.length} {t("companies", "شركة")} · {matches.length}{" "}
            {t("matching", "مطابقة")} · {value.length} {t("selected", "محددة")}
          </small>
        </div>
        <div className="dn-segmented">
          <button
            type="button"
            aria-pressed={!selectedOnly}
            onClick={() => {
              setSelectedOnly(false);
              setPage(0);
            }}
          >
            {t("All companies", "كل الشركات")}
          </button>
          <button
            type="button"
            aria-pressed={selectedOnly}
            onClick={() => {
              setSelectedOnly(true);
              setPage(0);
            }}
          >
            {t("Selected only", "المحدد فقط")}
          </button>
        </div>
      </div>
      <input
        aria-label={t("Search companies", "بحث الشركات")}
        placeholder={t(
          "Search company name or code…",
          "ابحث باسم الشركة أو الرمز…",
        )}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
      />
      <div className="actions">
        <button
          type="button"
          onClick={() =>
            setValues([...value, ...customers.map((c) => c.customer_key)])
          }
        >
          {t("Select all companies", "تحديد كل الشركات")}
        </button>
        <button
          type="button"
          onClick={() =>
            setValues([...value, ...matches.map((c) => c.customer_key)])
          }
        >
          {t("Select search results", "تحديد نتائج البحث")}
        </button>
        <button type="button" onClick={() => setValues([])}>
          {t("Clear selection", "مسح التحديد")}
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("Select", "تحديد")}</th>
              <th>
                <button type="button" onClick={() => sortBy("customer")}>
                  {t("Company", "الشركة")} ↕
                </button>
              </th>
              <th>
                <button type="button" onClick={() => sortBy("code")}>
                  {t("Customer code", "رمز العميل")} ↕
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.customer_key}>
                <td>
                  <input
                    aria-label={c.customer}
                    type="checkbox"
                    checked={selected.has(c.customer_key)}
                    onChange={(e) =>
                      setValues(
                        e.target.checked
                          ? [...value, c.customer_key]
                          : value.filter((k) => k !== c.customer_key),
                      )
                    }
                  />
                </td>
                <td>{c.customer}</td>
                <td>{c.customer_code || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && (
          <p className="dn-empty">
            {t(
              "No companies match this search.",
              "لا توجد شركات مطابقة للبحث.",
            )}
          </p>
        )}
      </div>
      <div className="dn-picker-pages">
        <button
          type="button"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          {t("Previous", "السابق")}
        </button>
        <span>
          {page + 1} / {pages}
        </span>
        <button
          type="button"
          disabled={page + 1 >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          {t("Next", "التالي")}
        </button>
      </div>
      {!!unavailable.length && (
        <div className="notice">
          <strong>
            {t("Unavailable in this snapshot", "غير متاحة في هذه النسخة")}
          </strong>
          <p>
            {unavailable.length}{" "}
            {t(
              "saved selections are preserved",
              "اختيارات محفوظة تم الاحتفاظ بها",
            )}
          </p>
          {unavailable.map((key) => (
            <button
              type="button"
              key={key}
              onClick={() => setValues(value.filter((v) => v !== key))}
            >
              {key} ×
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
