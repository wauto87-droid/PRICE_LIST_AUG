"use client";
import { type Translate } from "./api";
import { watchValue, type WatchColumn } from "../shared/price-watch";

export function PriceActivityTable({
  rows,
  columns,
  sort,
  direction,
  onSort,
  t,
  onOpen,
  openLabel,
}: {
  rows: any[];
  columns: WatchColumn[];
  sort: string;
  direction: string;
  onSort: (key: string) => void;
  t: Translate;
  onOpen?: (row: any) => void;
  openLabel?: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                aria-sort={
                  sort === c.key
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onSort(c.key)}
                >
                  {t(c.en, c.ar)}{" "}
                  {sort === c.key ? (direction === "asc" ? "↑" : "↓") : "↕"}
                </button>
              </th>
            ))}
            {onOpen && <th>{t("Action", "الإجراء")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id ?? `${r.actor_id}:${r.item_key}`}
              className={
                r.final_excl === "0.00" || r.zero_price_events > 0
                  ? "watcher-exception"
                  : ""
              }
            >
              {columns.map((c) => (
                <td key={c.key}>
                  {c.key === "evidence"
                    ? t(
                        String(r[c.key]),
                        r[c.key] === "Legacy snapshot"
                          ? "لقطة قديمة"
                          : r[c.key] === "Calculation"
                            ? "عملية تسعير"
                            : "دورة عرض السعر",
                      )
                    : watchValue(r[c.key], c.kind)}
                </td>
              ))}
              {onOpen && (
                <td>
                  <button type="button" onClick={() => onOpen(r)}>
                    {openLabel ?? t("Details", "التفاصيل")}
                  </button>
                </td>
              )}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length + (onOpen ? 1 : 0)}>
                {t("No matching activity", "لا يوجد نشاط مطابق")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function WatchPagination({
  data,
  onPage,
  t,
}: {
  data: any;
  onPage: (page: number) => void;
  t: Translate;
}) {
  return (
    <div className="pagination">
      <button
        type="button"
        disabled={!data || data.page <= 0}
        onClick={() => onPage(data.page - 1)}
      >
        {t("Previous", "السابق")}
      </button>
      <span>
        {(data?.page ?? 0) + 1} / {data?.totalPages ?? 1} · {data?.total ?? 0}
      </span>
      <button
        type="button"
        disabled={!data || data.page + 1 >= data.totalPages}
        onClick={() => onPage(data.page + 1)}
      >
        {t("Next", "التالي")}
      </button>
    </div>
  );
}
