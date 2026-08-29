"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";

const autoMap = (columns: string[], names: string[]) =>
  columns.find((c) =>
    names.includes(c.toLowerCase().replace(/[^a-z0-9]/g, "")),
  ) || "";
export default function SalesPriceCheck({ t }: { t: Translate }) {
  const [reports, setReports] = useState<any[]>([]),
    [report, setReport] = useState<any>(null),
    [mapping, setMapping] = useState({ partNumber: "", salesPrice: "" }),
    [page, setPage] = useState(0),
    [filter, setFilter] = useState("ALL"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [exports, setExports] = useState<any[]>([]);
  const load = () => api("sales-price-checks").then(setReports);
  const open = async (id: string, p = 0, f = filter, q = query) => {
    const r = await api(
      `sales-price-checks/${id}?page=${p}&pageSize=50&filter=${encodeURIComponent(f)}&q=${encodeURIComponent(q)}`,
    );
    setReport(r);
    setPage(p);
    setMapping(
      Object.keys(r.mapping || {}).length
        ? r.mapping
        : {
            partNumber: autoMap(r.columns || [], [
              "itemcode",
              "partnumber",
              "partreference",
              "sku",
            ]),
            salesPrice: autoMap(r.columns || [], [
              "salesprice",
              "unitprice",
              "price",
            ]),
          },
    );
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!reports.some((r) => ["UPLOADED", "PROCESSING"].includes(r.status)))
      return;
    const x = setInterval(() => load().catch(() => {}), 1800);
    return () => clearInterval(x);
  }, [reports]);
  useEffect(() => {
    if (!report || !["UPLOADED", "PROCESSING"].includes(report.status)) return;
    const timer = setInterval(() => open(report.id).catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [report?.id, report?.status]);
  useEffect(() => {
    if (!exports.some((x) => !["DONE", "FAILED"].includes(x.status))) return;
    const timer = setInterval(
      () =>
        Promise.all(
          exports.map(async (x) =>
            ["DONE", "FAILED"].includes(x.status)
              ? x
              : api("sales-price-check-exports/" + x.id),
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
  const phaseLabel: Record<string, string> = {
    READING: "Reading spreadsheet",
    SAVING: "Saving spreadsheet rows",
    PREPARING: "Preparing catalog matches",
    CHECKING: "Checking rows",
    FINALIZING: "Finalizing results",
    COMPLETE: "Check complete",
    FAILED: "Check failed",
  };
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
        className="actions wrap sales-check-toolbar"
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
      <div className="job-list">
        {reports.map((r) => (
          <button
            key={r.id}
            className={report?.id === r.id ? "active" : ""}
            onClick={() => open(r.id)}
          >
            <strong>{r.filename}</strong>
            <small>
              {r.status} · {new Date(r.created_at).toLocaleString()}
            </small>
          </button>
        ))}
      </div>
      {report && (
        <section className="card inset-card">
          <div className="section-title">
            <h3>{report.filename}</h3>
            <div className="actions">
              <span className="pill">{report.status}</span>
              <button
                className="danger"
                disabled={busy}
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
          {report.status === "PROCESSING" && (
            <div className="sales-check-progress" role="status">
              <div className="sales-check-progress-head">
                <strong>
                  {phaseLabel[report.progress?.phase] || "Preparing report"}
                </strong>
                <span>
                  {report.progress?.processedRows ?? 0} /{" "}
                  {report.progress?.totalRows ?? report.summary?.totalRows ?? 0}{" "}
                  rows
                </span>
              </div>
              <div
                className={`admin-progress ${typeof report.progress?.percentage !== "number" ? "indeterminate" : ""}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={report.progress?.percentage}
              >
                <span
                  style={
                    typeof report.progress?.percentage === "number"
                      ? { width: `${report.progress.percentage}%` }
                      : undefined
                  }
                />
              </div>
              <div className="admin-progress-meta">
                <span>{report.progress?.percentage ?? "—"}%</span>
                <span>
                  {report.progress?.remainingSeconds == null
                    ? "Estimating remaining time…"
                    : report.progress.remainingSeconds > 0
                      ? `About ${report.progress.remainingSeconds}s remaining`
                      : "Almost complete"}
                </span>
              </div>
            </div>
          )}
          {report.error && <div className="notice error">{report.error}</div>}
          {["AWAITING_MAPPING", "READY"].includes(report.status) && (
            <>
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
                      value={(mapping as any)[key]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [key]: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {(report.columns || []).map((c: string) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy || !mapping.partNumber || !mapping.salesPrice}
                onClick={() =>
                  run(async () => {
                    await api(
                      `sales-price-checks/${report.id}/analyze`,
                      "POST",
                      { version: report.version, ...mapping },
                    );
                    await open(report.id);
                  })
                }
              >
                {report.status === "READY"
                  ? t("Re-run check", "إعادة الفحص")
                  : t("Analyze prices", "تحليل الأسعار")}
              </button>
            </>
          )}
          {report.status === "READY" && (
            <>
              <div className="stat-grid">
                {[
                  ["Rows", report.summary.totalRows],
                  ["Matched", report.summary.matchedRows],
                  ["Unmatched", report.summary.unmatchedRows],
                  ["Ambiguous", report.summary.ambiguousRows],
                  ["Invalid", report.summary.invalidRows],
                ].map(([k, v]) => (
                  <div className="stat" key={k}>
                    <span>{k}</span>
                    <strong>{v}</strong>
                  </div>
                ))}
              </div>
              <div className="actions wrap sales-check-toolbar">
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    open(report.id, 0, e.target.value, query);
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
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <input
                  placeholder={t(
                    "Search part or description",
                    "بحث عن صنف أو وصف",
                  )}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button onClick={() => open(report.id, 0, filter, query)}>
                  {t("Search", "بحث")}
                </button>
                <button
                  onClick={() =>
                    run(async () => {
                      const x = await api(
                        `sales-price-checks/${report.id}/excel`,
                        "POST",
                        {},
                      );
                      setExports((v) => [...v, x]);
                    })
                  }
                >
                  Excel
                </button>
                <button
                  onClick={() =>
                    run(async () => {
                      const x = await api(
                        `sales-price-checks/${report.id}/pdf`,
                        "POST",
                        {},
                      );
                      setExports((v) => [...v, x]);
                    })
                  }
                >
                  PDF
                </button>
                {exports.map((x) =>
                  x.status === "DONE" ? (
                    <a
                      key={x.id}
                      href={appPath(
                        `/api/v1/sales-price-check-exports/${x.id}/download`,
                      )}
                    >
                      {t("Download", "تنزيل")} {x.format}
                    </a>
                  ) : (
                    <span key={x.id}>
                      {x.format}: {x.status}
                    </span>
                  ),
                )}
              </div>
              <div className="table-scroll sales-check-table-wrap">
                <table className="sales-check-table">
                  <thead>
                    <tr>
                      {[
                        "#",
                        "Source part",
                        "Matched part",
                        "Description",
                        "Sales price",
                        "App list price",
                        "Discount %",
                        "Item Check",
                        "Match",
                        "Status / reason",
                      ].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r: any) => (
                      <tr key={r.id}>
                        <td data-label="#">{r.row_number}</td>
                        <td data-label="Source part" className="part-cell">
                          {r.source_part}
                        </td>
                        <td data-label="Matched part" className="part-cell">
                          {r.matched_part || "—"}
                        </td>
                        <td
                          data-label="Description"
                          className="description-cell"
                          title={r.description}
                        >
                          {r.description || "—"}
                        </td>
                        <td data-label="Sales price" className="number-cell">
                          {money(r.sales_price)}
                        </td>
                        <td data-label="App list price" className="number-cell">
                          {money(r.list_price)}
                        </td>
                        <td data-label="Discount %" className="number-cell">
                          {money(r.discount_percent)}
                        </td>
                        <td data-label="Item Check">
                          <span
                            className={`sales-check-badge ${r.product_id ? "checked" : "not-matched"}`}
                          >
                            {r.item_check}
                          </span>
                        </td>
                        <td data-label="Match">{r.match_type}</td>
                        <td
                          data-label="Status / reason"
                          className="status-cell"
                        >
                          <span
                            className={`pill ${r.status === "MATCHED" ? "" : "warning"}`}
                          >
                            {r.status}
                          </span>
                          {r.error && <small>{r.error}</small>}
                          <details>
                            <summary>{t("Source row", "صف المصدر")}</summary>
                            <pre>{JSON.stringify(r.raw, null, 2)}</pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions">
                <button
                  disabled={page === 0}
                  onClick={() => open(report.id, page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} · {report.resultCount} rows
                </span>
                <button
                  disabled={(page + 1) * 50 >= report.resultCount}
                  onClick={() => open(report.id, page + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
