"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";

const autoMap = (columns: string[], names: string[]) =>
  columns.find((column) =>
    names.includes(column.toLowerCase().replace(/[^a-z0-9]/g, "")),
  ) || "";
const running = new Set(["UPLOADED", "PROCESSING"]);

type MappingState = {
  partNumber: string;
  quantity: string;
  description: string;
  unitPrice: string;
  lineTotal: string;
};

const blankMapping = (): MappingState => ({
  partNumber: "",
  quantity: "",
  description: "",
  unitPrice: "",
  lineTotal: "",
});
const mappingFields: Array<{
  key: keyof MappingState;
  en: string;
  ar: string;
  required: boolean;
}> = [
  { key: "partNumber", en: "Part Number", ar: "رقم الصنف", required: true },
  { key: "quantity", en: "Quantity", ar: "الكمية", required: true },
  { key: "description", en: "Description", ar: "الوصف", required: false },
  { key: "unitPrice", en: "Unit Price", ar: "سعر الوحدة", required: false },
  { key: "lineTotal", en: "Line Total", ar: "الإجمالي", required: false },
];

export default function QuantityFinder({ t }: { t: Translate }) {
  const [reports, setReports] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [mapping, setMapping] = useState<MappingState>(blankMapping());
  const [view, setView] = useState("GROUPS");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("PART_ASC");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exports, setExports] = useState<any[]>([]);
  const [panel, setPanel] = useState<"UPLOAD" | "RESULTS" | "HISTORY">(
    "UPLOAD",
  );
  const [selectedGroup, setSelectedGroup] = useState("");
  const [comparison, setComparison] = useState<string[]>([]);

  const load = () => api("quantity-finder").then(setReports);
  const applyAutoMapping = (next: any) =>
    setMapping(
      Object.keys(next.mapping || {}).length
        ? {
            ...blankMapping(),
            ...next.mapping,
          }
        : {
            partNumber: autoMap(next.columns || [], [
              "itemcode",
              "partnumber",
              "partreference",
            ]),
            quantity: autoMap(next.columns || [], ["qty", "quantity"]),
            description: autoMap(next.columns || [], [
              "description",
              "itemdescription",
              "details",
            ]),
            unitPrice: autoMap(next.columns || [], [
              "unitprice",
              "price",
              "rate",
              "unitcost",
            ]),
            lineTotal: autoMap(next.columns || [], [
              "linetotal",
              "total",
              "amount",
              "extendedprice",
            ]),
          },
    );
  const open = async (
    id: string,
    p = 0,
    nextView = view,
    q = query,
    nextSort = sort,
    group = selectedGroup,
  ) => {
    const params = new URLSearchParams({
      page: String(p),
      pageSize: "50",
      view: nextView,
      q,
      sort: nextSort,
    });
    if (group) params.set("group", group);
    const next: any = await api(`quantity-finder/${id}?${params}`);
    setReport(next);
    setPage(p);
    applyAutoMapping(next);
    setPanel("RESULTS");
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
      () => open(report.id, page, view, query, sort, selectedGroup).catch(() => {}),
      1800,
    );
    return () => clearInterval(timer);
  }, [report?.id, report?.status, page, view, query, sort, selectedGroup]);
  useEffect(() => {
    if (!exports.some((item) => !["DONE", "FAILED"].includes(item.status)))
      return;
    const timer = setInterval(
      () =>
        Promise.all(
          exports.map((item) =>
            ["DONE", "FAILED"].includes(item.status)
              ? item
              : api("quantity-finder-exports/" + item.id),
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
      setSelectedGroup("");
      setComparison([]);
      setQuery("");
      setSort("PART_ASC");
      setView("GROUPS");
      await open(result.id, 0, "GROUPS", "", "PART_ASC", "");
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
  const comparisonRows = useMemo(() => {
    if (!report?.rows || view !== "GROUPS") return [];
    return comparison
      .map((part) =>
        report.rows.find((row: any) => row.source_part === part) ?? null,
      )
      .filter(Boolean);
  }, [comparison, report?.rows, view]);
  const resetFilters = () => {
    setQuery("");
    setSort("PART_ASC");
    setSelectedGroup("");
    setComparison([]);
    if (report) void open(report.id, 0, "GROUPS", "", "PART_ASC", "");
  };
  const toggleCompare = (part: string) =>
    setComparison((current) =>
      current.includes(part)
        ? current.filter((value) => value !== part)
        : [...current.slice(-2), part],
    );
  const showDetailColumns =
    !!report?.mapping?.description ||
    !!report?.mapping?.unitPrice ||
    !!report?.mapping?.lineTotal;

  return (
    <div className="sales-check-shell">
      <section className="sales-check-panel quantity-finder-tabs">
        <div className="actions wrap">
          {[
            ["UPLOAD", "Upload quantity file", "رفع ملف الكميات"],
            ["RESULTS", "Results / analysis", "النتائج / التحليل"],
            ["HISTORY", "Report history", "سجل التقارير"],
          ].map(([key, en, ar]) => (
            <button
              key={key}
              className={panel === key ? "primary" : ""}
              onClick={() => setPanel(key as typeof panel)}
            >
              {t(en, ar)}
            </button>
          ))}
        </div>
      </section>

      {panel === "UPLOAD" && (
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
          <p className="muted">
            {t(
              "You can also map description, unit price, and line total columns for deeper comparison.",
              "يمكنك أيضاً ربط أعمدة الوصف وسعر الوحدة والإجمالي لتحليل أعمق.",
            )}
          </p>
        </section>
      )}

      {panel === "HISTORY" && (
        <section className="sales-check-panel">
          <div className="section-title">
            <div>
              <h3>{t("Report history", "سجل التقارير")}</h3>
              <p className="muted">
                {t(
                  "Open any report, or delete files you no longer need.",
                  "افتح أي تقرير أو احذف الملفات التي لم تعد تحتاجها.",
                )}
              </p>
            </div>
          </div>
          {!reports.length ? (
            <div className="empty-state">
              {t("No uploaded reports yet.", "لا توجد تقارير مرفوعة بعد.")}
            </div>
          ) : (
            <div className="quantity-history-list">
              {reports.map((item) => (
                <article className="quantity-history-card" key={item.id}>
                  <div>
                    <strong>{item.filename}</strong>
                    <small>
                      {new Date(item.created_at).toLocaleString()} · {item.status}
                    </small>
                  </div>
                  <div className="actions wrap">
                    <button onClick={() => void open(item.id)}>
                      {t("Open", "فتح")}
                    </button>
                    <button
                      className="danger"
                      disabled={busy || running.has(item.status)}
                      onClick={() =>
                        void run(async () => {
                          await api(`quantity-finder/${item.id}`, "DELETE");
                          if (report?.id === item.id) {
                            setReport(null);
                            setSelectedGroup("");
                            setComparison([]);
                          }
                        })
                      }
                    >
                      {t("Delete", "حذف")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {panel === "RESULTS" && !report && (
        <section className="sales-check-panel">
          <div className="empty-state">
            <h2>{t("No active report", "لا يوجد تقرير نشط")}</h2>
            <p>
              {t(
                "Upload a file or open one from Report history.",
                "ارفع ملفاً أو افتح تقريراً من سجل التقارير.",
              )}
            </p>
          </div>
        </section>
      )}

      {report && panel === "RESULTS" && (
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
              <div className="sales-check-map quantity-mapping-grid">
                {mappingFields.map((field) => (
                  <label key={field.key}>
                    {t(field.en, field.ar)}
                    <select
                      value={mapping[field.key]}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          [field.key]: e.target.value,
                        })
                      }
                    >
                      <option value="">
                        {field.required ? "—" : t("Skip", "تخطي")}
                      </option>
                      {report.columns.map((column: string) => (
                        <option key={column}>{column}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <button
                  className="primary"
                  disabled={busy || !mapping.partNumber || !mapping.quantity}
                  onClick={() =>
                    void run(async () => {
                      await api(`quantity-finder/${report.id}/analyze`, "POST", {
                        version: report.version,
                        partNumber: mapping.partNumber,
                        quantity: mapping.quantity,
                        ...(mapping.description
                          ? { description: mapping.description }
                          : {}),
                        ...(mapping.unitPrice
                          ? { unitPrice: mapping.unitPrice }
                          : {}),
                        ...(mapping.lineTotal
                          ? { lineTotal: mapping.lineTotal }
                          : {}),
                      });
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

              {!!comparisonRows.length && (
                <section className="sales-check-panel">
                  <div className="section-title">
                    <div>
                      <h3>{t("Compare selected parts", "مقارنة الأصناف المحددة")}</h3>
                      <p className="muted">
                        {t(
                          "Pick up to three grouped rows to compare quantities quickly.",
                          "اختر حتى ثلاثة صفوف مجمعة للمقارنة السريعة.",
                        )}
                      </p>
                    </div>
                    <button onClick={() => setComparison([])}>
                      {t("Clear comparison", "مسح المقارنة")}
                    </button>
                  </div>
                  <div className="quantity-compare-grid">
                    {comparisonRows.map((row: any) => (
                      <div className="quantity-compare-card" key={row.source_part}>
                        <strong>{row.source_part}</strong>
                        <span>{t("Sold", "المباع")}: {row.sold_quantity}</span>
                        <span>{t("Returned", "المرتجع")}: {row.returned_quantity}</span>
                        <span>{t("Net", "الصافي")}: {row.net_quantity}</span>
                        <span>{t("Rows", "الصفوف")}: {row.occurrences}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="sales-check-panel">
                <div className="actions wrap">
                  <button
                    className={view === "GROUPS" ? "primary" : ""}
                    onClick={() => {
                      setView("GROUPS");
                      void open(report.id, 0, "GROUPS", query, sort, selectedGroup);
                    }}
                  >
                    {t("Grouped results", "النتائج المجمعة")}
                  </button>
                  <button
                    className={view === "INVALID" ? "primary" : ""}
                    onClick={() => {
                      setView("INVALID");
                      setSelectedGroup("");
                      void open(report.id, 0, "INVALID", query, sort, "");
                    }}
                  >
                    {t("Invalid rows", "الصفوف غير الصالحة")}
                  </button>
                  <input
                    placeholder={t("Search exact part text", "بحث في رقم الصنف")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button
                    onClick={() =>
                      void open(report.id, 0, view, query, sort, selectedGroup)
                    }
                  >
                    {t("Search", "بحث")}
                  </button>
                  <button onClick={resetFilters}>
                    {t("Clear filters", "مسح التصفية")}
                  </button>
                  {view === "GROUPS" && (
                    <select
                      value={sort}
                      onChange={(e) => {
                        setSort(e.target.value);
                        void open(
                          report.id,
                          0,
                          view,
                          query,
                          e.target.value,
                          selectedGroup,
                        );
                      }}
                    >
                      <option value="PART_ASC">Part A-Z</option>
                      <option value="SOLD_DESC">Sold ↓</option>
                      <option value="RETURNED_DESC">Returned ↓</option>
                      <option value="NET_DESC">Net ↓</option>
                      <option value="OCCURRENCES_DESC">Occurrences ↓</option>
                    </select>
                  )}
                  <button onClick={() => void startExport("excel")}>Excel</button>
                  <button onClick={() => void startExport("pdf")}>PDF</button>
                  <button
                    className="danger"
                    onClick={() =>
                      void run(async () => {
                        await api(`quantity-finder/${report.id}`, "DELETE");
                        setReport(null);
                        setSelectedGroup("");
                        setComparison([]);
                      })
                    }
                  >
                    {t("Delete report", "حذف التقرير")}
                  </button>
                </div>
                <div className="sales-check-table-wrap quantity-finder-table-wrap">
                  <table className="sales-check-table quantity-finder-table">
                    <thead>
                      <tr>
                        {(view === "GROUPS"
                          ? [
                              "Compare",
                              "Part Number (exact)",
                              "Sold",
                              "Returned",
                              "Net",
                              "Occurrences",
                              "Actions",
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
                            <td data-label="Compare">
                              <input
                                type="checkbox"
                                checked={comparison.includes(row.source_part)}
                                onChange={() => toggleCompare(row.source_part)}
                              />
                            </td>
                            <td data-label="Part Number (exact)" className="part-cell">
                              {row.source_part}
                            </td>
                            <td data-label="Sold" className="number-cell">
                              {row.sold_quantity}
                            </td>
                            <td data-label="Returned" className="number-cell">
                              {row.returned_quantity}
                            </td>
                            <td data-label="Net" className="number-cell">
                              {row.net_quantity}
                            </td>
                            <td data-label="Occurrences" className="number-cell">
                              {row.occurrences}
                            </td>
                            <td data-label="Actions">
                              <button
                                onClick={() => {
                                  setSelectedGroup(row.source_part);
                                  void open(
                                    report.id,
                                    page,
                                    "GROUPS",
                                    query,
                                    sort,
                                    row.source_part,
                                  );
                                }}
                              >
                                {t("View rows", "عرض الصفوف")}
                              </button>
                            </td>
                          </tr>
                        ) : (
                          <tr key={row.id}>
                            <td data-label="Row">{row.row_number}</td>
                            <td data-label="Part Number" className="part-cell">
                              {row.source_part}
                            </td>
                            <td data-label="Quantity">
                              {report.mapping?.quantity
                                ? String(row.raw?.[report.mapping.quantity] ?? "")
                                : ""}
                            </td>
                            <td data-label="Reason">
                              <span className="status-badge danger">{row.error}</span>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="actions wrap">
                  <button
                    disabled={!page}
                    onClick={() =>
                      void open(report.id, page - 1, view, query, sort, selectedGroup)
                    }
                  >
                    {t("Previous", "السابق")}
                  </button>
                  <span>
                    {page + 1} / {Math.max(1, Math.ceil(report.resultCount / report.pageSize))}
                  </span>
                  <button
                    disabled={(page + 1) * report.pageSize >= report.resultCount}
                    onClick={() =>
                      void open(report.id, page + 1, view, query, sort, selectedGroup)
                    }
                  >
                    {t("Next", "التالي")}
                  </button>
                </div>
              </section>

              {selectedGroup && (
                <section className="sales-check-panel">
                  <div className="section-title">
                    <div>
                      <h3>
                        {t("Row drilldown", "تفاصيل الصفوف")} · {selectedGroup}
                      </h3>
                      <p className="muted">
                        {t(
                          "Compare the raw rows behind this grouped part before deciding what matters.",
                          "قارن الصفوف الأصلية خلف هذا الصنف المجمع قبل تحديد النتيجة المهمة.",
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedGroup("");
                        void open(report.id, page, "GROUPS", query, sort, "");
                      }}
                    >
                      {t("Clear row view", "إغلاق عرض الصفوف")}
                    </button>
                  </div>
                  {report.groupInsights && (
                    <div className="quantity-drilldown-summary">
                      <span>
                        {t("Descriptions", "الأوصاف")}:{" "}
                        {report.groupInsights.descriptionCount}
                      </span>
                      {report.groupInsights.unitPriceMin && (
                        <span>
                          {t("Unit price range", "نطاق سعر الوحدة")}:{" "}
                          {report.groupInsights.unitPriceMin} -{" "}
                          {report.groupInsights.unitPriceMax}
                        </span>
                      )}
                      {report.groupInsights.lineTotalSum && (
                        <span>
                          {t("Mapped total sum", "مجموع الإجمالي المرتبط")}:{" "}
                          {report.groupInsights.lineTotalSum}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="sales-check-table-wrap quantity-finder-table-wrap">
                    <table className="sales-check-table quantity-finder-table detail-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Type</th>
                          <th>Quantity</th>
                          {showDetailColumns && <th>Description</th>}
                          {report.mapping?.unitPrice && <th>Unit Price</th>}
                          {report.mapping?.lineTotal && <th>Line Total</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {report.groupRows.map((row: any) => (
                          <tr key={row.row_number}>
                            <td data-label="Row">{row.row_number}</td>
                            <td data-label="Type">{row.direction}</td>
                            <td data-label="Quantity">{row.absoluteQuantity}</td>
                            {showDetailColumns && (
                              <td data-label="Description">{row.description || "—"}</td>
                            )}
                            {report.mapping?.unitPrice && (
                              <td data-label="Unit Price">{row.unitPrice || "—"}</td>
                            )}
                            {report.mapping?.lineTotal && (
                              <td data-label="Line Total">{row.lineTotal || "—"}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {!!exports.length && (
        <section className="sales-check-panel">
          <h3>{t("Exports", "التصديرات")}</h3>
          <div className="actions wrap">
            {exports.map((item) =>
              item.status === "DONE" ? (
                <a
                  className="button"
                  key={item.id}
                  href={appPath(`/api/v1/quantity-finder-exports/${item.id}/download`)}
                >
                  {item.format} · {t("Download", "تنزيل")}
                </a>
              ) : (
                <span key={item.id} className="muted">
                  {item.format} ·{" "}
                  {item.status === "FAILED"
                    ? item.error
                    : t("Preparing export…", "جارٍ تجهيز التصدير…")}
                </span>
              ),
            )}
          </div>
        </section>
      )}

      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
