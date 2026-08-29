"use client";
import { useEffect, useMemo, useState } from "react";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";
import type { AdminActionRunner } from "./admin-actions";
import {
  importSummaryDetails,
  importSummaryLines,
} from "./admin-dashboard-summary";

type DashboardPanel =
  | "pending-imports"
  | "import-errors"
  | "duplicate-rows"
  | "minimum-protected"
  | "updated-today"
  | "draft-quotations"
  | "issued-today";

const panelTitle = (panel: DashboardPanel, t: Translate) => {
  if (panel === "pending-imports")
    return t("Pending imports", "الاستيراد المعلق");
  if (panel === "import-errors")
    return t("Import errors", "أخطاء الاستيراد");
  if (panel === "duplicate-rows")
    return t("Duplicate rows", "صفوف مكررة");
  if (panel === "minimum-protected")
    return t("Minimum protected", "محمية بالحد الأدنى");
  if (panel === "updated-today") return t("Updated today", "محدثة اليوم");
  if (panel === "draft-quotations") return t("Draft quotations", "مسودات");
  return t("Issued today", "صادرة اليوم");
};

const customerName = (customer: any) =>
  customer?.name || customer?.number || "—";

const isAwaitingReview = (job: any) => job.status === "AWAITING_REVIEW";
const isImported = (job: any) => job.status === "IMPORTED";

