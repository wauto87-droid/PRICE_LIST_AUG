"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type Translate } from "./api";
import {
  activityColumns,
  groupColumns,
  staffColumns,
} from "../shared/price-watch";
import { PriceActivityTable, WatchPagination } from "./PriceActivityTable";
import { appPath } from "../shared/paths";

const money = (value: unknown) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
const percent = (value: unknown) => `${Number(value || 0).toFixed(2)}%`;

export default function PriceWatcher({ t }: { t: Translate }) {
  const empty = {
    query: "",
    customer: "",
    actorId: "",
    stage: "ALL",
    source: "ALL",
    sellingLevel: "ALL",
    minDiscount: "",
    maxDiscount: "",
    from: "",
    to: "",
    page: 0,
    view: "ACTIVITY",
    sort: "",
    direction: "desc",
    staffSort: "subtotal",
    staffDirection: "desc",
  };
  const [filters, setFilters] = useState(empty),
    [data, setData] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [exports, setExports] = useState<any[]>([]),
    [refresh, setRefresh] = useState(0),
    [detailFilters, setDetailFilters] = useState<any>(null);
  const params = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(
      ([k, v]) => v !== "" && p.set(k, String(v)),
    );
    return p.toString();
  }, [filters]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      api("price-watcher?" + params)
        .then((value) => {
          if (active) setData(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [params, refresh]);
  useEffect(() => {
    const focus = () => setRefresh((v) => v + 1);
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);
  useEffect(() => {
    if (!detailFilters) return;
    let active = true;
    api("price-watcher/details?" + new URLSearchParams(detailFilters))
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [detailFilters, refresh]);
  useEffect(() => {
    if (!exports.some((x) => !["DONE", "FAILED"].includes(x.status))) return;
    const timer = setInterval(
      () =>
        Promise.all(
          exports.map((x) =>
            ["DONE", "FAILED"].includes(x.status)
              ? x
              : api("price-watcher-exports/" + x.id),
          ),
        )
          .then(setExports)
          .catch(() => undefined),
      1500,
    );
    return () => clearInterval(timer);
  }, [exports]);
  const set = (key: string, value: string | number) =>
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === "page" ? Number(value) : 0,
    }));
  function openDetail(row: any) {
    setDetail(null);
    setDetailFilters({
      ...filters,
      actorId: row.actor_id,
      itemKey: row.item_key,
      page: "0",
      view: "ACTIVITY",
      sort: "last_seen_at",
      direction: "desc",
    });
  }
  const changeSort = (sort: string) =>
    setFilters((f) => ({
      ...f,
      sort,
      page: 0,
      direction:
        (f.sort || (f.view === "ACTIVITY" ? "last_seen_at" : "latest_at")) ===
          sort && f.direction === "desc"
          ? "asc"
          : "desc",
    }));
  return (
    <div className="price-watcher">
      <div className="notice warning" role="note">
        {t(
          "Pricing activity analysis — lookup and quotation activity is not confirmed sales or collected revenue.",
          "تحليل نشاط التسعير — عمليات البحث وعروض الأسعار ليست مبيعات مؤكدة أو إيرادات محصلة.",
        )}
      </div>
      <section className="card watcher-filters">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              {t("PRICE WATCHER", "مراقبة الأسعار")}
            </span>
            <h3>{t("Filter pricing activity", "تصفية نشاط التسعير")}</h3>
          </div>
          {busy && <small>{t("Loading…", "جارٍ التحميل…")}</small>}
        </div>
        <div className="form-grid">
          <label>
            {t("View", "العرض")}
            <select
              aria-label={t("View", "العرض")}
              value={filters.view}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  view: e.target.value,
                  sort: "",
                  direction: "desc",
                  page: 0,
                }))
              }
            >
              <option value="ACTIVITY">
                {t("Individual activity", "النشاط الفردي")}
              </option>
              <option value="GROUPS">
                {t("Item and staff comparison", "مقارنة الصنف والموظف")}
              </option>
            </select>
          </label>
          <label>
            {t("Date order", "ترتيب التاريخ")}
            <select
              aria-label={t("Date order", "ترتيب التاريخ")}
              value={
                filters.sort === "" ||
                ["last_seen_at", "latest_at"].includes(filters.sort)
                  ? filters.direction
                  : "custom"
              }
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  sort: "",
                  direction: e.target.value,
                  page: 0,
                }))
              }
            >
              <option value="desc">
                {t("Newest to oldest", "الأحدث إلى الأقدم")}
              </option>
              <option value="asc">
                {t("Oldest to newest", "الأقدم إلى الأحدث")}
              </option>
              <option value="custom" disabled>
                {t("Column sorting", "ترتيب حسب العمود")}
              </option>
            </select>
          </label>
          <label>
            {t("Item / reference", "الصنف / المرجع")}
            <input
              value={filters.query}
              onChange={(e) => set("query", e.target.value)}
            />
          </label>
          <label>
            {t("Staff", "الموظف")}
            <select
              value={filters.actorId}
              onChange={(e) => set("actorId", e.target.value)}
            >
              <option value="">{t("All staff", "كل الموظفين")}</option>
              {data?.users?.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.username}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Evidence", "مرحلة الدليل")}
            <select
              value={filters.stage}
              onChange={(e) => set("stage", e.target.value)}
            >
              {["ALL", "LOOKUP", "CART", "DRAFT", "ISSUED"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Source", "المصدر")}
            <select
              value={filters.source}
              onChange={(e) => set("source", e.target.value)}
            >
              {["ALL", "CATALOG", "CUSTOM"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Selling level", "مستوى البيع")}
            <select
              value={filters.sellingLevel}
              onChange={(e) => set("sellingLevel", e.target.value)}
            >
              {["ALL", "WHOLESALE", "RETAIL", "END_CUSTOMER", "CUSTOM"].map(
                (x) => (
                  <option key={x}>{x.replace("_", " ")}</option>
                ),
              )}
            </select>
          </label>
          <label>
            {t("Customer", "العميل")}
            <input
              value={filters.customer}
              onChange={(e) => set("customer", e.target.value)}
            />
          </label>
          <label>
            {t("Discount from %", "الخصم من %")}
            <input
              type="number"
              min="0"
              max="100"
              value={filters.minDiscount}
              onChange={(e) => set("minDiscount", e.target.value)}
            />
          </label>
          <label>
            {t("Discount to %", "الخصم إلى %")}
            <input
              type="number"
              min="0"
              max="100"
              value={filters.maxDiscount}
              onChange={(e) => set("maxDiscount", e.target.value)}
            />
          </label>
          <label>
            {t("From", "من")}
            <input
              type="date"
              value={filters.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </label>
          <label>
            {t("To", "إلى")}
            <input
              type="date"
              value={filters.to}
              onChange={(e) => set("to", e.target.value)}
            />
          </label>
        </div>
        <div className="actions wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => setRefresh((v) => v + 1)}
          >
            {t("Refresh", "تحديث")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setFilters(empty)}
          >
            {t("Clear filters", "مسح الفلاتر")}
          </button>
          <button
            type="button"
            onClick={() =>
              api("price-watcher/excel?" + params, "POST", {})
                .then((x) => setExports((v) => [x, ...v]))
                .catch((e) => setError(e.message))
            }
          >
            {t("Export Excel", "تصدير Excel")}
          </button>
          <button
            type="button"
            onClick={() =>
              api("price-watcher/pdf?" + params, "POST", {})
                .then((x) => setExports((v) => [x, ...v]))
                .catch((e) => setError(e.message))
            }
          >
            {t("Export PDF", "تصدير PDF")}
          </button>
          {exports.map((x) =>
            x.status === "DONE" ? (
              <a
                className="button"
                key={x.id}
                href={appPath(`/api/v1/price-watcher-exports/${x.id}/download`)}
              >
                {t(`Download ${x.format}`, `تنزيل ${x.format}`)}
              </a>
            ) : (
              <small key={x.id}>
                {x.format}: {x.status}
                {x.error ? ` — ${x.error}` : ""}
              </small>
            ),
          )}
        </div>
      </section>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <>
          <div className="watcher-summary">
            <article>
              <small>{t("Summary interactions", "تفاعلات الملخص")}</small>
              <strong>{data.summary.events}</strong>
            </article>
            <article>
              <small>
                {t("Activity value excl. VAT", "قيمة النشاط دون ضريبة")}
              </small>
              <strong>SAR {money(data.summary.subtotal)}</strong>
            </article>
            <article>
              <small>{t("Total quantity", "إجمالي الكمية")}</small>
              <strong>{money(data.summary.quantity)}</strong>
            </article>
            <article>
              <small>{t("Weighted discount", "الخصم الموزون")}</small>
              <strong>{percent(data.summary.weighted_discount)}</strong>
            </article>
          </div>
          <div className="watcher-coverage">
            {["LOOKUP", "CART", "DRAFT", "ISSUED"].map((stage) => (
              <span key={stage} className="status">
                {stage}:{" "}
                {data.coverage.find((x: any) => x.stage === stage)?.events ?? 0}
              </span>
            ))}
          </div>
          <section className="card">
            <h3>{t("Staff overview", "ملخص الموظفين")}</h3>
            <PriceActivityTable
              rows={data.staff}
              columns={staffColumns}
              sort={filters.staffSort}
              direction={filters.staffDirection}
              t={t}
              onSort={(staffSort) =>
                setFilters((f) => ({
                  ...f,
                  staffSort,
                  staffDirection:
                    f.staffSort === staffSort && f.staffDirection === "desc"
                      ? "asc"
                      : "desc",
                  page: 0,
                }))
              }
            />
          </section>
          <section className="card">
            <h3>
              {filters.view === "ACTIVITY"
                ? t("Individual pricing activity", "نشاط التسعير الفردي")
                : t(
                    "Item and staff price comparison",
                    "مقارنة أسعار الصنف والموظف",
                  )}
            </h3>
            <p>
              {t(
                "Riyadh time. Summary totals count lifecycle interactions; individual activity includes separate calculation snapshots.",
                "توقيت الرياض. إجماليات الملخص تحسب التفاعلات؛ النشاط الفردي يشمل لقطات التسعير المنفصلة.",
              )}
            </p>
            <PriceActivityTable
              rows={
                filters.view === "ACTIVITY" ? (data.items ?? []) : data.groups
              }
              columns={
                filters.view === "ACTIVITY" ? activityColumns : groupColumns
              }
              sort={
                filters.sort ||
                (filters.view === "ACTIVITY" ? "last_seen_at" : "latest_at")
              }
              direction={filters.direction}
              onSort={changeSort}
              t={t}
              onOpen={openDetail}
            />
            <WatchPagination
              data={data}
              onPage={(page) => set("page", page)}
              t={t}
            />
          </section>
        </>
      )}
      {detailFilters && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDetailFilters(null);
            setDetail(null);
          }}
        >
          <section
            className="modal card watcher-detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h3>{t("Price evidence", "أدلة الأسعار")}</h3>
              <button
                type="button"
                aria-label={t("Close", "إغلاق")}
                onClick={() => {
                  setDetailFilters(null);
                  setDetail(null);
                }}
              >
                ×
              </button>
            </div>
            {!detail ? (
              <p>{t("Loading…", "جارٍ التحميل…")}</p>
            ) : (
              <>
                <PriceActivityTable
                  rows={detail.items}
                  columns={activityColumns}
                  sort={detailFilters.sort}
                  direction={detailFilters.direction}
                  t={t}
                  onSort={(sort) =>
                    setDetailFilters((f: any) => ({
                      ...f,
                      sort,
                      page: "0",
                      direction:
                        f.sort === sort && f.direction === "desc"
                          ? "asc"
                          : "desc",
                    }))
                  }
                />
                <WatchPagination
                  data={detail}
                  onPage={(page) =>
                    setDetailFilters((f: any) => ({ ...f, page: String(page) }))
                  }
                  t={t}
                />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
