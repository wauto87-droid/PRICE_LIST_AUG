"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";
import {
  formatDeliveryDocNo,
  formatDeliveryDate,
} from "@/backend/pricing/normalize";
import { showConfirm } from "./confirm";
import { deliveryQuoteMappingDefaults } from "./delivery-quote-mapping";

type HistoryScope = "converted" | "admin";
type HistoryFilters = {
  query: string;
  status: string;
  datePreset: string;
  from: string;
  to: string;
  sort: string;
  page: number;
};
const defaultHistoryFilters = (): HistoryFilters => ({
  query: "",
  status: "ALL",
  datePreset: "all",
  from: "",
  to: "",
  sort: "newest",
  page: 0,
});
const emptyHistory = { items: [] as any[], page: 0, pageSize: 20, total: 0, totalPages: 1 };

export default function DeliveryQuoteImport({
  t,
  user,
  online,
  onImported,
}: {
  t: Translate;
  user: any;
  online: boolean;
  onImported: (quote: any) => void;
}) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [job, setJob] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("all");
  const [showCustomerColumn, setShowCustomerColumn] = useState(false);
  const [customerCodeDraft, setCustomerCodeDraft] = useState("");
  const [tab, setTab] = useState<"IMPORT" | "OUTPUTS" | "ADMIN">("OUTPUTS");
  const [outputFilters, setOutputFilters] = useState(defaultHistoryFilters);
  const [adminFilters, setAdminFilters] = useState(defaultHistoryFilters);
  const [outputHistory, setOutputHistory] = useState(emptyHistory);
  const [adminHistory, setAdminHistory] = useState(emptyHistory);
  const [historyBusy, setHistoryBusy] = useState(false);
  const historyGeneration = useRef({ converted: 0, admin: 0 });
  const [mapping, setMapping] = useState({
    date: "",
    docNo: "",
    customerName: "",
    customerCode: "",
    partNumber: "",
    description: "",
    quantity: "",
    price: "",
  });

  const loadJobs = () => api("delivery-quote-imports").then(setJobs);
  const loadHistory = async (scope: HistoryScope, filters: HistoryFilters) => {
    const generation = ++historyGeneration.current[scope];
    setHistoryBusy(true);
    try {
      const params = new URLSearchParams({
        scope,
        query: filters.query.trim(),
        status: scope === "admin" ? filters.status : "ALL",
        datePreset: filters.datePreset,
        sort: filters.sort,
        page: String(filters.page),
        pageSize: "20",
      });
      if (filters.datePreset === "custom") {
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
      }
      const result: any = await api(`delivery-quote-imports?${params}`);
      if (generation !== historyGeneration.current[scope]) return;
      if (scope === "converted") setOutputHistory(result);
      else setAdminHistory(result);
    } finally {
      if (generation === historyGeneration.current[scope]) setHistoryBusy(false);
    }
  };
  const open = async (id: string, nextFilter = filter) => {
    const next: any = await api(
      `delivery-quote-imports/${id}?page=0&pageSize=100&filter=${encodeURIComponent(nextFilter)}`,
    );
    setJob(next);
    setFilter(nextFilter);
    setShowCustomerColumn(false);
    const columns = next.summary?.columns || [];
    setMapping(deliveryQuoteMappingDefaults(columns, next.mapping));
    setCustomerCodeDraft(String((next.header || next.summary)?.customerCode || ""));
    setSelected({});
  };

  useEffect(() => {
    void loadJobs().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (tab !== "OUTPUTS") return;
    const timer = window.setTimeout(
      () => void loadHistory("converted", outputFilters).catch((e) => setError(e.message)),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [tab, outputFilters]);

  useEffect(() => {
    if (tab !== "ADMIN" || !user.permissions.includes("QUOTE_VIEW_ALL")) return;
    const timer = window.setTimeout(
      () => void loadHistory("admin", adminFilters).catch((e) => setError(e.message)),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [tab, adminFilters, user.permissions]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await loadJobs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function applyMapping() {
    const payload = {
      version: job.version,
      date: mapping.date,
      docNo: mapping.docNo,
      customerName: mapping.customerName,
      ...(mapping.customerCode ? { customerCode: mapping.customerCode } : {}),
      partNumber: mapping.partNumber,
      description: mapping.description,
      quantity: mapping.quantity,
      ...(mapping.price ? { price: mapping.price } : {}),
    };
    await api(`delivery-quote-imports/${job.id}/mapping`, "POST", payload);
    await open(job.id);
  }

  async function reopenForMapping() {
    if (!job) return;
    if (
      !(await showConfirm(
        t(
          "Create a correction copy for mapping? The existing quotation and import will remain unchanged.",
          "إعادة فتح هذا الاستيراد للربط؟ سيتم حذف عرض السعر المسودة غير المعدل. لا يمكن إعادة فتح عروض الأسعار المعدلة أو المصدرة.",
        ),
      ))
    )
      return;
    await run(async () => {
      const corrected: any = await api(`delivery-quote-imports/${job.id}/correction`, "POST", {
        version: job.version,
      });
      setTab("IMPORT");
      await open(corrected.id);
    });
  }

  const selectedIds = Object.entries(selected)
    .filter(([, value]) => value)
    .map(([id]) => id);
  const isAdmin = user.permissions.includes("QUOTE_VIEW_ALL");
  const activeJobs = jobs.filter((item) => item.status !== "COMPLETED");
  const headerSummary = job?.header || job?.summary || {};
  const conflictingCustomers = Array.isArray(headerSummary.customers)
    ? headerSummary.customers
    : [];
  const hasCustomerConflict = conflictingCustomers.length > 1;
  const visibleRowIds = (job?.rows || []).map((row: any) => row.id);
  const allVisibleSelected =
    visibleRowIds.length > 0 && visibleRowIds.every((id: string) => selected[id]);
  const someVisibleSelected =
    visibleRowIds.some((id: string) => selected[id]) && !allVisibleSelected;
  const toggleVisibleRows = (checked: boolean) =>
    setSelected((current) => {
      const next = { ...current };
      for (const id of visibleRowIds) next[id] = checked;
      return next;
    });
  const getRowUpdates = (ids?: string[]) => {
    const targetIds = ids && ids.length ? ids : (job?.rows || []).map((r: any) => r.id);
    const rowUpdates: Record<string, { quantity?: string; unitPriceExcl?: string }> = {};
    for (const r of job?.rows || []) {
      if (targetIds.includes(r.id)) {
        rowUpdates[r.id] = {
          quantity: r.line_input?.quantity !== undefined ? String(r.line_input.quantity) : undefined,
          unitPriceExcl: r.line_input?.unitPriceExcl !== undefined ? String(r.line_input.unitPriceExcl) : undefined,
        };
      }
    }
    return rowUpdates;
  };
  const resolutionLabel = (resolution: string) =>
    resolution === "MATCHED_CATALOG"
      ? t("Catalog item", "صنف من الكتالوج")
      : resolution === "UNMATCHED_CUSTOM"
        ? t("Custom item", "صنف مخصص")
        : t("Needs review", "يحتاج مراجعة");
  const completionLabel = (row: any) =>
    row.action === "REMOVE"
      ? t("Removed", "محذوف")
      : row.issues?.length
        ? t("Needs work", "يحتاج عمل")
        : row.completed
        ? t("Complete", "مكتمل")
        : t("Needs work", "يحتاج عمل");
  const setHistoryFilters = (
    scope: HistoryScope,
    patch: Partial<HistoryFilters>,
  ) => {
    const update = (current: HistoryFilters) => ({
      ...current,
      ...patch,
      page: patch.page ?? 0,
    });
    if (scope === "converted") setOutputFilters(update);
    else setAdminFilters(update);
  };
  const deliveryReferences = (item: any) =>
    Array.isArray(item.delivery_references)
      ? item.delivery_references.join(", ")
      : "";
  const renderHistory = (scope: HistoryScope) => {
    const filters = scope === "converted" ? outputFilters : adminFilters;
    const history = scope === "converted" ? outputHistory : adminHistory;
    return (
      <div className="delivery-history">
        <div className="delivery-history-controls">
          <label className="delivery-history-search">
            {t("Search history", "البحث في السجل")}
            <input
              value={filters.query}
              placeholder={t(
                "Filename, quotation, customer or delivery reference",
                "اسم الملف أو العرض أو العميل أو مرجع التسليم",
              )}
              onChange={(event) =>
                setHistoryFilters(scope, { query: event.target.value })
              }
            />
          </label>
          <label>
            {t("Date", "التاريخ")}
            <select
              value={filters.datePreset}
              onChange={(event) =>
                setHistoryFilters(scope, { datePreset: event.target.value })
              }
            >
              <option value="all">{t("All dates", "كل التواريخ")}</option>
              <option value="today">{t("Today", "اليوم")}</option>
              <option value="last7">{t("Last 7 days", "آخر 7 أيام")}</option>
              <option value="last30">{t("Last 30 days", "آخر 30 يوماً")}</option>
              <option value="month">{t("This month", "هذا الشهر")}</option>
              <option value="custom">{t("Custom range", "نطاق مخصص")}</option>
            </select>
          </label>
          {scope === "admin" && (
            <label>
              {t("Status", "الحالة")}
              <select
                value={filters.status}
                onChange={(event) =>
                  setHistoryFilters(scope, { status: event.target.value })
                }
              >
                <option value="ALL">{t("All statuses", "كل الحالات")}</option>
                <option value="UPLOADED">UPLOADED</option>
                <option value="PROCESSING">PROCESSING</option>
                <option value="AWAITING_MAPPING">AWAITING_MAPPING</option>
                <option value="AWAITING_REVIEW">AWAITING_REVIEW</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </label>
          )}
          <label>
            {t("Sort", "الترتيب")}
            <select
              value={filters.sort}
              onChange={(event) =>
                setHistoryFilters(scope, { sort: event.target.value })
              }
            >
              <option value="newest">{t("Newest first", "الأحدث أولاً")}</option>
              <option value="oldest">{t("Oldest first", "الأقدم أولاً")}</option>
              <option value="filename_asc">{t("Filename A–Z", "اسم الملف أ–ي")}</option>
              <option value="filename_desc">{t("Filename Z–A", "اسم الملف ي–أ")}</option>
              <option value="customer_asc">{t("Customer A–Z", "العميل أ–ي")}</option>
              <option value="customer_desc">{t("Customer Z–A", "العميل ي–أ")}</option>
              <option value="quotation_asc">{t("Quotation ascending", "رقم العرض تصاعدي")}</option>
              <option value="quotation_desc">{t("Quotation descending", "رقم العرض تنازلي")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              scope === "converted"
                ? setOutputFilters(defaultHistoryFilters())
                : setAdminFilters(defaultHistoryFilters())
            }
          >
            {t("Clear filters", "مسح عوامل التصفية")}
          </button>
        </div>
        {filters.datePreset === "custom" && (
          <div className="delivery-history-range">
            <label>
              {t("From", "من")}
              <input
                type="date"
                value={filters.from}
                onChange={(event) =>
                  setHistoryFilters(scope, { from: event.target.value })
                }
              />
            </label>
            <label>
              {t("To", "إلى")}
              <input
                type="date"
                value={filters.to}
                onChange={(event) =>
                  setHistoryFilters(scope, { to: event.target.value })
                }
              />
            </label>
          </div>
        )}
        <div className="delivery-history-summary">
          <span>
            {history.total} {t("results", "نتيجة")}
          </span>
          {historyBusy && <span>{t("Loading…", "جارٍ التحميل…")}</span>}
        </div>
        <div className="quantity-history-list">
          {history.items.length ? (
            history.items.map((item: any) => (
              <article className="quantity-history-card delivery-history-card" key={item.id}>
                <div className="delivery-history-primary">
                  <strong>{item.filename}</strong>
                  <small>
                    {new Date(
                      scope === "converted" ? item.updated_at : item.created_at,
                    ).toLocaleString()} · {item.status}
                  </small>
                </div>
                <div className="delivery-history-details">
                  <span>
                    {t("Quotation", "عرض السعر")}: {item.quotation_number || "—"}
                  </span>
                  <span>
                    {t("Customer", "العميل")}: {item.customer_name || "—"}
                  </span>
                  <span>{t("Customer Code", "رمز العميل")}: {item.customer_code || "—"}</span>
                  <span title={deliveryReferences(item)}>
                    {t("Delivery reference", "مرجع التسليم")}: {deliveryReferences(item) || "—"}
                  </span>
                </div>
                <div className="actions wrap">
                  <button onClick={() => void open(item.id)}>
                    {t(
                      scope === "converted" ? "Open import" : "Open source",
                      scope === "converted" ? "فتح الاستيراد" : "فتح المصدر",
                    )}
                  </button>
                  {scope === "converted" ? (
                    <button
                      className="primary"
                      onClick={() =>
                        void run(async () => {
                          const quote = await api(`quotations/${item.quote_id}`);
                          onImported(quote);
                        })
                      }
                    >
                      {t("Open quotation", "فتح عرض السعر")}
                    </button>
                  ) : (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`delivery-quote-imports/${item.id}`, "DELETE");
                          if (job?.id === item.id) setJob(null);
                          await loadHistory("admin", adminFilters);
                        })
                      }
                    >
                      {t("Delete file", "حذف الملف")}
                    </button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              {historyBusy
                ? t("Loading history…", "جارٍ تحميل السجل…")
                : t("No records match these filters.", "لا توجد سجلات تطابق عوامل التصفية.")}
            </div>
          )}
        </div>
        {history.totalPages > 1 && (
          <div className="delivery-history-pagination">
            <button
              disabled={history.page <= 0 || historyBusy}
              onClick={() => setHistoryFilters(scope, { page: history.page - 1 })}
            >
              {t("Previous", "السابق")}
            </button>
            <span>
              {t("Page", "صفحة")} {history.page + 1} / {history.totalPages}
            </span>
            <button
              disabled={history.page + 1 >= history.totalPages || historyBusy}
              onClick={() => setHistoryFilters(scope, { page: history.page + 1 })}
            >
              {t("Next", "التالي")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="card">
      <div className="section-title">
        <div>
          <div className="eyebrow">
            {t("DELIVERY NOTE TO QUOTATION", "إذن التسليم إلى عرض سعر")}
          </div>
          <h2>{t("Import delivery note", "استيراد إذن تسليم")}</h2>
          <p className="muted">
            {t(
              "Upload a delivery-note Excel file, review rows, then create one editable quotation.",
              "ارفع ملف إذن تسليم، راجع الصفوف، ثم أنشئ عرض سعر واحد قابل للتعديل.",
            )}
          </p>
        </div>
      </div>
      <div className="actions wrap">
        {[
          ["OUTPUTS", "Converted quotations", "عروض الأسعار المحولة"],
          ["IMPORT", "Upload / review files", "رفع / مراجعة الملفات"],
          ...(isAdmin
            ? [["ADMIN", "Admin source files", "ملفات المصدر للإدارة"]]
            : []),
        ].map(([key, en, ar]) => (
          <button
            key={key}
            className={tab === key ? "primary" : ""}
            onClick={() => setTab(key as typeof tab)}
          >
            {t(en, ar)}
          </button>
        ))}
      </div>
      {tab === "IMPORT" && (
        <div className="actions wrap">
          <input
            type="file"
            accept=".xls,.xlsx,.csv"
            disabled={!online || busy}
            onChange={(e) =>
              void run(async () => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.set("file", file);
                const created: any = await api("delivery-quote-imports", "POST", form);
                setTab("IMPORT");
                await open(created.id);
              })
            }
          />
          {activeJobs.map((item) => (
            <button key={item.id} onClick={() => void open(item.id)}>
              {item.filename} · {item.status}
            </button>
          ))}
          {!activeJobs.length && (
            <div className="muted">
              {t(
                "No delivery-note files are waiting for mapping or review.",
                "لا توجد ملفات إذن تسليم بانتظار الربط أو المراجعة.",
              )}
            </div>
          )}
        </div>
      )}
      {tab === "OUTPUTS" && renderHistory("converted")}
      {tab === "ADMIN" && isAdmin && renderHistory("admin")}
      {job?.summary?.warnings?.length ? (
        <div className="notice">
          {job.summary.warnings.join(" ")}
        </div>
      ) : null}
      {job && (
        <div className="quantity-drilldown-summary">
          <span>
            {t("Customer", "العميل")}:{" "}
            {headerSummary.customerName ||
              t("Will be set from the mapped header", "سيتم تعيينه من الرأس المرتبط")}
          </span>
          <span>
            {t("Delivery rows", "صفوف التسليم")}: {job.summary?.totalRows || 0}
          </span>
          <span>{t("Customer Code", "رمز العميل")}: {headerSummary.customerCode || "—"}</span>
          <span>
            {t("Delivery references", "مراجع التسليم")}:{" "}
            {Array.isArray(headerSummary.docNos) && headerSummary.docNos.length
              ? headerSummary.docNos.join(", ")
              : "—"}
          </span>
        </div>
      )}
      {job?.status === "AWAITING_MAPPING" && (
        <div className="form-grid three">
          {[
            ["date", "Date", "التاريخ"],
            ["docNo", "Delivery no.", "رقم إذن التسليم"],
            ["customerName", "Customer name", "اسم العميل"],
            ["customerCode", "Customer Code (optional)", "رمز العميل (اختياري)"],
            ["partNumber", "Part number", "رقم الصنف"],
            ["description", "Description", "الوصف"],
            ["quantity", "Quantity", "الكمية"],
            ["price", "Price (optional)", "السعر (اختياري)"],
          ].map(([key, en, ar]) => (
            <label key={key}>
              {t(en, ar)}
              <select
                value={mapping[key as keyof typeof mapping]}
                onChange={(e) =>
                  setMapping({ ...mapping, [key]: e.target.value })
                }
              >
                <option value="">{t("Select column", "اختر العمود")}</option>
                {(job.summary?.columns || []).map((column: string) => (
                  <option key={column}>{column}</option>
                ))}
              </select>
            </label>
          ))}
          <button
            className="primary"
            disabled={busy || !mapping.customerName || !mapping.partNumber || !mapping.description || !mapping.quantity || !mapping.docNo || !mapping.date}
            onClick={() => void run(applyMapping)}
          >
            {t("Apply mapping", "تطبيق الربط")}
          </button>
        </div>
      )}
      {job?.status === "AWAITING_REVIEW" && (
        <>
          <div className="form-grid three">
            <label>{t("Customer Code (optional)", "رمز العميل (اختياري)")}<input value={customerCodeDraft} onChange={(e) => setCustomerCodeDraft(e.target.value)} placeholder={t("Used to highlight this customer's previous prices", "يُستخدم لتمييز الأسعار السابقة لهذا العميل")}/></label>
            <button disabled={busy || customerCodeDraft === String(headerSummary.customerCode || "")} onClick={() => void run(async () => { await api(`delivery-quote-imports/${job.id}/header`, "POST", { version: job.version, customerCode: customerCodeDraft }); await open(job.id, filter); })}>{t("Save Customer Code", "حفظ رمز العميل")}</button>
          </div>
          <div className="notice">
            {job.summary?.blockedReason
              ? job.summary.blockedReason
              : t(
                  "Review rows, remove anything unnecessary, complete custom rows, then create the quotation.",
                  "راجع الصفوف، احذف غير الضروري، أكمل الصفوف المخصصة، ثم أنشئ عرض السعر.",
                )}
            {job.summary?.blockedReason && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(applyMapping)}
              >
                {t("Refresh customer mapping", "تحديث ربط العميل")}
              </button>
            )}
          </div>
          {hasCustomerConflict && (
            <div className="notice">
              <button
                type="button"
                onClick={() => setShowCustomerColumn((visible) => !visible)}
                aria-expanded={showCustomerColumn}
              >
                {showCustomerColumn
                  ? t("Hide customer names", "إخفاء أسماء العملاء")
                  : t("Show customer names", "إظهار أسماء العملاء")}
              </button>
              {showCustomerColumn && (
                <small>
                  {t("Customers found", "العملاء الموجودون")}: {conflictingCustomers.join(" · ")}
                </small>
              )}
            </div>
          )}
          <div className="notice">
            {t(
              "Customer details will be added once in the quotation header. Review and complete the line rows below.",
              "ستتم إضافة بيانات العميل مرة واحدة في رأس عرض السعر. راجع وأكمل صفوف البنود أدناه.",
            )}
          </div>
          <div className="quantity-drilldown-summary">
            <span>
              {t("Selected rows", "الصفوف المحددة")}: {selectedIds.length}
            </span>
            <span>
              {t("Included rows", "الصفوف المضمنة")}: {job.summary?.includedRows || 0}
            </span>
            <span>
              {t("Rows needing work", "الصفوف التي تحتاج عمل")}: {job.summary?.blockedRows || 0}
            </span>
          </div>
          <div className="actions wrap">
            {[
              ["all", "All rows", "كل الصفوف"],
              ["included", "Included", "المضمنة"],
              ["removed", "Removed", "المحذوفة"],
              ["problems", "Problems", "المشكلات"],
            ].map(([key, en, ar]) => (
              <button
                key={key}
                className={filter === key ? "primary" : ""}
                onClick={() => void open(job.id, key)}
              >
                {t(en, ar)}
              </button>
            ))}
            <button
              disabled={busy || !selectedIds.length}
              onClick={() =>
                void run(async () => {
                  await api(`delivery-quote-imports/${job.id}/review`, "POST", {
                    version: job.version,
                    rowIds: selectedIds,
                    action: "REMOVE",
                    rowUpdates: getRowUpdates(),
                  });
                  await open(job.id, filter);
                })
              }
            >
              {t("Remove selected", "حذف المحدد")}
            </button>
            <button
              disabled={busy || !selectedIds.length}
              onClick={() =>
                void run(async () => {
                  await api(`delivery-quote-imports/${job.id}/review`, "POST", {
                    version: job.version,
                    rowIds: selectedIds,
                    action: "RESTORE",
                    rowUpdates: getRowUpdates(),
                  });
                  await open(job.id, filter);
                })
              }
            >
              {t("Restore selected", "استعادة المحدد")}
            </button>
            <button
              disabled={busy || !selectedIds.length}
              onClick={() =>
                void run(async () => {
                  await api(`delivery-quote-imports/${job.id}/review`, "POST", {
                    version: job.version,
                    rowIds: selectedIds,
                    completed: true,
                    rowUpdates: getRowUpdates(),
                  });
                  await open(job.id, filter);
                })
              }
            >
              {t("Mark complete", "تحديد كمكتمل")}
            </button>
            <button
              disabled={busy || !job?.rows?.length}
              onClick={() =>
                void run(async () => {
                  const allIds = (job?.rows || []).map((r: any) => r.id);
                  await api(`delivery-quote-imports/${job.id}/review`, "POST", {
                    version: job.version,
                    rowIds: allIds,
                    rowUpdates: getRowUpdates(),
                  });
                  await open(job.id, filter);
                })
              }
            >
              {t("Save changes", "حفظ التغييرات")}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const allIds = (job?.rows || []).map((r: any) => r.id);
                  if (allIds.length) {
                    await api(`delivery-quote-imports/${job.id}/review`, "POST", {
                      version: job.version,
                      rowIds: allIds,
                      rowUpdates: getRowUpdates(),
                    });
                  }
                  const refreshed: any = await api(
                    `delivery-quote-imports/${job.id}?page=0&pageSize=100&filter=${encodeURIComponent(filter)}`,
                  );
                  const quote = await api(
                    `delivery-quote-imports/${job.id}/finalize`,
                    "POST",
                    { version: refreshed.version },
                  );
                  onImported(quote);
                  await open(job.id, filter);
                })
              }
            >
              {t("Create quotation", "إنشاء عرض السعر")}
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = someVisibleSelected;
                      }}
                      aria-label={t("Select all rows", "تحديد كل الصفوف")}
                      onChange={(e) => toggleVisibleRows(e.target.checked)}
                    />
                  </th>
                  <th>{t("Row", "الصف")}</th>
                  <th>{t("Date", "التاريخ")}</th>
                  {showCustomerColumn && <th>{t("Customer", "العميل")}</th>}
                  <th>{t("Doc No", "رقم المستند")}</th>
                  <th>{t("Part / description", "الصنف / الوصف")}</th>
                  <th>{t("Qty", "الكمية")}</th>
                  <th>{t("File price", "سعر الملف")}</th>
                  <th>{t("Quotation price", "سعر عرض السعر")}</th>
                  <th>{t("Status", "الحالة")}</th>
                  <th>{t("Actions", "إجراءات")}</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row: any) => {
                  const input = row.line_input || {};
                  const raw = row.raw || {};
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selected[row.id]}
                          onChange={(e) =>
                            setSelected({
                              ...selected,
                              [row.id]: e.target.checked,
                            })
                          }
                        />
                      </td>
                      <td>{row.row_number}</td>
                      <td>{formatDeliveryDate(row.doc_date ?? row.docDate ?? raw[job.mapping?.date]) || "—"}</td>
                      {showCustomerColumn && (
                        <td>{raw[job.mapping?.customerName] || "—"}</td>
                      )}
                      <td>{formatDeliveryDocNo(row.doc_no ?? row.docNo ?? raw[job.mapping?.docNo]) || "—"}</td>
                      <td>
                        <strong>
                          {input.partNumber ||
                            raw[job.mapping?.partNumber] ||
                            input.productId ||
                            "—"}
                        </strong>
                        <small>
                          {input.description || raw[job.mapping?.description] || "—"}
                        </small>
                      </td>
                      <td>
                        <input
                          value={input.quantity || ""}
                          onChange={(e) => {
                            const rows = job.rows.map((item: any) =>
                              item.id === row.id
                                ? {
                                    ...item,
                                    line_input: {
                                      ...item.line_input,
                                      quantity: e.target.value,
                                    },
                                  }
                                : item,
                            );
                            setJob({ ...job, rows });
                          }}
                        />
                      </td>
                      <td>
                        <div className="delivery-price-stack">
                          <input
                            value={row.source_price || ""}
                            readOnly
                            placeholder="—"
                          />
                        </div>
                      </td>
                      <td>
                        <div className="delivery-price-stack">
                          <input
                            value={input.unitPriceExcl || ""}
                            disabled={row.resolution !== "UNMATCHED_CUSTOM"}
                            onChange={(e) => {
                              const rows = job.rows.map((item: any) =>
                                item.id === row.id
                                  ? {
                                      ...item,
                                      line_input: {
                                        ...item.line_input,
                                        unitPriceExcl: e.target.value,
                                      },
                                    }
                                  : item,
                              );
                              setJob({ ...job, rows });
                            }}
                            placeholder={
                              row.resolution === "UNMATCHED_CUSTOM"
                                ? t("Enter price (or 0)", "أدخل السعر (أو 0)")
                                : t("Uses catalog price", "يستخدم سعر الكتالوج")
                            }
                          />
                          {row.source_price && row.resolution === "MATCHED_CATALOG" && (
                            <small>
                              {t("File price", "سعر الملف")}: {row.source_price}
                            </small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={"pill " + (row.completed ? "success" : "")}>
                          {completionLabel(row)}
                        </span>
                        <small>{resolutionLabel(row.resolution)}</small>
                        {!!row.issues?.length && (
                          <small>{row.issues.join("; ")}</small>
                        )}
                      </td>
                      <td>
                        <div className="actions wrap">
                          <button
                            onClick={() =>
                              void run(async () => {
                                await api(`delivery-quote-imports/${job.id}/review`, "POST", {
                                  version: job.version,
                                  rowIds: [row.id],
                                  completed: true,
                                  rowUpdates: getRowUpdates(),
                                });
                                await open(job.id, filter);
                              })
                            }
                          >
                            {t("Complete", "إكمال")}
                          </button>
                          <button
                            onClick={() =>
                              void run(async () => {
                                await api(`delivery-quote-imports/${job.id}/review`, "POST", {
                                  version: job.version,
                                  rowIds: [row.id],
                                  action: row.action === "REMOVE" ? "RESTORE" : "REMOVE",
                                  rowUpdates: getRowUpdates(),
                                });
                                await open(job.id, filter);
                              })
                            }
                          >
                            {row.action === "REMOVE"
                              ? t("Restore", "استعادة")
                              : t("Remove", "حذف")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {job?.status === "COMPLETED" && (
        <div className="notice success">
          <span>
            {t(
              "Quotation created from this delivery note. Opened in the current quotation workspace.",
              "تم إنشاء عرض السعر من إذن التسليم هذا وتم فتحه في مساحة عرض السعر الحالية.",
            )}
          </span>
          <button type="button" disabled={busy} onClick={() => void reopenForMapping()}>
            {t("Create correction copy", "إنشاء نسخة تصحيح")}
          </button>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
