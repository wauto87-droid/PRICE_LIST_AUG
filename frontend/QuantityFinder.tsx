"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";

const autoMap = (columns: string[], names: string[]) =>
  columns.find((column) =>
    names.includes(column.toLowerCase().replace(/[^a-z0-9]/g, "")),
  ) || "";
const running = new Set(["UPLOADED", "PROCESSING"]);

export default function QuantityFinder({ t }: { t: Translate }) {
  const [reports, setReports] = useState<any[]>([]),
    [report, setReport] = useState<any>(null),
    [mapping, setMapping] = useState({ partNumber: "", quantity: "" }),
    [view, setView] = useState("GROUPS"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("PART_ASC"),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [exports, setExports] = useState<any[]>([]);
  const load = () => api("quantity-finder").then(setReports);
  const open = async (
    id: string,
    p = 0,
    nextView = view,
    q = query,
    nextSort = sort,
  ) => {
    const params = new URLSearchParams({
      page: String(p),
      pageSize: "50",
      view: nextView,
      q,
      sort: nextSort,
    });
    const next: any = await api(`quantity-finder/${id}?${params}`);
    setReport(next);
    setPage(p);
    setMapping(
      Object.keys(next.mapping || {}).length
        ? next.mapping
        : {
            partNumber: autoMap(next.columns || [], [
              "itemcode",
              "partnumber",
              "partreference",
            ]),
            quantity: autoMap(next.columns || [], ["qty", "quantity"]),
          },
    );
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!reports.some((r) => running.has(r.status))) return;
    const timer = setInterval(() => load().catch(() => {}), 1800);
    return () => clearInterval(timer);
  }, [reports]);
  useEffect(() => {
    if (!report || !running.has(report.status)) return;
    const timer = setInterval(
      () => open(report.id, page).catch(() => {}),
      1800,
    );
    return () => clearInterval(timer);
  }, [report?.id, report?.status]);
  useEffect(() => {
    if (!exports.some((e) => !["DONE", "FAILED"].includes(e.status))) return;
    const timer = setInterval(
      () =>
        Promise.all(
          exports.map((e) =>
            ["DONE", "FAILED"].includes(e.status)
              ? e
              : api("quantity-finder-exports/" + e.id),
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
  const upload = (file?: File) =>
    file &&
    run(async () => {
      const form = new FormData();
      form.set("file", file);
      const result: any = await api("quantity-finder", "POST", form);
      await open(result.id);
    });
  const startExport = (format: "excel" | "pdf") =>
    run(async () => {
      const job: any = await api(
        `quantity-finder/${report.id}/${format}`,
        "POST",
      );
      setExports((items) => [{ ...job, report_id: report.id }, ...items]);
    });
  const progress = report?.progress || {};
  return (
    <div className="sales-check-shell">
      <section className="sales-check-panel">
        <h3>{t("Upload quantity file", "رفع ملف الكميات")}</h3>
        <p className="muted">
          {t(
            "Exact source part numbers are grouped. Spaces, case, dots, slashes, and hyphens remain different.",
            "يتم تجميع أرقام الأصناف المتطابقة حرفياً فقط، وتبقى المسافات وحالة الأحرف والنقاط والشرطات مختلفة.",
          )}
        </p>
        <input
          type="file"
          accept=".xls,.xlsx,.csv"
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        {error && <div className="notice error">{error}</div>}
      </section>
      <section className="sales-check-panel">
        <h3>{t("Report history", "سجل التقارير")}</h3>
        <div className="actions wrap">
          {reports.map((r) => (
            <button
              key={r.id}
              className={report?.id === r.id ? "primary" : ""}
              onClick={() => void open(r.id)}
            >
              {r.filename} · {r.status}
            </button>
          ))}
        </div>
      </section>
      {report && (
        <>
          {running.has(report.status) && (
            <section className="sales-check-panel">
              <h3>
                {progress.phase === "GROUPING"
                  ? t(
                      "Grouping exact part numbers",
                      "تجميع أرقام الأصناف المتطابقة",
                    )
                  : t("Reading spreadsheet", "قراءة ملف الإكسل")}
              </h3>
              <progress max="100" value={progress.percentage ?? undefined} />
              <p>
                {progress.processedRows || 0} /{" "}
                {progress.totalRows || report.summary?.totalRows || 0} ·{" "}
                {progress.remainingSeconds == null
                  ? t("Estimating remaining time…", "جاري تقدير الوقت المتبقي…")
                  : t(
                      `About ${progress.remainingSeconds}s remaining`,
                      `حوالي ${progress.remainingSeconds} ثانية متبقية`,
                    )}
              </p>
            </section>
          )}
          {report.status === "AWAITING_MAPPING" && (
            <section className="sales-check-panel">
              <h3>{t("Map columns", "ربط الأعمدة")}</h3>
              <div className="sales-check-map">
                <label>
                  {t("Part Number", "رقم الصنف")}
                  <select
                    value={mapping.partNumber}
                    onChange={(e) =>
                      setMapping({ ...mapping, partNumber: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {report.columns.map((c: string) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Quantity", "الكمية")}
                  <select
                    value={mapping.quantity}
                    onChange={(e) =>
                      setMapping({ ...mapping, quantity: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {report.columns.map((c: string) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={busy || !mapping.partNumber || !mapping.quantity}
                  onClick={() =>
                    void run(async () => {
                      await api(
                        `quantity-finder/${report.id}/analyze`,
                        "POST",
                        { version: report.version, ...mapping },
                      );
                      await open(report.id);
                    })
                  }
                >
                  {t("Analyze quantities", "تحليل الكميات")}
                </button>
              </div>
            </section>
          )}
          {report.status === "FAILED" && (
            <div className="notice error">{report.error}</div>
          )}
          {report.status === "READY" && (
            <>
              <section className="sales-check-summary">
                {[
                  ["Rows", report.summary.totalRows],
                  ["Groups", report.summary.groupCount],
                  ["Sold", report.summary.soldQuantity],
                  ["Returned", report.summary.returnedQuantity],
                  ["Net", report.summary.netQuantity],
                  ["Invalid", report.summary.invalidRows],
                ].map(([label, value]) => (
                  <div className="sales-check-stat" key={label as string}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </section>
              <section className="sales-check-panel">
                <div className="actions wrap">
                  <button
                    onClick={() => {
                      setView("GROUPS");
                      void open(report.id, 0, "GROUPS");
                    }}
                  >
                    {t("Grouped results", "النتائج المجمعة")}
                  </button>
                  <button
                    onClick={() => {
                      setView("INVALID");
                      void open(report.id, 0, "INVALID");
                    }}
                  >
                    {t("Invalid rows", "الصفوف غير الصالحة")}
                  </button>
                  <input
                    placeholder={t(
                      "Search exact part text",
                      "بحث في رقم الصنف",
                    )}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button
                    onClick={() => void open(report.id, 0, view, query, sort)}
                  >
                    {t("Search", "بحث")}
                  </button>
                  {view === "GROUPS" && (
                    <select
                      value={sort}
                      onChange={(e) => {
                        setSort(e.target.value);
                        void open(report.id, 0, view, query, e.target.value);
                      }}
                    >
                      <option value="PART_ASC">Part A–Z</option>
                      <option value="SOLD_DESC">Sold ↓</option>
                      <option value="RETURNED_DESC">Returned ↓</option>
                      <option value="NET_DESC">Net ↓</option>
                      <option value="OCCURRENCES_DESC">Occurrences ↓</option>
                    </select>
                  )}
                  <button onClick={() => void startExport("excel")}>
                    Excel
                  </button>
                  <button onClick={() => void startExport("pdf")}>PDF</button>
                  <button
                    className="danger"
                    onClick={() =>
                      void run(async () => {
                        await api(`quantity-finder/${report.id}`, "DELETE");
                        setReport(null);
                      })
                    }
                  >
                    {t("Delete", "حذف")}
                  </button>
                </div>
                <div className="sales-check-table-wrap">
                  <table className="sales-check-table">
                    <thead>
                      <tr>
                        {(view === "GROUPS"
                          ? [
                              "Part Number (exact)",
                              "Sold",
                              "Returned",
                              "Net",
                              "Occurrences",
                            ]
                          : ["Row", "Part Number", "Quantity", "Reason"]
                        ).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row: any) =>
                        view === "GROUPS" ? (
                          <tr key={row.id}>
                            <td>{row.source_part}</td>
                            <td>{row.sold_quantity}</td>
                            <td>{row.returned_quantity}</td>
                            <td>{row.net_quantity}</td>
                            <td>{row.occurrences}</td>
                          </tr>
                        ) : (
                          <tr key={row.id}>
                            <td>{row.row_number}</td>
                            <td>{row.source_part}</td>
                            <td>
                              {report.mapping?.quantity
                                ? String(
                                    row.raw?.[report.mapping.quantity] ?? "",
                                  )
                                : ""}
                            </td>
                            <td>
                              <span className="status-badge danger">
                                {row.error}
                              </span>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="actions">
                  <button
                    disabled={!page}
                    onClick={() => void open(report.id, page - 1)}
                  >
                    {t("Previous", "السابق")}
                  </button>
                  <span>{page + 1}</span>
                  <button
                    disabled={(page + 1) * 50 >= report.resultCount}
                    onClick={() => void open(report.id, page + 1)}
                  >
                    {t("Next", "التالي")}
                  </button>
                </div>
                {exports.map((job) => (
                  <div key={job.id} className="notice">
                    {job.format}: {job.status}{" "}
                    {job.status === "DONE" && (
                      <a
                        href={appPath(
                          `/api/v1/quantity-finder-exports/${job.id}/download`,
                        )}
                      >
                        {t("Download", "تنزيل")}
                      </a>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
