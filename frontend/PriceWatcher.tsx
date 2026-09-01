"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type Translate } from "./api";
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
  };
  const [filters, setFilters] = useState(empty),
    [data, setData] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [exports, setExports] = useState<any[]>([]);
  const params = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(
      ([k, v]) => v !== "" && p.set(k, String(v)),
    );
    return p.toString();
  }, [filters]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setBusy(true);
      setError("");
      api("price-watcher?" + params)
        .then(setData)
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [params]);
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
  async function openDetail(itemKey: string) {
    try {
      setDetail(
        await api(
          "price-watcher/details?" +
            params +
            "&itemKey=" +
            encodeURIComponent(itemKey),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
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
              <small>{t("Activity", "النشاط")}</small>
              <strong>{data.summary.events}</strong>
            </article>
            <article>
              <small>
                {t("Quoted value excl. VAT", "قيمة النشاط دون ضريبة")}
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
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Staff", "الموظف")}</th>
                    <th>{t("Activity", "النشاط")}</th>
                    <th>{t("Items", "الأصناف")}</th>
                    <th>{t("Quotations", "العروض")}</th>
                    <th>{t("Value", "القيمة")}</th>
                    <th>{t("Weighted discount", "الخصم الموزون")}</th>
                    <th>{t("High-discount flags", "تنبيهات الخصم العالي")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((r: any) => (
                    <tr key={r.id}>
                      <td>{r.name || r.username}</td>
                      <td>{r.events}</td>
                      <td>{r.items}</td>
                      <td>{r.quotations}</td>
                      <td>{money(r.subtotal)}</td>
                      <td>{percent(r.weighted_discount)}</td>
                      <td>{r.high_discount_events}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h3>
              {t(
                "Item and staff price comparison",
                "مقارنة أسعار الصنف والموظف",
              )}
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Item", "الصنف")}</th>
                    <th>{t("Staff", "الموظف")}</th>
                    <th>{t("Count", "العدد")}</th>
                    <th>{t("Qty", "الكمية")}</th>
                    <th>{t("Weighted avg.", "المتوسط الموزون")}</th>
                    <th>{t("Median", "الوسيط")}</th>
                    <th>{t("Min / Max", "الأدنى / الأعلى")}</th>
                    <th>{t("Latest", "الأحدث")}</th>
                    <th>{t("Discount", "الخصم")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((r: any) => (
                    <tr
                      key={r.actor_id + r.item_key}
                      className={r.zero_price_events ? "watcher-exception" : ""}
                    >
                      <td>
                        <strong>{r.part_number || t("Custom", "مخصص")}</strong>
                        <small>{r.description}</small>
                      </td>
                      <td>{r.staff_name}</td>
                      <td>{r.events}</td>
                      <td>{money(r.quantity)}</td>
                      <td>{money(r.weighted_average)}</td>
                      <td>{money(r.median)}</td>
                      <td>
                        {money(r.minimum)} / {money(r.maximum)}
                      </td>
                      <td>{money(r.latest)}</td>
                      <td>
                        {percent(r.weighted_discount)}
                        {r.zero_price_events > 0 && (
                          <b className="danger-text"> · ZERO</b>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void openDetail(r.item_key)}
                        >
                          {t("Details", "التفاصيل")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button
                disabled={data.page <= 0}
                onClick={() => set("page", data.page - 1)}
              >
                {t("Previous", "السابق")}
              </button>
              <span>
                {data.page + 1} / {data.totalPages} · {data.total}
              </span>
              <button
                disabled={data.page + 1 >= data.totalPages}
                onClick={() => set("page", data.page + 1)}
              >
                {t("Next", "التالي")}
              </button>
            </div>
          </section>
        </>
      )}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <section
            className="modal card watcher-detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h3>{t("Price evidence", "أدلة الأسعار")}</h3>
              <button onClick={() => setDetail(null)}>×</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Date", "التاريخ")}</th>
                    <th>{t("Stage", "المرحلة")}</th>
                    <th>{t("Staff", "الموظف")}</th>
                    <th>{t("Qty", "الكمية")}</th>
                    <th>{t("Unit price", "سعر الوحدة")}</th>
                    <th>{t("Discount", "الخصم")}</th>
                    <th>{t("Quotation", "عرض السعر")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((x: any) => (
                    <tr key={x.id}>
                      <td>{new Date(x.last_seen_at).toLocaleString()}</td>
                      <td>{x.stage}</td>
                      <td>{x.staff_name}</td>
                      <td>{x.quantity}</td>
                      <td>{money(x.final_excl)}</td>
                      <td>{percent(x.effective_discount)}</td>
                      <td>{x.quotation_number || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
