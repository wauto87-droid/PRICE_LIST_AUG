import { useEffect, useMemo, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";
import { salesCheckMatchLabel, salesCheckReasonLabel, salesCheckStatusLabel } from "../shared/sales-check-labels";

const autoMap = (columns: string[], names: string[]) =>
  columns.find((c) =>
    names.includes(c.toLowerCase().replace(/[^a-z0-9]/g, "")),
  ) || "";

const processingStates = new Set(["UPLOADED", "PROCESSING"]);
const actionableStates = new Set(["AWAITING_MAPPING", "READY"]);

export default function SalesPriceCheck({ t }: { t: Translate }) {
  const [reports, setReports] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [mapping, setMapping] = useState({ partNumber: "", salesPrice: "" });
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [minDiscount, setMinDiscount] = useState("");
  const [sort, setSort] = useState("ROW_ASC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exports, setExports] = useState<any[]>([]);

  const load = () => api("sales-price-checks").then(setReports);
  const open = async (
    id: string,
    p = 0,
    f = filter,
    q = query,
    discount = minDiscount,
    sortBy = sort,
  ) => {
    const params = new URLSearchParams({
      page: String(p),
      pageSize: "50",
      filter: f,
      q,
      sort: sortBy,
    });
    if (discount.trim()) params.set("minDiscount", discount.trim());
    const nextReport = await api(`sales-price-checks/${id}?${params.toString()}`);
    setReport(nextReport);
    setPage(p);
    setMapping(
      Object.keys(nextReport.mapping || {}).length
        ? nextReport.mapping
        : {
            partNumber: autoMap(nextReport.columns || [], [
              "itemcode",
              "partnumber",
              "partreference",
              "sku",
            ]),
            salesPrice: autoMap(nextReport.columns || [], [
              "salesprice",
              "unitprice",
              "price",
            ]),
          },
    );
  };

  const applyFilters = (
    id: string,
    next: {
      page?: number;
      filter?: string;
      query?: string;
      minDiscount?: string;
      sort?: string;
    } = {},
  ) =>
    open(
      id,
      next.page ?? 0,
      next.filter ?? filter,
      next.query ?? query,
      next.minDiscount ?? minDiscount,
      next.sort ?? sort,
    );

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!reports.some((item) => processingStates.has(item.status))) return;
    const timer = setInterval(() => load().catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [reports]);

  useEffect(() => {
    if (!report || !processingStates.has(report.status)) return;
    const timer = setInterval(() => open(report.id).catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [report?.id, report?.status]);

  useEffect(() => {
    if (!exports.some((item) => !["DONE", "FAILED"].includes(item.status))) return;
    const timer = setInterval(
      () =>
        Promise.all(
          exports.map(async (item) =>
            ["DONE", "FAILED"].includes(item.status)
              ? item
              : api("sales-price-check-exports/" + item.id),
          ),
        )
          .then(setExports)
          .catch(() => {}),
      1500,
    );
    return () => clearInterval(timer);
  }, [exports]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const money = (value: unknown) =>
    value === null || value === undefined || value === ""
      ? "—"
      : Number(value).toFixed(2);

  const phaseLabel = (phase?: string) => {
    if (phase === "READING")
      return t("Reading spreadsheet", "جارٍ قراءة الملف");
    if (phase === "SAVING")
      return t("Saving spreadsheet rows", "جارٍ حفظ صفوف الملف");
    if (phase === "PREPARING")
      return t("Preparing catalog matches", "جارٍ تجهيز المطابقات");
    if (phase === "CHECKING")
      return t("Checking rows", "جارٍ فحص الصفوف");
    if (phase === "FINALIZING")
      return t("Finalizing results", "جارٍ إنهاء النتائج");
    if (phase === "COMPLETE") return t("Check complete", "اكتمل الفحص");
    if (phase === "FAILED") return t("Check failed", "فشل الفحص");
    return t("Preparing report", "جارٍ تجهيز التقرير");
  };

  const reportStatusTone = (status?: string) => {
    if (status === "READY") return "success";
    if (status === "FAILED") return "danger";
    if (processingStates.has(status || "")) return "working";
    return "neutral";
  };

  const reportUpdatedAt = report
    ? new Date(report.updated_at || report.created_at).toLocaleString()
    : "";
  const reportRunning = !!report && processingStates.has(report.status);
  const canAnalyze =
    !!report &&
    actionableStates.has(report.status) &&
    !!mapping.partNumber &&
    !!mapping.salesPrice &&
    !busy;
  const currentExports = useMemo(
    () =>
      exports.filter(
        (item) => !report || !item.report_id || item.report_id === report.id,
      ),
    [exports, report],
  );
  const progressTotalRows =
    report?.progress?.totalRows ?? report?.summary?.totalRows ?? 0;
  const progressProcessedRows = report?.progress?.processedRows ?? 0;
  const progressPercentage = report?.progress?.percentage;
  const resultRangeStart = report?.resultCount ? page * 50 + 1 : 0;
  const resultRangeEnd = report?.resultCount
    ? Math.min((page + 1) * 50, report.resultCount)
    : 0;

  return (
    <div className="sales-check">
      <div className="section-title">
        <div>
          <h2>{t("Sales Price Check", "فحص أسعار المبيعات")}</h2>
          <p className="muted">
            {t(
              "Compare every uploaded unit sales price before VAT with the app public list price.",
              "قارن سعر بيع كل صنف قبل الضريبة بسعر القائمة العام في التطبيق.",
            )}
          </p>
        </div>
      </div>

      <form
        className="actions wrap sales-check-toolbar sales-check-upload-bar"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          run(async () => {
            const created = await api("sales-price-checks", "POST", form);
            await open(created.id);
          });
        }}
      >
        <input name="file" type="file" accept=".xls,.xlsx,.csv" required />
        <button className="primary" disabled={busy}>
          {t("Upload sales file", "رفع ملف المبيعات")}
        </button>
      </form>

      {error && <div className="notice error">{error}</div>}

      <div className="job-list sales-check-report-list">
        {reports.map((item) => (
          <button
            key={item.id}
            className={[
              report?.id === item.id ? "active" : "",
              processingStates.has(item.status) ? "processing" : "",
              item.status === "READY" ? "ready" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => open(item.id)}
          >
            <div className="sales-check-report-list-head">
              <strong>{item.filename}</strong>
              <span
                className={`pill sales-check-status-pill ${reportStatusTone(item.status)}`}
              >
                {item.status}
              </span>
            </div>
            <small>{new Date(item.created_at).toLocaleString()}</small>
            {processingStates.has(item.status) && (
              <small className="sales-check-report-list-meta">
                {phaseLabel(item.progress?.phase)}
              </small>
            )}
          </button>
        ))}
      </div>

      {report && (
        <section className="card inset-card sales-check-shell">
          <div className="sales-check-report-head">
            <div>
              <div className="sales-check-report-title-row">
                <h3>{report.filename}</h3>
                <span
                  className={`pill sales-check-status-pill ${reportStatusTone(report.status)}`}
                >
                  {report.status}
                </span>
              </div>
              <div className="sales-check-report-meta">
                <span>
                  {t("Updated", "آخر تحديث")}: {reportUpdatedAt}
                </span>
                {report.status === "READY" && (
                  <span>
                    {t("Showing", "إظهار")} {resultRangeStart}-{resultRangeEnd} /{" "}
                    {report.resultCount}
                  </span>
                )}
              </div>
            </div>
            <div className="actions wrap">
              <button
                className="danger"
                disabled={busy || reportRunning}
                onClick={() =>
                  run(async () => {
                    await api(`sales-price-checks/${report.id}`, "DELETE");
                    setReport(null);
                  })
                }
              >
                {t("Delete report", "حذف التقرير")}
              </button>
            </div>
          </div>

          {(reportRunning || report.status === "READY" || report.error) && (
            <div
              className={`sales-check-progress sales-check-progress-${report.error ? "danger" : reportRunning ? "working" : "success"}`}
              role="status"
            >
              <div className="sales-check-progress-head">
                <div>
                  <strong>
                    {report.error
                      ? t("Check failed", "فشل الفحص")
                      : reportRunning
                        ? phaseLabel(report.progress?.phase)
                        : t("Check complete", "اكتمل الفحص")}
                  </strong>
                  <small className="sales-check-progress-subtitle">
                    {report.error
                      ? report.error
                      : reportRunning
                        ? t(
                            "The report stays open and updates live while the check runs.",
                            "يبقى التقرير مفتوحاً ويتم تحديثه مباشرة أثناء الفحص.",
                          )
                        : t(
                            "Latest results are ready. You can filter, export, or re-run from this report.",
                            "أحدث النتائج جاهزة. يمكنك التصفية أو التصدير أو إعادة الفحص من هذا التقرير.",
                          )}
                  </small>
                </div>
                <span>
                  {progressProcessedRows} / {progressTotalRows}{" "}
                  {t("rows", "صفوف")}
                </span>
              </div>
              <div
                className={`admin-progress ${typeof progressPercentage !== "number" ? "indeterminate" : ""}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={typeof progressPercentage === "number" ? progressPercentage : undefined}
              >
                <span
                  style={
                    typeof progressPercentage === "number"
                      ? { width: `${progressPercentage}%` }
                      : undefined
                  }
                />
              </div>
              <div className="admin-progress-meta">
                <span>
                  {typeof progressPercentage === "number"
                    ? `${progressPercentage}%`
                    : t("Live", "مباشر")}
                </span>
                <span>
                  {report.error
                    ? t(
                        "Review the mapping or file content, then re-run the check.",
                        "راجع الربط أو محتوى الملف ثم أعد الفحص.",
                      )
                    : reportRunning
                      ? report.progress?.remainingSeconds == null
                        ? t(
                            "Estimating remaining time…",
                            "جارٍ تقدير الوقت المتبقي…",
                          )
                        : report.progress.remainingSeconds > 0
                          ? t(
                              `About ${report.progress.remainingSeconds}s remaining`,
                              `المتبقي تقريباً ${report.progress.remainingSeconds} ثانية`,
                            )
                          : t("Almost complete", "اكتمل تقريباً")
                      : t("Ready for review", "جاهز للمراجعة")}
                </span>
              </div>
            </div>
          )}

          {report.error && <div className="notice error">{report.error}</div>}

          {actionableStates.has(report.status) && (
            <div className="sales-check-setup">
              <div className="mapping-grid">
                {[
                  ["partNumber", "Part number", "رقم الصنف"],
                  [
                    "salesPrice",
                    "Sales price before VAT",
                    "سعر البيع قبل الضريبة",
                  ],
                ].map(([key, en, ar]) => (
                  <label key={key}>
                    {t(en, ar)}
                    <select
                      disabled={busy || reportRunning}
                      value={(mapping as any)[key]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [key]: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {(report.columns || []).map((column: string) => (
                        <option key={column}>{column}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="actions wrap">
                <button
                  className="primary"
                  disabled={!canAnalyze}
                  onClick={() =>
                    run(async () => {
                      await api(`sales-price-checks/${report.id}/analyze`, "POST", {
                        version: report.version,
                        ...mapping,
                      });
                      await open(report.id);
                    })
                  }
                >
                  {report.status === "READY"
                    ? t("Re-run check", "إعادة الفحص")
                    : t("Analyze prices", "تحليل الأسعار")}
                </button>
              </div>
            </div>
          )}

          {report.status === "READY" && (
            <>
              <div className="sales-check-summary-grid">
                {[
                  ["Rows", report.summary.totalRows],
                  ["Matched", report.summary.matchedRows],
                  ["Unmatched", report.summary.unmatchedRows],
                  ["Ambiguous", report.summary.ambiguousRows],
                  ["Invalid", report.summary.invalidRows],
                ].map(([key, value]) => (
                  <div className="sales-check-summary-card" key={key}>
                    <span>{t(String(key), String(key))}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>

              <div className="sales-check-toolbar sales-check-toolbar-ready">
                <div className="sales-check-toolbar-group sales-check-toolbar-filters">
                  <label className="sales-check-field">
                    <span>{t("Status", "الحالة")}</span>
                    <select
                      disabled={busy || reportRunning}
                      value={filter}
                      onChange={(e) => {
                        const next = e.target.value;
                        setFilter(next);
                        applyFilters(report.id, { filter: next });
                      }}
                    >
                      {[
                        "ALL",
                        "CHECKED",
                        "NOT_MATCHED",
                        "MATCHED",
                        "UNMATCHED",
                        "AMBIGUOUS",
                        "INVALID",
                        "DISCOUNT",
                        "ZERO",
                        "ABOVE_LIST",
                      ].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="sales-check-field sales-check-search-field">
                    <span>{t("Search", "بحث")}</span>
                    <input
                      disabled={busy || reportRunning}
                      placeholder={t(
                        "Search part or description",
                        "بحث عن صنف أو وصف",
                      )}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyFilters(report.id);
                      }}
                    />
                  </label>
                  <label className="sales-check-field sales-check-number-field">
                    <span>{t("Discount %+", "الخصم %+")}</span>
                    <input
                      disabled={busy || reportRunning}
                      inputMode="decimal"
                      placeholder="10"
                      value={minDiscount}
                      onChange={(e) => setMinDiscount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyFilters(report.id);
                      }}
                    />
                  </label>
                  <label className="sales-check-field">
                    <span>{t("Sort", "الترتيب")}</span>
                    <select
                      disabled={busy || reportRunning}
                      value={sort}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSort(next);
                        applyFilters(report.id, { sort: next });
                      }}
                    >
                      <option value="ROW_ASC">
                        {t("Row order", "ترتيب الصف")}
                      </option>
                      <option value="DISCOUNT_DESC">
                        {t("Discount high to low", "الخصم من الأعلى إلى الأقل")}
                      </option>
                      <option value="DISCOUNT_ASC">
                        {t("Discount low to high", "الخصم من الأقل إلى الأعلى")}
                      </option>
                      <option value="SALES_PRICE_DESC">
                        {t(
                          "Sales price high to low",
                          "سعر البيع من الأعلى إلى الأقل",
                        )}
                      </option>
                      <option value="SALES_PRICE_ASC">
                        {t(
                          "Sales price low to high",
                          "سعر البيع من الأقل إلى الأعلى",
                        )}
                      </option>
                      <option value="LIST_PRICE_DESC">
                        {t(
                          "List price high to low",
                          "سعر القائمة من الأعلى إلى الأقل",
                        )}
                      </option>
                      <option value="LIST_PRICE_ASC">
                        {t(
                          "List price low to high",
                          "سعر القائمة من الأقل إلى الأعلى",
                        )}
                      </option>
                    </select>
                  </label>
                  <div className="sales-check-toolbar-actions">
                    <button disabled={busy || reportRunning} onClick={() => applyFilters(report.id)}>
                      {t("Apply", "تطبيق")}
                    </button>
                  </div>
                </div>

                <div className="sales-check-toolbar-group sales-check-toolbar-exports">
                  <span className="sales-check-results-note">
                    {t("Results", "النتائج")}: {report.resultCount}
                  </span>
                  <button
                    disabled={busy || reportRunning}
                    onClick={() =>
                      run(async () => {
                        const nextExport = await api(
                          `sales-price-checks/${report.id}/excel`,
                          "POST",
                          {},
                        );
                        setExports((items) => [...items, nextExport]);
                      })
                    }
                  >
                    Excel
                  </button>
                  <button
                    disabled={busy || reportRunning}
                    onClick={() =>
                      run(async () => {
                        const nextExport = await api(
                          `sales-price-checks/${report.id}/pdf`,
                          "POST",
                          {},
                        );
                        setExports((items) => [...items, nextExport]);
                      })
                    }
                  >
                    PDF
                  </button>
                  {currentExports.map((item) =>
                    item.status === "DONE" ? (
                      <a
                        key={item.id}
                        className="button"
                        href={appPath(
                          `/api/v1/sales-price-check-exports/${item.id}/download`,
                        )}
                      >
                        {t("Download", "تنزيل")} {item.format}
                      </a>
                    ) : (
                      <span key={item.id} className="sales-check-export-status">
                        {item.format}: {item.status}
                      </span>
                    ),
                  )}
                </div>
              </div>

              <div className="table-scroll sales-check-table-wrap">
                <table className="sales-check-table">
                  <thead>
                    <tr>
                      <th className="row-number-cell">#</th>
                      <th className="part-cell">{t("Source part", "الصنف المصدر")}</th>
                      <th className="part-cell">{t("Matched part", "الصنف المطابق")}</th>
                      <th className="description-cell">{t("Description", "الوصف")}</th>
                      <th className="number-cell">{t("Sales price", "سعر البيع")}</th>
                      <th className="number-cell">
                        {t("App list price", "سعر القائمة")}
                      </th>
                      <th className="number-cell">{t("Discount %", "الخصم %")}</th>
                      <th>{t("Item Check", "فحص الصنف")}</th>
                      <th>{t("Match", "المطابقة")}</th>
                      <th className="status-cell">
                        {t("Status / reason", "الحالة / السبب")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row: any) => (
                      <tr key={row.id}>
                        <td data-label="#" className="row-number-cell">
                          {row.row_number}
                        </td>
                        <td data-label="Source part" className="part-cell">
                          {row.source_part}
                        </td>
                        <td data-label="Matched part" className="part-cell">
                          {row.matched_part || "—"}
                        </td>
                        <td
                          data-label="Description"
                          className="description-cell"
                          title={row.description}
                        >
                          {row.description || "—"}
                        </td>
                        <td data-label="Sales price" className="number-cell">
                          {money(row.sales_price)}
                        </td>
                        <td data-label="App list price" className="number-cell">
                          {money(row.list_price)}
                        </td>
                        <td data-label="Discount %" className="number-cell">
                          {money(row.discount_percent)}
                        </td>
                        <td data-label="Item Check">
                          <span
                            className={`sales-check-badge ${row.product_id ? "checked" : "not-matched"}`}
                          >
                            {row.product_id
                              ? t("Checked", "تم الفحص")
                              : t("Not matched item", "صنف غير مطابق")}
                          </span>
                        </td>
                        <td data-label="Match">
                          <span className="sales-check-match-chip">
                            {salesCheckMatchLabel(row.match_type)}
                          </span>
                        </td>
                        <td data-label="Status / reason" className="status-cell">
                          <div className="sales-check-status-stack">
                            <span
                              className={`pill ${row.status === "MATCHED" ? "" : "warning"}`}
                            >
                              {salesCheckStatusLabel(row.status)}
                            </span>
                            {row.error && (
                              <small className="sales-check-error">{salesCheckReasonLabel(row.error)}</small>
                            )}
                            <details className="sales-check-raw">
                              <summary>{t("Details", "التفاصيل")}</summary>
                              <dl className="sales-check-source-fields">{Object.entries(row.raw ?? {}).map(([field,value]) => <div key={field}><dt>{field}</dt><dd>{String(value ?? "—")}</dd></div>)}</dl>
                              <details><summary>{t("Technical details", "التفاصيل التقنية")}</summary><p>{row.match_type || "—"} · {row.status}</p><pre>{JSON.stringify(row.raw, null, 2)}</pre></details>
                            </details>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="actions wrap sales-check-pagination">
                <button
                  disabled={page === 0 || busy || reportRunning}
                  onClick={() =>
                    open(report.id, page - 1, filter, query, minDiscount, sort)
                  }
                >
                  {t("Previous", "السابق")}
                </button>
                <span className="muted">
                  {t("Page", "الصفحة")} {page + 1} · {t("Showing", "إظهار")}{" "}
                  {resultRangeStart}-{resultRangeEnd}
                </span>
                <button
                  disabled={
                    busy || reportRunning || (page + 1) * 50 >= report.resultCount
                  }
                  onClick={() =>
                    open(report.id, page + 1, filter, query, minDiscount, sort)
                  }
                >
                  {t("Next", "التالي")}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
