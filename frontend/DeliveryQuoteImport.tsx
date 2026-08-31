"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import {
  formatDeliveryDocNo,
  formatDeliveryDate,
} from "@/backend/pricing/normalize";

const autoMap = (columns: string[], names: string[]) =>
  columns.find((column) =>
    names.includes(column.toLowerCase().replace(/[^a-z0-9]/g, "")),
  ) || "";

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
  const [tab, setTab] = useState<"IMPORT" | "OUTPUTS" | "ADMIN">("OUTPUTS");
  const [mapping, setMapping] = useState({
    date: "",
    docNo: "",
    customerName: "",
    partNumber: "",
    description: "",
    quantity: "",
    price: "",
  });

  const loadJobs = () => api("delivery-quote-imports").then(setJobs);
  const open = async (id: string, nextFilter = filter) => {
    const next: any = await api(
      `delivery-quote-imports/${id}?page=0&pageSize=100&filter=${encodeURIComponent(nextFilter)}`,
    );
    setJob(next);
    setFilter(nextFilter);
    const columns = next.summary?.columns || [];
    setMapping({
      date: next.mapping?.date || autoMap(columns, ["date", "docdate"]),
      docNo: next.mapping?.docNo || autoMap(columns, ["docno", "deliveryno", "documentno"]),
      customerName:
        next.mapping?.customerName || autoMap(columns, ["customername", "customer", "partyname"]),
      partNumber:
        next.mapping?.partNumber || autoMap(columns, ["item", "partnumber", "partreference", "itemcode"]),
      description:
        next.mapping?.description || autoMap(columns, ["description", "desc", "itemdescription"]),
      quantity: next.mapping?.quantity || autoMap(columns, ["qty", "quantity"]),
      price: next.mapping?.price || autoMap(columns, ["price", "unitprice", "rate", "amount"]),
    });
    setSelected({});
  };

  useEffect(() => {
    void loadJobs().catch((e) => setError(e.message));
  }, []);

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

  const selectedIds = Object.entries(selected)
    .filter(([, value]) => value)
    .map(([id]) => id);
  const isAdmin = user.permissions.includes("QUOTE_VIEW_ALL");
  const activeJobs = jobs.filter((item) => item.status !== "COMPLETED");
  const completedJobs = jobs.filter((item) => item.quote_id);
  const headerSummary = job?.header || job?.summary || {};
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
      {tab === "OUTPUTS" && (
        <div className="quantity-history-list">
          {completedJobs.length ? (
            completedJobs.map((item) => (
              <article className="quantity-history-card" key={item.id}>
                <div>
                  <strong>{item.filename}</strong>
                  <small>
                    {new Date(item.updated_at || item.created_at).toLocaleString()} ·{" "}
                    {item.status}
                  </small>
                </div>
                <div className="actions wrap">
                  <button onClick={() => void open(item.id)}>
                    {t("Open import", "فتح الاستيراد")}
                  </button>
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
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              {t(
                "No converted quotations yet. Upload a delivery note to create one.",
                "لا توجد عروض أسعار محولة بعد. ارفع إذن تسليم لإنشائه.",
              )}
            </div>
          )}
        </div>
      )}
      {tab === "ADMIN" && isAdmin && (
        <div className="quantity-history-list">
          {jobs.length ? (
            jobs.map((item) => (
              <article className="quantity-history-card" key={item.id}>
                <div>
                  <strong>{item.filename}</strong>
                  <small>
                    {new Date(item.created_at).toLocaleString()} · {item.status}
                  </small>
                </div>
                <div className="actions wrap">
                  <button onClick={() => void open(item.id)}>
                    {t("Open source", "فتح المصدر")}
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`delivery-quote-imports/${item.id}`, "DELETE");
                        if (job?.id === item.id) setJob(null);
                      })
                    }
                  >
                    {t("Delete file", "حذف الملف")}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              {t("No source files found.", "لا توجد ملفات مصدر.")}
            </div>
          )}
        </div>
      )}
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
            onClick={() =>
              void run(async () => {
                const payload = {
                  version: job.version,
                  date: mapping.date,
                  docNo: mapping.docNo,
                  customerName: mapping.customerName,
                  partNumber: mapping.partNumber,
                  description: mapping.description,
                  quantity: mapping.quantity,
                  ...(mapping.price ? { price: mapping.price } : {}),
                };
                await api(`delivery-quote-imports/${job.id}/mapping`, "POST", payload);
                await open(job.id);
              })
            }
          >
            {t("Apply mapping", "تطبيق الربط")}
          </button>
        </div>
      )}
      {job?.status === "AWAITING_REVIEW" && (
        <>
          <div className="notice">
            {job.summary?.blockedReason
              ? job.summary.blockedReason
              : t(
                  "Review rows, remove anything unnecessary, complete custom rows, then create the quotation.",
                  "راجع الصفوف، احذف غير الضروري، أكمل الصفوف المخصصة، ثم أنشئ عرض السعر.",
                )}
          </div>
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
          {t(
            "Quotation created from this delivery note. Opened in the current quotation workspace.",
            "تم إنشاء عرض السعر من إذن التسليم هذا وتم فتحه في مساحة عرض السعر الحالية.",
          )}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
    </section>
  );
}