export default function AdminDashboard({
  t,
  data,
  onAction,
  onReload,
  onOpenSection,
  onMinimumProtectedPageChange,
  onEditProduct,
}: {
  t: Translate;
  data: any;
  onAction: AdminActionRunner;
  onReload: () => Promise<void>;
  onOpenSection: (
    section: string,
    options?: {
      minimumProtectedPage?: number;
      protectedOnly?: boolean;
      query?: string;
    },
  ) => void;
  onMinimumProtectedPageChange: (page: number) => void;
  onEditProduct: (id: string) => Promise<void>;
}) {
  const [panel, setPanel] = useState<DashboardPanel>("pending-imports");
  const [selectedImports, setSelectedImports] = useState<Record<string, any>>({});
  const [selectedDuplicates, setSelectedDuplicates] = useState<
    Record<string, { jobId: string; errors: string[] }>
  >({});
  const [selectedMinimums, setSelectedMinimums] = useState<
    Record<string, number>
  >({});
  const [newMinimum, setNewMinimum] = useState("");

  useEffect(() => {
    setSelectedImports({});
    setSelectedDuplicates({});
    setSelectedMinimums({});
  }, [data]);

  const cards = [
    ["Total products", "إجمالي الأصناف", data.products.total, null],
    ["Active products", "أصناف نشطة", data.products.active, null],
    ["Cost + markup", "التكلفة + الزيادة", data.products.markup, null],
    ["List − discount", "القائمة − الخصم", data.products.discount, null],
    [
      "Minimum protected",
      "محمية بالحد الأدنى",
      data.products.protected,
      "minimum-protected",
    ],
    ["Updated today", "محدثة اليوم", data.products.updated, "updated-today"],
    ["Draft quotations", "مسودات", data.quotes.drafts, "draft-quotations"],
    ["Issued today", "صادرة اليوم", data.quotes.today, "issued-today"],
    [
      "Pending imports",
      "استيراد معلق",
      data.imports.pending,
      "pending-imports",
    ],
    ["Import errors", "أخطاء الاستيراد", data.imports.errors, "import-errors"],
    ["Duplicate rows", "صفوف مكررة", data.duplicates, "duplicate-rows"],
  ] as const;

  const recentImports = data.recentImports || [];
  const duplicateSelection = Object.entries(selectedDuplicates);
  const minimumItems = Object.entries(selectedMinimums).map(([id, version]) => ({
    id,
    version,
  }));
  const importItems = Object.values(selectedImports);

  const awaitingReviewSelected = importItems.filter(isAwaitingReview);
  const importedSelected = importItems.filter(isImported);
  const allImportsVisible =
    !!recentImports.length &&
    recentImports.every((job: any) => job.id in selectedImports);
  const allMinimumVisible =
    !!data.minimumProtected.length &&
    data.minimumProtected.every((row: any) => row.id in selectedMinimums);
  const minimumProtectedRangeStart = data.minimumProtectedTotalRows
    ? data.minimumProtectedPage * data.minimumProtectedPageSize + 1
    : 0;
  const minimumProtectedRangeEnd = data.minimumProtectedTotalRows
    ? minimumProtectedRangeStart + data.minimumProtected.length - 1
    : 0;

  const selectedDuplicateCount = duplicateSelection.length;
  const selectedMinimumCount = minimumItems.length;

  const groupedDuplicates = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const row of data.duplicateRows || []) {
      groups.set(row.job_id, [...(groups.get(row.job_id) || []), row]);
    }
    return groups;
  }, [data.duplicateRows]);

  async function applyDuplicateDecision(decision: "UPDATE" | "KEEP" | "SKIP") {
    if (!duplicateSelection.length) return;
    await onAction(
      {
        saving: t("Updating duplicate rows…", "جارٍ تحديث الصفوف المكررة…"),
        success: t("Duplicate rows updated", "تم تحديث الصفوف المكررة"),
        successDetail: t(
          "The selected import rows were updated from the dashboard.",
          "تم تحديث صفوف الاستيراد المحددة من لوحة التحكم.",
        ),
        error: t(
          "Duplicate rows could not be updated",
          "تعذر تحديث الصفوف المكررة",
        ),
      },
      async () => {
        const byJob = new Map<string, string[]>();
        for (const [id, row] of duplicateSelection) {
          byJob.set(row.jobId, [...(byJob.get(row.jobId) || []), id]);
        }
        for (const [jobId, ids] of byJob.entries()) {
          const rows = ids.map((id) => {
            const source = (data.duplicateRows || []).find(
              (row: any) => row.id === id,
            );
            const verified =
              decision === "UPDATE" &&
              !!source &&
              (!Array.isArray(source.errors) || source.errors.length === 0);
            return { id, decision, verified };
          });
          await api("imports/" + jobId + "/review", "POST", { rows });
        }
        setSelectedDuplicates({});
        await onReload();
      },
    );
  }

  async function importReadyRows(job: any) {
    await onAction(
      {
        saving: t("Importing ready rows…", "جارٍ استيراد الصفوف الجاهزة…"),
        success: t("Import completed", "اكتمل الاستيراد"),
        successDetail: t(
          "Valid rows were imported and problem rows were skipped.",
          "تم استيراد الصفوف الصالحة وتخطي صفوف المشكلات.",
        ),
        error: t("Import could not be completed", "تعذر إكمال الاستيراد"),
      },
      async () => {
        await api("imports/" + job.id + "/auto-confirm", "POST", {
          version: job.version,
        });
        await onReload();
      },
    );
  }

  async function rollbackImport(job: any) {
    if (
      !(await showConfirm(
        t(
          `Roll back ${job.filename}? Later product edits will block rollback.`,
          `هل تريد التراجع عن ${job.filename}؟ ستمنع تعديلات الأصناف اللاحقة التراجع.`,
        ),
      ))
    )
      return;
    await onAction(
      {
        saving: t("Rolling back import…", "جارٍ التراجع عن الاستيراد…"),
        success: t("Import rolled back", "تم التراجع عن الاستيراد"),
        successDetail: t(
          "The completed import was rolled back successfully.",
          "تم التراجع عن الاستيراد المكتمل بنجاح.",
        ),
        error: t("Import rollback failed", "فشل التراجع عن الاستيراد"),
      },
      async () => {
        await api("imports/" + job.id + "/rollback", "POST", {});
        await onReload();
      },
    );
  }

  async function bulkImportReadyRows() {
    if (!awaitingReviewSelected.length) return;
    await onAction(
      {
        saving: t("Importing selected ready rows…", "جارٍ استيراد الصفوف الجاهزة المحددة…"),
        success: t("Selected imports completed", "اكتملت عمليات الاستيراد المحددة"),
        successDetail: t(
          "The selected review-ready imports were processed.",
          "تمت معالجة عمليات الاستيراد المحددة الجاهزة للمراجعة.",
        ),
        error: t("Selected imports could not be completed", "تعذر إكمال عمليات الاستيراد المحددة"),
      },
      async () => {
        for (const job of awaitingReviewSelected) {
          await api("imports/" + job.id + "/auto-confirm", "POST", {
            version: job.version,
          });
        }
        setSelectedImports({});
        await onReload();
      },
    );
  }

  async function bulkRollbackImports() {
    if (!importedSelected.length) return;
    if (
      !(await showConfirm(
        t(
          `Roll back ${importedSelected.length} selected imports? Later product edits will block rollback.`,
          `هل تريد التراجع عن ${importedSelected.length} عمليات استيراد محددة؟ ستمنع تعديلات الأصناف اللاحقة التراجع.`,
        ),
      ))
    )
      return;
    await onAction(
      {
        saving: t("Rolling back selected imports…", "جارٍ التراجع عن عمليات الاستيراد المحددة…"),
        success: t("Selected imports rolled back", "تم التراجع عن عمليات الاستيراد المحددة"),
        successDetail: t(
          "The selected completed imports were rolled back.",
          "تم التراجع عن عمليات الاستيراد المكتملة المحددة.",
        ),
        error: t("Selected imports could not be rolled back", "تعذر التراجع عن عمليات الاستيراد المحددة"),
      },
      async () => {
        for (const job of importedSelected) {
          await api("imports/" + job.id + "/rollback", "POST", {});
        }
        setSelectedImports({});
        await onReload();
      },
    );
  }

  async function applyMinimumBulk(operation: "REMOVE_MINIMUM" | "MINIMUM") {
    if (!minimumItems.length) return;
    if (
      operation === "MINIMUM" &&
      (!newMinimum.trim() || !/^\d+(\.\d+)?$/.test(newMinimum.trim()))
    )
      return;
    const message =
      operation === "REMOVE_MINIMUM"
        ? t(
            `Remove minimum protection from ${minimumItems.length} products?`,
            `هل تريد إزالة حماية الحد الأدنى من ${minimumItems.length} أصناف؟`,
          )
        : t(
            `Set minimum ${newMinimum.trim()} for ${minimumItems.length} products?`,
            `هل تريد تعيين حد أدنى ${newMinimum.trim()} لـ ${minimumItems.length} أصناف؟`,
          );
    if (!(await showConfirm(message))) return;
    await onAction(
      {
        saving:
          operation === "REMOVE_MINIMUM"
            ? t("Removing minimum protection…", "جارٍ إزالة حماية الحد الأدنى…")
            : t("Setting minimum prices…", "جارٍ تعيين أسعار الحد الأدنى…"),
        success:
          operation === "REMOVE_MINIMUM"
            ? t("Minimum protection removed", "تمت إزالة حماية الحد الأدنى")
            : t("Minimum prices saved", "تم حفظ أسعار الحد الأدنى"),
        successDetail:
          operation === "REMOVE_MINIMUM"
            ? t(
                "The selected products no longer enforce a minimum price.",
                "لم تعد الأصناف المحددة تفرض سعراً أدنى.",
              )
            : t(
                "The selected products now use the new minimum price.",
                "تستخدم الأصناف المحددة الآن سعر الحد الأدنى الجديد.",
              ),
        error:
          operation === "REMOVE_MINIMUM"
            ? t(
                "Minimum protection could not be removed",
                "تعذر إزالة حماية الحد الأدنى",
              )
            : t("Minimum prices could not be saved", "تعذر حفظ أسعار الحد الأدنى"),
      },
      async () => {
        await api("products/bulk", "POST", {
          items: minimumItems,
          operation,
          ...(operation === "MINIMUM" ? { value: newMinimum.trim() } : {}),
          confirm: true,
        });
        setSelectedMinimums({});
        if (operation === "REMOVE_MINIMUM") setNewMinimum("");
        await onReload();
      },
    );
  }

  const renderImportSummary = (job: any) => {
    const lines = importSummaryLines(job.summary, job.status);
    const details = importSummaryDetails(job.summary);
    return (
      <div className="dashboard-summary">
        <div className="dashboard-summary-chips">
          {lines.map((line) => (
            <span
              key={line}
              className={`pill ${line === "0 rows" ? "warning" : ""}`}
            >
              {line}
            </span>
          ))}
        </div>
        {details && (
          <details className="dashboard-summary-details">
            <summary>{t("Columns & warnings", "الأعمدة والتحذيرات")}</summary>
            {!!details.columns.length && (
              <small>{details.columns.join(" · ")}</small>
            )}
            {!!details.warnings.length && (
              <small>{details.warnings.join(" · ")}</small>
            )}
          </details>
        )}
      </div>
    );
  };

  const renderPendingImports = () => (
    <div className="dashboard-panel">
      <div className="section-title">
        <div>
          <h3>{panelTitle("pending-imports", t)}</h3>
          <p className="muted">
            {t(
              "Recent imports stay manageable here. Use Open Imports for full row-by-row repair.",
              "تبقى عمليات الاستيراد الحديثة قابلة للإدارة هنا. استخدم فتح الاستيراد للإصلاح الكامل صفاً بصف.",
            )}
          </p>
        </div>
        <div className="actions wrap">
          <button onClick={() => onReload()}>
            {t("Refresh data", "تحديث البيانات")}
          </button>
          <button onClick={() => onOpenSection("imports")}>
            {t("Open Imports", "فتح الاستيراد")}
          </button>
        </div>
      </div>
      <div className="dashboard-bulk-bar">
        <span>
          {Object.keys(selectedImports).length
            ? t(
                `${Object.keys(selectedImports).length} imports selected`,
                `تم تحديد ${Object.keys(selectedImports).length} عمليات استيراد`,
              )
            : t(
                "Select imports for bulk actions",
                "حدد عمليات الاستيراد للإجراءات الجماعية",
              )}
        </span>
        <button
          disabled={!awaitingReviewSelected.length}
          onClick={() => void bulkImportReadyRows()}
        >
          {t("Import ready selected", "استيراد الجاهز المحدد")}
        </button>
        <button
          disabled={!importedSelected.length}
          onClick={() => void bulkRollbackImports()}
        >
          {t("Roll back selected", "التراجع عن المحدد")}
        </button>
        <button
          disabled={!Object.keys(selectedImports).length}
          onClick={() => setSelectedImports({})}
        >
          {t("Clear selection", "مسح التحديد")}
        </button>
      </div>
      <div className="table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allImportsVisible}
                  onChange={(e) =>
                    setSelectedImports(
                      e.target.checked
                        ? Object.fromEntries(
                            recentImports.map((job: any) => [job.id, job]),
                          )
                        : {},
                    )
                  }
                />
              </th>
              <th>{t("File", "الملف")}</th>
              <th>{t("Status", "الحالة")}</th>
              <th>{t("Summary", "الملخص")}</th>
              <th>{t("Updated", "التحديث")}</th>
              <th>{t("Actions", "الإجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {recentImports.map((job: any) => (
              <tr key={job.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={job.id in selectedImports}
                    onChange={(e) =>
                      setSelectedImports((current) =>
                        e.target.checked
                          ? { ...current, [job.id]: job }
                          : Object.fromEntries(
                              Object.entries(current).filter(
                                ([id]) => id !== job.id,
                              ),
                            ),
                      )
                    }
                  />
                </td>
                <td>
                  <strong>{job.filename}</strong>
                  <small>{job.kind}</small>
                </td>
                <td>
                  <span
                    className={`pill ${job.status === "ROLLED_BACK" ? "warning" : ""}`}
                  >
                    {job.status}
                  </span>
                </td>
                <td>{renderImportSummary(job)}</td>
                <td>{new Date(job.updated_at).toLocaleString()}</td>
                <td>
                  <div className="actions wrap dashboard-row-actions">
                    <button onClick={() => onOpenSection("imports")}>
                      {job.status === "AWAITING_REVIEW"
                        ? t("Continue review", "متابعة المراجعة")
                        : t("Open", "فتح")}
                    </button>
                    {job.status === "AWAITING_REVIEW" && (
                      <button onClick={() => void importReadyRows(job)}>
                        {t("Import ready rows", "استيراد الصفوف الجاهزة")}
                      </button>
                    )}
                    {job.status === "IMPORTED" && (
                      <button onClick={() => void rollbackImport(job)}>
                        {t("Roll back", "تراجع")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!recentImports.length && (
              <tr>
                <td colSpan={6}>
                  {t("No recent imports", "لا توجد عمليات استيراد حديثة")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderImportErrors = () => (
    <div className="dashboard-panel">
      <div className="section-title">
        <div>
          <h3>{panelTitle("import-errors", t)}</h3>
          <p className="muted">
            {t(
              "Inspect failed files here, then reopen Imports to upload or repair the next attempt.",
              "افحص الملفات الفاشلة هنا ثم افتح الاستيراد لرفع المحاولة التالية أو إصلاحها.",
            )}
          </p>
        </div>
        <button onClick={() => onOpenSection("imports")}>
          {t("Open Imports", "فتح الاستيراد")}
        </button>
      </div>
      <div className="table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>{t("File", "الملف")}</th>
              <th>{t("Problem", "المشكلة")}</th>
              <th>{t("Updated", "التحديث")}</th>
              <th>{t("Action", "الإجراء")}</th>
            </tr>
          </thead>
          <tbody>
            {data.importErrors.map((job: any) => (
              <tr key={job.id}>
                <td>
                  <strong>{job.filename}</strong>
                  <small>{job.kind}</small>
                </td>
                <td>
                  <small>{job.error || "—"}</small>
                </td>
                <td>{new Date(job.updated_at).toLocaleString()}</td>
                <td>
                  <button onClick={() => onOpenSection("imports")}>
                    {t("Open Imports", "فتح الاستيراد")}
                  </button>
                </td>
              </tr>
            ))}
            {!data.importErrors.length && (
              <tr>
                <td colSpan={4}>
                  {t("No failed imports", "لا توجد عمليات استيراد فاشلة")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderDuplicateRows = () => (
    <div className="dashboard-panel">
      <div className="section-title">
        <div>
          <h3>{panelTitle("duplicate-rows", t)}</h3>
          <p className="muted">
            {t(
              "These rows already match an existing catalog product. Choose whether to update it, keep it, or skip it.",
              "هذه الصفوف تطابق بالفعل صنفاً موجوداً في الكتالوج. اختر بين تحديثه أو الإبقاء عليه أو تخطيه.",
            )}
          </p>
        </div>
        <div className="actions wrap">
          <button
            disabled={!selectedDuplicateCount}
            onClick={() => void applyDuplicateDecision("UPDATE")}
          >
            {t("Set Update", "تعيين تحديث")}
          </button>
          <button
            disabled={!selectedDuplicateCount}
            onClick={() => void applyDuplicateDecision("KEEP")}
          >
            {t("Keep existing", "إبقاء الحالي")}
          </button>
          <button
            disabled={!selectedDuplicateCount}
            onClick={() => void applyDuplicateDecision("SKIP")}
          >
            {t("Skip", "تخطي")}
          </button>
          <button onClick={() => onOpenSection("imports")}>
            {t("Correct row in Imports", "تصحيح الصف في الاستيراد")}
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    !!data.duplicateRows.length &&
                    data.duplicateRows.every(
                      (row: any) => row.id in selectedDuplicates,
                    )
                  }
                  onChange={(e) =>
                    setSelectedDuplicates(
                      e.target.checked
                        ? Object.fromEntries(
                            data.duplicateRows.map((row: any) => [
                              row.id,
                              { jobId: row.job_id, errors: row.errors || [] },
                            ]),
                          )
                        : {},
                    )
                  }
                />
              </th>
              <th>{t("Import row", "صف الاستيراد")}</th>
              <th>{t("Incoming product", "الصنف الوارد")}</th>
              <th>{t("Matched product", "الصنف المطابق")}</th>
              <th>{t("Decision", "القرار")}</th>
              <th>{t("Action", "الإجراء")}</th>
            </tr>
          </thead>
          <tbody>
            {data.duplicateRows.map((row: any) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={row.id in selectedDuplicates}
                    onChange={(e) =>
                      setSelectedDuplicates((current) =>
                        e.target.checked
                          ? {
                              ...current,
                              [row.id]: {
                                jobId: row.job_id,
                                errors: row.errors || [],
                              },
                            }
                          : Object.fromEntries(
                              Object.entries(current).filter(
                                ([id]) => id !== row.id,
                              ),
                            ),
                      )
                    }
                  />
                </td>
                <td>
                  <strong>{row.filename}</strong>
                  <small>
                    {t("Row", "الصف")} {row.row_number}
                  </small>
                  <small>
                    {t("Source part", "الصنف من الملف")}:{" "}
                    {String(
                      row.raw?.part ??
                        row.raw?.["Part Reference"] ??
                        row.proposed?.partNumber ??
                        "—",
                    )}
                  </small>
                </td>
                <td>
                  <strong>{row.proposed?.partNumber || "—"}</strong>
                  <small>{row.proposed?.description || "—"}</small>
                </td>
                <td>
                  <strong>{row.matched_part || "—"}</strong>
                  <small>{row.matched_description || "—"}</small>
                </td>
                <td>
                  <span className="pill">{row.decision}</span>
                  <small>
                    {Array.isArray(row.errors) && row.errors.length
                      ? row.errors.join("; ")
                      : "OK"}
                  </small>
                </td>
                <td>
                  <div className="actions wrap dashboard-row-actions">
                    <button
                      onClick={() =>
                        void onAction(
                          {
                            saving: t("Saving row decision…", "جارٍ حفظ قرار الصف…"),
                            success: t("Row updated", "تم تحديث الصف"),
                            successDetail: t(
                              "The import row decision was saved.",
                              "تم حفظ قرار صف الاستيراد.",
                            ),
                            error: t("Row could not be updated", "تعذر تحديث الصف"),
                          },
                          async () => {
                            await api("imports/" + row.job_id + "/review", "POST", {
                              rows: [
                                {
                                  id: row.id,
                                  decision: "UPDATE",
                                  verified: !row.errors?.length,
                                },
                              ],
                            });
                            await onReload();
                          },
                        )
                      }
                    >
                      {t("Update", "تحديث")}
                    </button>
                    <button onClick={() => onOpenSection("imports")}>
                      {t("Correct row", "تصحيح الصف")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!data.duplicateRows.length && (
              <tr>
                <td colSpan={6}>
                  {t("No duplicate import rows", "لا توجد صفوف استيراد مكررة")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!!groupedDuplicates.size && (
        <p className="muted">
          {selectedDuplicateCount
            ? t(
                `${selectedDuplicateCount} rows selected across ${new Set(duplicateSelection.map(([, row]) => row.jobId)).size} imports.`,
                `تم تحديد ${selectedDuplicateCount} صفوف عبر ${new Set(duplicateSelection.map(([, row]) => row.jobId)).size} عمليات استيراد.`,
              )
            : t(
                "Select rows above to apply one decision across multiple imports.",
                "حدد الصفوف أعلاه لتطبيق قرار واحد عبر عدة عمليات استيراد.",
              )}
        </p>
      )}
    </div>
  );

  const renderMinimumProtected = () => (
    <div className="dashboard-panel">
      <div className="section-title">
        <div>
          <h3>{panelTitle("minimum-protected", t)}</h3>
          <p className="muted">
            {t(
              "Use this cleanup table to remove accidental minimums or set a new minimum across selected products.",
              "استخدم جدول التنظيف هذا لإزالة الحدود الدنيا غير المقصودة أو تعيين حد أدنى جديد للأصناف المحددة.",
            )}
          </p>
        </div>
        <div className="actions wrap">
          <input
            className="compact"
            inputMode="decimal"
            placeholder={t("New minimum", "حد أدنى جديد")}
            value={newMinimum}
            onChange={(e) => setNewMinimum(e.target.value)}
          />
          <button
            disabled={!selectedMinimumCount || !newMinimum.trim()}
            onClick={() => void applyMinimumBulk("MINIMUM")}
          >
            {t("Set minimum", "تعيين الحد الأدنى")}
          </button>
          <button
            disabled={!selectedMinimumCount}
            onClick={() => void applyMinimumBulk("REMOVE_MINIMUM")}
          >
            {t("Remove minimum", "إزالة الحد الأدنى")}
          </button>
          <button
            onClick={() => onOpenSection("products", { protectedOnly: true })}
          >
            {t("Open Products", "فتح الأصناف")}
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allMinimumVisible}
                  onChange={(e) =>
                    setSelectedMinimums(
                      e.target.checked
                        ? Object.fromEntries(
                            data.minimumProtected.map((row: any) => [
                              row.id,
                              row.version,
                            ]),
                          )
                        : {},
                    )
                  }
                />
              </th>
              <th>{t("Product", "الصنف")}</th>
              <th>{t("Minimum", "الحد الأدنى")}</th>
              <th>{t("Main price", "السعر الرئيسي")}</th>
              <th>{t("Updated", "التحديث")}</th>
              <th>{t("Action", "الإجراء")}</th>
            </tr>
          </thead>
          <tbody>
            {data.minimumProtected.map((row: any) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={row.id in selectedMinimums}
                    onChange={(e) =>
                      setSelectedMinimums((current) =>
                        e.target.checked
                          ? { ...current, [row.id]: row.version }
                          : Object.fromEntries(
                              Object.entries(current).filter(
                                ([id]) => id !== row.id,
                              ),
                            ),
                      )
                    }
                  />
                </td>
                <td>
                  <strong>{row.partNumber}</strong>
                  <small>{row.description}</small>
                  <small>
                    {row.active
                      ? t("Active", "نشط")
                      : t("Archived", "مؤرشف")}
                  </small>
                </td>
                <td>SAR {row.minimum}</td>
                <td>SAR {row.masterExcl}</td>
                <td>{new Date(row.updatedAt).toLocaleString()}</td>
                <td>
                  <button onClick={() => void onEditProduct(row.id)}>
                    {t("Edit", "تعديل")}
                  </button>
                </td>
              </tr>
            ))}
            {!data.minimumProtected.length && (
              <tr>
                <td colSpan={6}>
                  {t(
                    "No products currently use a positive minimum protection rule.",
                    "لا توجد أصناف تستخدم حالياً قاعدة حد أدنى موجبة للحماية.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="actions wrap">
        <button
          disabled={data.minimumProtectedPage === 0}
          onClick={() =>
            onMinimumProtectedPageChange(
              Math.max(data.minimumProtectedPage - 1, 0),
            )
          }
        >
          {t("Previous", "السابق")}
        </button>
        <span className="muted">
          {t("Showing", "إظهار")} {minimumProtectedRangeStart}-
          {minimumProtectedRangeEnd} / {data.minimumProtectedTotalRows}
        </span>
        <button
          disabled={!data.minimumProtectedHasMore}
          onClick={() =>
            onMinimumProtectedPageChange(data.minimumProtectedPage + 1)
          }
        >
          {t("Next", "التالي")}
        </button>
      </div>
    </div>
  );

  const renderUpdatedToday = () => (
    <div className="dashboard-panel">
      <div className="section-title">
        <h3>{panelTitle("updated-today", t)}</h3>
      </div>
      <div className="table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>{t("Product", "الصنف")}</th>
              <th>{t("Updated", "التحديث")}</th>
              <th>{t("Action", "الإجراء")}</th>
            </tr>
          </thead>
          <tbody>
            {data.updatedTodayItems.map((row: any) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.partNumber}</strong>
                  <small>{row.description}</small>
                </td>
                <td>{new Date(row.updatedAt).toLocaleString()}</td>
                <td>
                  <button onClick={() => void onEditProduct(row.id)}>
                    {t("Edit", "تعديل")}
                  </button>
                </td>
              </tr>
            ))}
            {!data.updatedTodayItems.length && (
              <tr>
                <td colSpan={3}>
                  {t("No products updated today", "لا توجد أصناف محدثة اليوم")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderQuotes = (
    rows: any[],
    current: "draft-quotations" | "issued-today",
  ) => (
    <div className="dashboard-panel">
      <div className="section-title">
        <h3>{panelTitle(current, t)}</h3>
      </div>
      <div className="table-scroll">
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>{t("Quotation", "عرض السعر")}</th>
              <th>{t("Customer", "العميل")}</th>
              <th>{t("Total", "الإجمالي")}</th>
              <th>{t("Date", "التاريخ")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.number}</strong>
                </td>
                <td>{customerName(row.customer)}</td>
                <td>SAR {row.totals?.total || "0.00"}</td>
                <td>
                  {new Date(
                    (current === "issued-today" ? row.issued_at : row.updated_at) ||
                      row.created_at,
                  ).toLocaleString()}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4}>
                  {current === "draft-quotations"
                    ? t("No draft quotations", "لا توجد مسودات")
                    : t(
                        "No quotations issued today",
                        "لا توجد عروض صادرة اليوم",
                      )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <>
      <div className="dashboard-grid">
        {cards.map(([en, ar, value, nextPanel]) => (
          <button
            key={en}
            type="button"
            className={`stat dashboard-card ${nextPanel === panel ? "active" : ""} ${!nextPanel ? "static" : ""}`}
            onClick={() => nextPanel && setPanel(nextPanel as DashboardPanel)}
          >
            <span>{t(en, ar)}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
      {panel === "pending-imports" && renderPendingImports()}
      {panel === "import-errors" && renderImportErrors()}
      {panel === "duplicate-rows" && renderDuplicateRows()}
      {panel === "minimum-protected" && renderMinimumProtected()}
      {panel === "updated-today" && renderUpdatedToday()}
      {panel === "draft-quotations" &&
        renderQuotes(data.draftQuotations, "draft-quotations")}
      {panel === "issued-today" &&
        renderQuotes(data.issuedTodayItems, "issued-today")}
    </>
  );
}
