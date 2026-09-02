"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";
import type { AdminActionRunner } from "./admin-actions";
import { appPath } from "../shared/paths";
import ProductEditor, { blankProduct } from "./ProductEditor";
import { tierColumns } from "@/backend/pricing/transfer";
import BulkRules from "./BulkRules";
const IMPORT_PAGE_SIZE = 50;
const mappingFields = [
  "partNumber",
  "description",
  "brand",
  "category",
  "cost",
  "markup",
  "listPrice",
  "baseDiscount",
  "minimum",
  "vat",
  "unit",
  "quantityPrecision",
  "aliases",
  "method",
  "active",
  "minimumEnabled",
  "keywords",
  "defaultLevel",
  ...tierColumns,
  ...["WHOLESALE", "RETAIL", "END_CUSTOMER"].map(
    (code) => `${code}.sellingPrice`,
  ),
];
const synonyms: Record<string, string[]> = {
  partNumber: [
    "partnumber",
    "partno",
    "itemcode",
    "code",
    "item",
    "partreference",
    "partref",
  ],
  description: [
    "description",
    "desc",
    "itemdescription",
    "localdescription",
  ],
  cost: ["cost", "purchasecost"],
  listPrice: ["price", "listprice", "publicpricelist", "publicprice"],
  baseDiscount: ["discount", "disc"],
  minimum: ["minprice", "minimumprice"],
  markup: ["markup"],
};
type ImportProfile =
  | "STANDARD"
  | "PUBLIC_PRICE_DISCOUNT"
  | "SUPPLIER_SIMPLE"
  | "SUPPLIER_QUOTE";
type ReviewSection = "summary" | "all" | "repair";
type DiscountPreset = {
  finalDiscount: string;
  wholesaleDiscount: string;
  minimumDiscount: string;
};
const defaultDiscountPreset = (): DiscountPreset => ({
  finalDiscount: "0",
  wholesaleDiscount: "0",
  minimumDiscount: "0",
});
const defaultImportDefaults = (vat = "15") => ({
  method: "LIST_DISCOUNT",
  markup: "25",
  baseDiscount: "0",
  vat,
  minimumEnabled: false,
});
const previewPrice = (discount: string, listPrice = 100) => {
  const percent = Number(discount || 0);
  if (!Number.isFinite(percent)) return "0.00";
  return (listPrice * (1 - percent / 100)).toFixed(2);
};
const cleanPreset = (preset: DiscountPreset): DiscountPreset => ({
  finalDiscount: String(preset.finalDiscount ?? "0"),
  wholesaleDiscount: String(preset.wholesaleDiscount ?? "0"),
  minimumDiscount: String(preset.minimumDiscount ?? "0"),
});
const normalizeHeader = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");
const supplierSimpleFields = [
  "partNumber",
  "description",
  "listPrice",
] as const;
const supplierSimpleColumns = {
  partNumber: "Part Reference",
  description: "Local Description",
  listPrice: "Public Pricelist",
  groupColumn: "Activity",
} as const;
const supplierQuoteColumns = {
  partNumber: "Article number",
  description: "Description",
  unit: "Unit",
  price: "Unit price",
} as const;
const supplierQuotePriceTargets = [
  ["cost", "Supplier cost"],
  ["listPrice", "Public/list price"],
  ["WHOLESALE.sellingPrice", "Wholesale fixed price"],
  ["RETAIL.sellingPrice", "Retail fixed price"],
  ["END_CUSTOMER.sellingPrice", "End customer fixed price"],
] as const;
const findMappedColumn = (columns: string[], field: string) =>
  columns.find((column) =>
    [
      normalizeHeader(field),
      ...(synonyms[field] || []),
    ].includes(normalizeHeader(column)),
  );
const hasSupplierSimpleColumns = (columns: string[]) =>
  supplierSimpleFields.every((field) => !!findMappedColumn(columns, field));
const isSupplierSimpleMapping = (
  mapping: Record<string, string>,
  columns: string[],
) =>
  supplierSimpleFields.every(
    (field) =>
      mapping[field] &&
      normalizeHeader(mapping[field]) ===
        normalizeHeader(
          supplierSimpleColumns[field as keyof typeof supplierSimpleColumns],
        ),
  ) &&
  columns.some(
    (column) =>
      normalizeHeader(column) === normalizeHeader(supplierSimpleColumns.groupColumn),
  );
const hasSupplierQuoteColumns = (columns: string[]) =>
  [
    supplierQuoteColumns.partNumber,
    supplierQuoteColumns.description,
    supplierQuoteColumns.unit,
    supplierQuoteColumns.price,
  ].every((column) => columns.includes(column));
const mappingLabel = (field: string, profile: ImportProfile) => {
  if (profile !== "SUPPLIER_SIMPLE") return field;
  switch (field) {
    case "partNumber":
      return "Part reference column";
    case "description":
      return "Description column";
    case "listPrice":
      return "Public price column";
    default:
      return field;
  }
};
const decisionLabel = (decision: string, t: Translate) => {
  if (decision === "REVIEW") return t("Needs review", "بحاجة لمراجعة");
  if (decision === "KEEP") return t("Keep existing", "إبقاء الحالي");
  if (decision === "UPDATE") return t("Import changes", "استيراد التغييرات");
  if (decision === "SKIP") return t("Ignore / Skip", "تجاهل / تخطي");
  return decision;
};
const importProblemHint = (row: any, t: Translate) => {
  const errors = Array.isArray(row?.errors) ? row.errors : [];
  if (
    errors.some((message: string) =>
      /Unknown part number: Update Existing Only does not create products/i.test(
        message,
      ),
    )
  )
    return t(
      "This row is a new product, but the import is in Update Existing Only mode. Re-map or re-upload with Create & Update to import it.",
      "هذا الصف يمثل صنفاً جديداً، لكن الاستيراد مضبوط على تحديث الموجود فقط. أعد الربط أو ارفع الملف مجدداً مع وضع إنشاء وتحديث لاستيراده.",
    );
  return "";
};
const applyRowUpdates = (
  rows: any[],
  ids: Set<string>,
  updates: { decision?: string; verified?: boolean },
) =>
  rows.map((row) => (ids.has(row.id) ? { ...row, ...updates } : row));
export default function Imports({
  t,
  actionBusy,
  onAction,
}: {
  t: Translate;
  actionBusy: boolean;
  onAction: AdminActionRunner;
}) {
  const [jobs, setJobs] = useState<any[]>([]),
    [mode, setMode] = useState("UPDATE_ONLY"),
    [page, setPage] = useState(0),
    [rowView, setRowView] = useState<"all" | "repair">("all"),
    [reviewSection, setReviewSection] = useState<ReviewSection>("summary"),
    [confirmation, setConfirmation] = useState<any>(null),
    [job, setJob] = useState<any>(null),
    [groupValues, setGroupValues] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [defaults, setDefaults] = useState<any>(defaultImportDefaults()),
    [importProfile, setImportProfile] = useState<ImportProfile>("STANDARD"),
    [guidedGroupColumn, setGuidedGroupColumn] = useState("Activity"),
    [guidedDefaultPreset, setGuidedDefaultPreset] = useState<DiscountPreset>(
      defaultDiscountPreset(),
    ),
    [guidedGroupPresets, setGuidedGroupPresets] = useState<
      Record<string, DiscountPreset>
    >({}),
    [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({}),
    [reviewDrafts, setReviewDrafts] = useState<
      Record<string, { decision?: string; verified?: boolean }>
    >({}),
    [editing, setEditing] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [linkDiscounts, setLinkDiscounts] = useState(true),
    [quickImportMode, setQuickImportMode] = useState(false),
    [showAdvancedDiscounts, setShowAdvancedDiscounts] = useState(false),
    [quickActionMessage, setQuickActionMessage] = useState("");
  const [supplierQuotePriceRole, setSupplierQuotePriceRole] = useState("");

  const updateDefaultPreset = (field: keyof DiscountPreset, value: string) => {
    setGuidedDefaultPreset((prev) => {
      if (linkDiscounts && field === "finalDiscount") {
        return {
          finalDiscount: value,
          wholesaleDiscount: value,
          minimumDiscount: prev.minimumDiscount,
        };
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const updateGroupPreset = (groupValue: string, field: keyof DiscountPreset, value: string) => {
    setGuidedGroupPresets((prev) => {
      const preset = prev[groupValue] || defaultDiscountPreset();
      const updated = linkDiscounts && field === "finalDiscount"
        ? {
            finalDiscount: value,
            wholesaleDiscount: value,
            minimumDiscount: preset.minimumDiscount,
          }
        : {
            ...preset,
            [field]: value,
          };
      return {
        ...prev,
        [groupValue]: updated,
      };
    });
  };

  const handleToggleLinkDiscounts = (linked: boolean) => {
    setLinkDiscounts(linked);
    if (linked) {
      setGuidedDefaultPreset((prev) => ({
        finalDiscount: prev.finalDiscount,
        wholesaleDiscount: prev.finalDiscount,
        minimumDiscount: prev.minimumDiscount,
      }));
      setGuidedGroupPresets((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([key, val]) => [
            key,
            {
              finalDiscount: val.finalDiscount,
              wholesaleDiscount: val.finalDiscount,
              minimumDiscount: val.minimumDiscount,
            },
          ]),
        ),
      );
    }
  };
  const guidedMode = ["PUBLIC_PRICE_DISCOUNT", "SUPPLIER_SIMPLE"].includes(
    importProfile,
  );
  const supplierSimpleMode = importProfile === "SUPPLIER_SIMPLE";
  const supplierQuoteMode = importProfile === "SUPPLIER_QUOTE";
  const load = () => api("imports").then(setJobs);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api("auth/me")
      .then((s) =>
        setDefaults((d: any) => ({ ...defaultImportDefaults(s.settings.vat), ...d, vat: s.settings.vat })),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!guidedMode) return;
    setDefaults((current: any) => ({
      ...current,
      method: "LIST_DISCOUNT",
      minimumEnabled: false,
    }));
  }, [guidedMode]);
  useEffect(() => {
    if (!supplierSimpleMode) return;
    setMode("CREATE_UPDATE");
  }, [supplierSimpleMode]);
  useEffect(() => {
    if (!jobs.some((j) => ["UPLOADED", "PROCESSING"].includes(j.status)))
      return;
    const timer = setInterval(() => load().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [jobs]);
  async function run(fn: () => Promise<any>) {
    if (actionBusy) return;
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
  }
  const applyReviewDrafts = (
    rows: any[],
    drafts: Record<string, { decision?: string; verified?: boolean }>,
  ) => rows.map((row) => (drafts[row.id] ? { ...row, ...drafts[row.id] } : row));
  async function fetchJobPage(
    id: string,
    nextPage = 0,
    nextGroupColumn?: string,
    drafts = reviewDrafts,
    nextRowView = rowView,
  ) {
    const query = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(IMPORT_PAGE_SIZE),
      rowView: nextRowView,
    });
    if (nextGroupColumn?.trim()) query.set("groupColumn", nextGroupColumn.trim());
    const j = await api("imports/" + id + "?" + query.toString());
    return { ...j, rows: applyReviewDrafts(j.rows || [], drafts) };
  }
  async function loadJobPage(
    id: string,
    nextPage = 0,
    nextGroupColumn?: string,
    nextRowView = rowView,
  ) {
    const j = await fetchJobPage(
      id,
      nextPage,
      nextGroupColumn,
      reviewDrafts,
      nextRowView,
    );
    setJob(j);
    setSelectedRows({});
    setPage(j.page || 0);
    setRowView(nextRowView);
    setGroupValues(j.groupValues || []);
    return j;
  }
  async function loadConfirmation(id: string, nextPage = page) {
    const query = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(IMPORT_PAGE_SIZE),
    });
    setConfirmation(
      await api(
        "imports/" + id + "/preview-confirmation?" + query.toString(),
        "POST",
        {},
      ),
    );
  }
  async function changePage(nextPage: number) {
    if (!job) return;
    await loadJobPage(job.id, nextPage, guidedGroupColumn, rowView);
    if (confirmation) await loadConfirmation(job.id, nextPage);
  }
  async function openReviewSection(nextSection: ReviewSection, nextJob = job) {
    setConfirmation(null);
    setSelectedRows({});
    setReviewSection(nextSection);
    if (!nextJob || nextSection === "summary") return;
    await loadJobPage(
      nextJob.id,
      0,
      guidedGroupColumn,
      nextSection === "repair" ? "repair" : "all",
    );
  }
  async function open(id: string) {
    const emptyDrafts: Record<string, { decision?: string; verified?: boolean }> =
      {};
    const j = await fetchJobPage(id, 0, undefined, emptyDrafts, "all");
    const savedDefaults = j.defaults || {};
    const guided = savedDefaults.guidedImport;
    const {
      guidedImport,
      quickImport,
      supplierQuotePriceRole: savedSupplierQuotePriceRole,
      ...productDefaults
    } = savedDefaults;
    const columns = j.summary.columns || [];
    setReviewDrafts(emptyDrafts);
    setSelectedRows({});
    setJob(j);
    setConfirmation(null);
    setPage(j.page || 0);
    setRowView("all");
    // Completed imports cannot be edited, but their staged rows remain useful
    // for auditing, including after a rollback.
    setReviewSection(
      ["IMPORTED", "ROLLED_BACK"].includes(j.status) ? "all" : "summary",
    );
    setQuickActionMessage("");
    setGroupValues(j.groupValues || []);
    setDefaults(
      Object.keys(productDefaults).length
        ? { ...defaultImportDefaults(productDefaults.vat || defaults.vat), ...productDefaults }
        : defaultImportDefaults(defaults.vat),
    );
    setGuidedGroupColumn(
      j.groupColumn ||
        guided?.groupColumn ||
        columns.find(
          (c: string) =>
            normalizeHeader(c) === normalizeHeader(supplierSimpleColumns.groupColumn),
        ) ||
        "Activity",
    );
    setGuidedDefaultPreset(
      guided?.defaultPreset ? cleanPreset(guided.defaultPreset) : defaultDiscountPreset(),
    );
    setGuidedGroupPresets(
      Object.fromEntries(
        Object.entries(guided?.groupPresets || {}).map(([key, value]) => [
          key,
          cleanPreset(value as DiscountPreset),
        ]),
      ),
    );
    let nextMapping = j.mapping;
    if (!Object.keys(j.mapping).length) {
      const auto: Record<string, string> = {};
      for (const field of mappingFields) {
        const found = findMappedColumn(columns, field);
        if (found) auto[field] = found;
      }
      nextMapping = auto;
    }
    const isQuote =
      j.summary?.profile === "SUPPLIER_QUOTE" || hasSupplierQuoteColumns(columns);
    if (isQuote && !Object.keys(j.mapping).length)
      nextMapping = {
        partNumber: supplierQuoteColumns.partNumber,
        description: supplierQuoteColumns.description,
        unit: supplierQuoteColumns.unit,
      };
    setMapping(nextMapping);
    const isSimple = isSupplierSimpleMapping(nextMapping, columns) || hasSupplierSimpleColumns(columns);
    setQuickImportMode(Boolean(quickImport ?? isSimple));
    setImportProfile(
      isQuote
        ? "SUPPLIER_QUOTE"
        : isSimple
        ? "SUPPLIER_SIMPLE"
        : guided?.mode === "PUBLIC_PRICE_DISCOUNT"
          ? "PUBLIC_PRICE_DISCOUNT"
          : "STANDARD",
    );
    setMode(j.mode || (isSimple ? "CREATE_UPDATE" : "UPDATE_ONLY"));
    setSupplierQuotePriceRole(
      savedSupplierQuotePriceRole ||
        supplierQuotePriceTargets.find(
          ([field]) => nextMapping[field] === supplierQuoteColumns.price,
        )?.[0] ||
        "",
    );
  }
  async function reopenForMapping() {
    if (!job) return;
    if (
      !(await showConfirm(
        t(
          "Reopen this import for mapping? Imported product changes will be rolled back first. Later product edits can block this action.",
          "إعادة فتح هذا الاستيراد للربط؟ سيتم التراجع عن تغييرات الأصناف المستوردة أولاً. قد تمنع تعديلات الأصناف اللاحقة هذا الإجراء.",
        ),
      ))
    )
      return;
    await onAction(
      {
        saving: t("Reopening import…", "جارٍ إعادة فتح الاستيراد…"),
        success: t("Import reopened", "تمت إعادة فتح الاستيراد"),
        successDetail: t(
          "The original file is ready for mapping again.",
          "الملف الأصلي جاهز للربط مرة أخرى.",
        ),
        error: t("Import could not be reopened", "تعذر إعادة فتح الاستيراد"),
      },
      async () => {
        await api("imports/" + job.id + "/reopen", "POST", {
          version: job.version,
        });
        await open(job.id);
        await load();
      },
    );
  }
  const presetForGroup = (groupValue: string) =>
    guidedGroupPresets[groupValue] || guidedDefaultPreset;
  const supplierQuotePricingDefaults =
    supplierQuotePriceRole === "cost"
      ? { method: "COST_MARKUP", markup: "0", baseDiscount: "0" }
      : supplierQuotePriceRole === "listPrice"
        ? { method: "LIST_DISCOUNT" }
        : supplierQuotePriceRole
          ? { defaultLevel: supplierQuotePriceRole.split(".")[0] }
          : {};
  const saveDefaults = guidedMode
    ? {
        ...defaults,
        quickImport: quickImportMode,
        guidedImport: {
          mode: "PUBLIC_PRICE_DISCOUNT",
          groupColumn: guidedGroupColumn || undefined,
          defaultPreset: cleanPreset(guidedDefaultPreset),
          groupPresets: Object.fromEntries(
            Object.entries(guidedGroupPresets).map(([groupValue, preset]) => {
              const typedPreset = preset as DiscountPreset;
              return [groupValue, cleanPreset(typedPreset)];
            }),
          ),
        },
      }
    : {
        ...defaults,
        quickImport: quickImportMode,
        ...(supplierQuoteMode
          ? {
              ...supplierQuotePricingDefaults,
              supplierQuotePriceRole: supplierQuotePriceRole || undefined,
            }
          : {}),
      };
  const reviewHeading = quickImportMode
    ? t("2. Quick summary & optional repair", "٢. ملخص سريع وإصلاح اختياري")
    : t("2. Review every row", "٢. مراجعة كل صف");
  const readyRows = job?.reviewStats?.readyRows ?? 0;
  const problemRows =
    job?.rowViewCounts?.repairRows ?? job?.reviewStats?.problemRows ?? 0;
  const skippedRows = job?.quickStats?.skippedRows ?? 0;
  const totalRows = job?.totalRows ?? job?.rows?.length ?? 0;
  const visibleRowHeading =
    reviewSection === "repair"
      ? t("Repair items", "عناصر الإصلاح")
      : t("All rows", "كل الصفوف");
  const showRowList = !!job && reviewSection !== "summary";
  const reviewEditable = job?.status === "AWAITING_REVIEW";
  const visibleRowIds: string[] = (job?.rows ?? []).map((row: any) => row.id);
  const selectedVisibleIds = visibleRowIds.filter(
    (id: string) => selectedRows[id],
  );
  const selectedVisibleSet = new Set(selectedVisibleIds);
  const selectedVisibleCount = selectedVisibleIds.length;
  const allVisibleSelected =
    visibleRowIds.length > 0 && visibleRowIds.every((id: string) => selectedRows[id]);
  const someVisibleSelected =
    visibleRowIds.some((id: string) => selectedRows[id]) && !allVisibleSelected;
  const updateSelectedRows = (updates: { decision?: string; verified?: boolean }) => {
    if (!job || !reviewEditable || !selectedVisibleCount) return;
    setReviewDrafts((current) => ({
      ...current,
      ...Object.fromEntries(
        selectedVisibleIds.map((id) => [id, { ...current[id], ...updates }]),
      ),
    }));
    setJob({
      ...job,
      rows: applyRowUpdates(job.rows, selectedVisibleSet, updates),
    });
  };
  return (
    <>
      <div className="actions wrap">
        <a href={appPath("/api/v1/templates/simple")}>
          {t(
            "Download Simple Price Update (Excel)",
            "تنزيل نموذج تحديث الأسعار",
          )}
        </a>
        <a href={appPath("/api/v1/templates/supplier-simple")}>
          {t(
            "Download Simple Supplier Pricelist (Excel)",
            "تنزيل نموذج قائمة المورد البسيطة",
          )}
        </a>
        <a href={appPath("/api/v1/templates/advanced")}>
          {t(
            "Download Advanced Catalog (Excel)",
            "تنزيل نموذج الكتالوج المتقدم",
          )}
        </a>
      </div>
      <div className="section-title">
        <div>
          <h2>{t("Safe supplier imports", "استيراد آمن من الموردين")}</h2>
          <p className="muted">
            {t(
              quickImportMode
                ? "Upload → map → summary → import. Valid rows import together, and skipped rows stay available for repair."
                : "Upload → map → review → verify → confirm. Nothing publishes automatically.",
              quickImportMode
                ? "رفع ← ربط ← ملخص ← استيراد. يتم استيراد الصفوف الصالحة معاً وتبقى الصفوف المتخطاة متاحة للإصلاح."
                : "رفع ← ربط ← مراجعة ← تحقق ← تأكيد. لا يتم النشر تلقائياً.",
            )}
          </p>
        </div>
      </div>
      <label className="upload-zone">
        {t(
          "Choose Excel, CSV, or PDF price list",
          "اختر قائمة أسعار Excel أو CSV أو PDF",
        )}
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          disabled={busy || actionBusy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              onAction(
                {
                  saving: t(
                    "Uploading import…",
                    "جارٍ رفع الاستيراد…",
                  ),
                  success: t(
                    "Import uploaded",
                    "تم رفع الاستيراد",
                  ),
                  successDetail: t(
                    "The file is queued for review now.",
                    "تمت إضافة الملف للمراجعة الآن.",
                  ),
                  error: t(
                    "Import could not be uploaded",
                    "تعذر رفع الاستيراد",
                  ),
                },
                async () => {
                  const form = new FormData();
                  form.append("file", file);
                  await api("imports", "POST", form);
                  await load();
                },
              );
          }}
        />
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t("File", "الملف")}</th>
              <th>{t("Status", "الحالة")}</th>
              <th>{t("Rows", "الصفوف")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  {j.filename}
                  <small>{new Date(j.created_at).toLocaleString()}</small>
                </td>
                <td>
                  <span className="pill">{j.status}</span>
                  {j.error && <small>{j.error}</small>}
                </td>
                <td>{j.summary.rows ?? "—"}</td>
                <td>
                  <button
                    disabled={busy || actionBusy}
                    onClick={() => run(() => open(j.id))}
                  >
                    {t("Review", "مراجعة")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {job && (
        <div className="modal-backdrop">
          <section className="modal wide">
            <div className="section-title">
              <h2>{job.filename}</h2>
              <button onClick={() => setJob(null)}>×</button>
            </div>
            <p>
              {job.status} · {job.totalRows ?? job.rows.length} {t("rows", "صفوف")}
            </p>
            {job.reviewStats && (
              <p className="muted">
                {t("Ready", "جاهز")}: {job.reviewStats.readyRows} ·{" "}
                {t("Unverified", "غير متحقق")}: {job.reviewStats.unverifiedRows} ·{" "}
                {t("Problem rows", "صفوف بها مشاكل")}: {job.reviewStats.problemRows}
              </p>
            )}
            {job.status === "AWAITING_REVIEW" &&
              job.reviewStats?.readyRows === 0 && (
                <div className="notice warning">
                  {t(
                    "This file has not changed the catalog yet. Apply the mapping, mark the verified rows ready, then import the ready rows before checking Lookup.",
                    "لم يغيّر هذا الملف الكتالوج بعد. طبّق الربط، جهّز الصفوف التي تحققت منها، ثم استورد الصفوف الجاهزة قبل فحص البحث.",
                  )}
                </div>
              )}
            {job.summary.warnings?.map((w: string) => (
              <div className="notice" key={w}>
                {w}
              </div>
            ))}
            {defaults.method === "LIST_DISCOUNT" &&
              mapping.cost &&
              !mapping.listPrice &&
              !mapping["END_CUSTOMER.listPrice"] && (
                <div role="alert" className="notice warning">
                  {t(
                    "Check mapping: the supplier price column is mapped to COST, but LIST_DISCOUNT needs a list price. Map P.L (SAR) to listPrice before validating; do not publish zero prices by mistake.",
                    "تحقق من الربط: عمود سعر المورد مرتبط بالتكلفة بينما تسعير القائمة يحتاج سعر قائمة. اربط P.L (SAR) بسعر القائمة قبل التحقق.",
                  )}
                </div>
              )}
            {job.status === "AWAITING_REVIEW" && (
              <>
                <h3>
                  {t(
                    "1. Column mapping & defaults",
                    "١. ربط الأعمدة والقيم الافتراضية",
                  )}
                </h3>
                <div className="form-grid three">
                  <label>
                    {t("Import mode", "وضع الاستيراد")}
                    <select
                      value={mode}
                      disabled={supplierSimpleMode}
                      onChange={(e) => setMode(e.target.value)}
                    >
                      <option value="UPDATE_ONLY">
                        Update Existing Only / تحديث الموجود فقط
                      </option>
                      <option value="CREATE_UPDATE">
                        Create & Update / إنشاء وتحديث
                      </option>
                    </select>
                  </label>
                  <label>
                    {t("Import pricing flow", "مسار تسعير الاستيراد")}
                    <select
                      value={importProfile}
                      onChange={(e) => {
                        const p = e.target.value as ImportProfile;
                        setImportProfile(p);
                        if (p === "SUPPLIER_SIMPLE") {
                          setMode("CREATE_UPDATE");
                        }
                      }}
                    >
                      <option value="STANDARD">
                        {t(
                          "Standard field mapping",
                          "ربط الحقول القياسي",
                        )}
                      </option>
                      <option value="PUBLIC_PRICE_DISCOUNT">
                        {t(
                          "Discount-based public pricelist",
                          "قائمة سعر عام مع خصومات",
                        )}
                      </option>
                      <option value="SUPPLIER_SIMPLE">
                        {t(
                          "Simple supplier pricelist",
                          "قائمة مورد بسيطة",
                        )}
                      </option>
                      <option value="SUPPLIER_QUOTE">
                        {t("Supplier quotation PDF", "عرض سعر المورد PDF")}
                      </option>
                    </select>
                  </label>
                  <label>
                    {t("Admin workflow", "مسار المدير")}
                    <select
                      value={quickImportMode ? "QUICK" : "STRICT"}
                      onChange={(e) => setQuickImportMode(e.target.value === "QUICK")}
                    >
                      <option value="QUICK">
                        {t("Quick summary + import", "ملخص سريع + استيراد")}
                      </option>
                      <option value="STRICT">
                        {t("Strict row review", "مراجعة صارمة للصفوف")}
                      </option>
                    </select>
                  </label>
                  {(supplierQuoteMode
                    ? ["partNumber", "description", "unit"]
                    : supplierSimpleMode
                      ? supplierSimpleFields
                      : mappingFields
                  ).map(
                    (field) => (
                    <label key={field}>
                      {t(
                        mappingLabel(field, importProfile),
                        mappingLabel(field, importProfile),
                      )}
                      <select
                        value={mapping[field] || ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [field]: e.target.value })
                        }
                      >
                        <option value="">
                          {t("Use default / empty", "افتراضي / فارغ")}
                        </option>
                        {job.summary.columns?.map((c: string) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    ),
                  )}
                  {supplierQuoteMode && (
                    <label>
                      {t("Save quoted unit price as", "حفظ سعر الوحدة المعروض كـ")}
                      <select
                        value={supplierQuotePriceRole}
                        onChange={(e) => setSupplierQuotePriceRole(e.target.value)}
                      >
                        <option value="">
                          {t("Choose before validating", "اختر قبل التحقق")}
                        </option>
                        {supplierQuotePriceTargets.map(([value, label]) => (
                          <option key={value} value={value}>
                            {t(label, label)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {guidedMode ? (
                    <>
                      <label>
                        {t(
                          "Activity grouping column",
                          "عمود تجميع النشاط",
                        )}
                        <select
                          value={guidedGroupColumn}
                          onChange={(e) => {
                            const value = e.target.value;
                            setGuidedGroupColumn(value);
                            run(async () => {
                              await loadJobPage(job.id, 0, value);
                              setConfirmation(null);
                            });
                          }}
                        >
                          <option value="">
                            {t("No grouping", "بدون تجميع")}
                          </option>
                          {job.summary.columns?.map((c: string) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <div className="field-row" style={{ display: "flex", gap: "20px", alignItems: "center", marginBottom: "15px", gridColumn: "span 2" }}>
                        <label className="check" style={{ display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={linkDiscounts}
                            onChange={(e) => handleToggleLinkDiscounts(e.target.checked)}
                          />
                        {t("Link final + wholesale discounts", "ربط الخصم النهائي مع خصم الجملة")}
                        </label>
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => setShowAdvancedDiscounts(!showAdvancedDiscounts)}
                        >
                          {showAdvancedDiscounts 
                            ? t("Hide advanced discounts", "إخفاء الخصومات المتقدمة")
                            : t("Show advanced discounts", "عرض الخصومات المتقدمة")}
                        </button>
                      </div>
                      {!showAdvancedDiscounts ? (
                        <label>
                          {t("Default discount %", "الخصم الافتراضي %")}
                          <input
                            value={guidedDefaultPreset.finalDiscount}
                            onChange={(e) => updateDefaultPreset("finalDiscount", e.target.value)}
                          />
                        </label>
                      ) : (
                        <>
                          <label>
                            {t("Default final discount %", "الخصم النهائي الافتراضي %")}
                            <input
                              value={guidedDefaultPreset.finalDiscount}
                              onChange={(e) => updateDefaultPreset("finalDiscount", e.target.value)}
                            />
                          </label>
                          <label>
                            {t("Default wholesale discount %", "خصم الجملة الافتراضي %")}
                            <input
                              value={guidedDefaultPreset.wholesaleDiscount}
                              onChange={(e) => updateDefaultPreset("wholesaleDiscount", e.target.value)}
                            />
                          </label>
                          <label>
                            {t("Default minimum discount %", "الحد الأدنى الافتراضي للخصم %")}
                            <input
                              value={guidedDefaultPreset.minimumDiscount}
                              onChange={(e) => updateDefaultPreset("minimumDiscount", e.target.value)}
                            />
                          </label>
                        </>
                      )}
                      <label>
                        {t("VAT %", "نسبة الضريبة %")}
                        <input
                          value={defaults.vat}
                          onChange={(e) =>
                            setDefaults({ ...defaults, vat: e.target.value })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        {t("Pricing method", "طريقة التسعير")}
                        <select
                          value={defaults.method}
                          onChange={(e) =>
                            setDefaults({ ...defaults, method: e.target.value })
                          }
                        >
                          <option>COST_MARKUP</option>
                          <option>LIST_DISCOUNT</option>
                        </select>
                      </label>
                      {["markup", "baseDiscount", "vat"].map((f) => (
                        <label key={f}>
                          {f}
                          <input
                            value={defaults[f]}
                            onChange={(e) =>
                              setDefaults({ ...defaults, [f]: e.target.value })
                            }
                          />
                        </label>
                      ))}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={defaults.minimumEnabled}
                          onChange={(e) =>
                            setDefaults({
                              ...defaults,
                              minimumEnabled: e.target.checked,
                            })
                          }
                        />
                        {t("Enable minimum protection", "تفعيل حماية الحد الأدنى")}
                      </label>
                    </>
                  )}
                </div>
                {guidedMode && (
                  <>
                    <div className="notice">
                      {t(
                        supplierSimpleMode
                          ? "Simple supplier mode is pre-tuned for sheets with Part Reference, Local Description, Activity, and Public Pricelist. It creates or updates products, applies LIST_DISCOUNT pricing, builds a WHOLESALE level from the wholesale discount, and converts minimum discount % into the saved minimum final price."
                          : "Guided mode treats the mapped public price column as listPrice, applies LIST_DISCOUNT pricing, creates a WHOLESALE level from the wholesale discount, and converts minimum discount % into the saved minimum final price.",
                        supplierSimpleMode
                          ? "وضع المورد البسيط مهيأ لملفات Part Reference وLocal Description وActivity وPublic Pricelist. ينشئ أو يحدّث الأصناف، ويطبق تسعير الخصم من القائمة، وينشئ مستوى جملة من خصم الجملة، ويحوّل نسبة الحد الأدنى للخصم إلى أقل سعر نهائي محفوظ."
                          : "الوضع الموجه يعتبر عمود السعر العام المرتبط كسعر قائمة، ويطبق تسعير الخصم من القائمة، وينشئ مستوى جملة من خصم الجملة، ويحوّل نسبة الحد الأدنى للخصم إلى أقل سعر نهائي محفوظ.",
                      )}
                    </div>
                    {supplierSimpleMode && (
                      <div className="notice">
                        {t(
                          "Recommended for your common supplier sheet: Part Reference -> part number, Local Description -> description, Public Pricelist -> public price, Activity -> grouped discount presets.",
                          "مناسب لملف المورد المعتاد لديك: Part Reference لرقم الصنف، وLocal Description للوصف، وPublic Pricelist للسعر العام، وActivity لتجميع الخصومات.",
                        )}
                      </div>
                    )}
                    <div className="notice">
                      {t(
                        `Preview on public price 100: final ${previewPrice(guidedDefaultPreset.finalDiscount)}, wholesale ${previewPrice(guidedDefaultPreset.wholesaleDiscount)}, minimum floor ${previewPrice(guidedDefaultPreset.minimumDiscount)}.`,
                        `مثال على سعر عام 100: النهائي ${previewPrice(guidedDefaultPreset.finalDiscount)}، الجملة ${previewPrice(guidedDefaultPreset.wholesaleDiscount)}، الحد الأدنى ${previewPrice(guidedDefaultPreset.minimumDiscount)}.`,
                      )}
                    </div>
                    {!!groupValues.length && (
                      <>
                        <h4>
                          {t(
                            "Activity presets",
                            "إعدادات النشاط",
                          )}
                        </h4>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>{t("Activity", "النشاط")}</th>
                                <th>
                                  {showAdvancedDiscounts 
                                    ? t("Final discount %", "الخصم النهائي %") 
                                    : t("Discount %", "الخصم %")}
                                </th>
                                {showAdvancedDiscounts && (
                                  <>
                                    <th>{t("Wholesale discount %", "خصم الجملة %")}</th>
                                    <th>{t("Minimum discount %", "الحد الأدنى للخصم %")}</th>
                                  </>
                                )}
                                <th>{t("Preview", "معاينة")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupValues.map((groupValue) => {
                                const preset = presetForGroup(groupValue);
                                return (
                                  <tr key={groupValue}>
                                    <td>{groupValue}</td>
                                    <td>
                                      <input
                                        value={preset.finalDiscount}
                                        onChange={(e) => updateGroupPreset(groupValue, "finalDiscount", e.target.value)}
                                      />
                                    </td>
                                    {showAdvancedDiscounts && (
                                      <>
                                        <td>
                                          <input
                                            value={preset.wholesaleDiscount}
                                            onChange={(e) => updateGroupPreset(groupValue, "wholesaleDiscount", e.target.value)}
                                          />
                                        </td>
                                        <td>
                                          <input
                                            value={preset.minimumDiscount}
                                            onChange={(e) => updateGroupPreset(groupValue, "minimumDiscount", e.target.value)}
                                          />
                                        </td>
                                      </>
                                    )}
                                    <td>
                                      {t("Final", "النهائي")}: {previewPrice(preset.finalDiscount)}
                                      {" · "}
                                      {t("Wholesale", "الجملة")}: {previewPrice(preset.wholesaleDiscount)}
                                      {" · "}
                                      {t("Minimum", "الحد الأدنى")}: {previewPrice(preset.minimumDiscount)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                )}
                <button
                  disabled={
                    busy ||
                    actionBusy ||
                    (supplierQuoteMode && !supplierQuotePriceRole)
                  }
                  onClick={() =>
                    onAction(
                      {
                        saving: t(
                          "Saving import mapping…",
                          "جارٍ حفظ ربط الاستيراد…",
                        ),
                        success: t(
                          "Import mapping saved",
                          "تم حفظ ربط الاستيراد",
                        ),
                        successDetail: t(
                          quickImportMode
                            ? "The file was prepared for quick import."
                            : "The file was validated with the new mapping.",
                          quickImportMode
                            ? "تم تجهيز الملف للاستيراد السريع."
                            : "تم التحقق من الملف باستخدام الربط الجديد.",
                        ),
                        error: t(
                          "Import mapping could not be saved",
                          "تعذر حفظ ربط الاستيراد",
                        ),
                      },
                      async () => {
                        await api("imports/" + job.id + "/mapping", "POST", {
                          mapping: Object.fromEntries(
                            Object.entries({
                              ...mapping,
                              ...(supplierQuoteMode
                                ? Object.fromEntries(
                                    supplierQuotePriceTargets.map(([field]) => [
                                      field,
                                      "",
                                    ]),
                                  )
                                : {}),
                              ...(supplierQuoteMode && supplierQuotePriceRole
                                ? {
                                    [supplierQuotePriceRole]:
                                      supplierQuoteColumns.price,
                                  }
                                : {}),
                            }).filter(([, v]) => v),
                          ),
                          defaults: saveDefaults,
                          version: job.version,
                          mode,
                          quickImport: quickImportMode,
                        });
                        await open(job.id);
                        await load();
                      },
                    )
                  }
                >
                  {quickImportMode
                    ? t("Prepare quick import", "تجهيز الاستيراد السريع")
                    : t("Apply mapping & validate", "تطبيق الربط والتحقق")}
                </button>
                <div className="import-review-shell">
                  <div className="import-review-header">
                    <div>
                      <h3>{reviewHeading}</h3>
                      <p className="muted import-review-copy">
                        {t(
                          quickImportMode
                            ? "Start from the summary. Import-ready rows move together, and problem rows stay available in Repair items."
                            : supplierSimpleMode
                              ? "Start from the summary, then open All rows or Repair items to check details before publishing."
                              : "Start from the summary, then review all rows or only problem rows before publishing.",
                          quickImportMode
                            ? "ابدأ من الملخص. يتم استيراد الصفوف الجاهزة معاً وتبقى الصفوف التي بها مشكلات متاحة في عناصر الإصلاح."
                            : supplierSimpleMode
                              ? "ابدأ من الملخص ثم افتح كل الصفوف أو عناصر الإصلاح لفحص التفاصيل قبل النشر."
                              : "ابدأ من الملخص ثم راجع كل الصفوف أو صفوف المشكلات فقط قبل النشر.",
                        )}
                      </p>
                    </div>
                    <div className="import-segmented">
                      <button
                        type="button"
                        className={reviewSection === "summary" ? "primary" : ""}
                        disabled={busy || actionBusy}
                        onClick={() => void openReviewSection("summary")}
                      >
                        {t("Summary", "الملخص")}
                      </button>
                      <button
                        type="button"
                        className={reviewSection === "all" ? "primary" : ""}
                        disabled={busy || actionBusy}
                        onClick={() => void run(async () => await openReviewSection("all"))}
                      >
                        {t("All rows", "كل الصفوف")} ({job.rowViewCounts?.allRows ?? job.totalRows})
                      </button>
                      <button
                        type="button"
                        className={reviewSection === "repair" ? "primary" : ""}
                        disabled={busy || actionBusy || !(job.rowViewCounts?.repairRows ?? 0)}
                        onClick={() => void run(async () => await openReviewSection("repair"))}
                      >
                        {t("Repair items", "عناصر الإصلاح")} ({job.rowViewCounts?.repairRows ?? 0})
                      </button>
                    </div>
                  </div>
                  <div className="import-summary-grid">
                    <div className="import-summary-card">
                      <span>{t("Total rows", "إجمالي الصفوف")}</span>
                      <strong>{totalRows}</strong>
                    </div>
                    <div className="import-summary-card success">
                      <span>{t("Ready to import", "جاهزة للاستيراد")}</span>
                      <strong>{readyRows}</strong>
                    </div>
                    <div className="import-summary-card warning">
                      <span>{t("Needs repair", "تحتاج إصلاح")}</span>
                      <strong>{problemRows}</strong>
                    </div>
                    <div className="import-summary-card">
                      <span>{t("Skipped", "المتخطاة")}</span>
                      <strong>{skippedRows}</strong>
                    </div>
                  </div>
                  {quickImportMode && job.quickStats && (
                    <div className="notice import-summary-note">
                      {t("Valid rows", "الصفوف الصالحة")}: {job.quickStats.validRows} ·{" "}
                      {t("Invalid rows", "الصفوف غير الصالحة")}: {job.quickStats.invalidRows} ·{" "}
                      {t("Selected", "المحددة")}: {job.quickStats.selectedRows} ·{" "}
                      {t("Skipped", "المتخطاة")}: {job.quickStats.skippedRows}
                    </div>
                  )}
                  {reviewSection === "summary" && (
                    <div className="review-panel import-summary-panel">
                      <div className="import-action-strip">
                        <button
                          className="primary"
                          style={{ backgroundColor: "#2e7d32", color: "#fff", borderColor: "#2e7d32" }}
                          disabled={busy || actionBusy}
                          onClick={async () => {
                            if (
                              await showConfirm(
                                quickImportMode
                                  ? t(
                                      "Import all valid rows now and keep invalid rows available for repair afterward?",
                                      "استيراد كل الصفوف الصالحة الآن مع إبقاء الصفوف غير الصالحة متاحة للإصلاح بعد ذلك؟",
                                    )
                                  : t(
                                      "Auto-approve and import all valid rows directly? This will import all rows without errors and skip any problem rows.",
                                      "تأكيد الموافقة التلقائية واستيراد كافة الصفوف الصالحة مباشرة؟ سيقوم هذا باستيراد الصفوف الخالية من الأخطاء وتخطي الصفوف التي بها مشكلات."
                                    )
                              )
                            ) {
                              onAction(
                                {
                                  saving: t("Importing ready rows…", "جارٍ استيراد الصفوف الجاهزة…"),
                                  success: quickImportMode
                                    ? t("Quick import completed", "اكتمل الاستيراد السريع")
                                    : t("Auto-import completed", "اكتمل الاستيراد التلقائي"),
                                  successDetail: quickImportMode
                                    ? t(
                                        "Valid rows were imported and invalid rows stayed available for repair.",
                                        "تم استيراد الصفوف الصالحة وبقيت الصفوف غير الصالحة متاحة للإصلاح.",
                                      )
                                    : t("All valid rows were successfully imported to the catalog.", "تم استيراد جميع الصفوف الصالحة بنجاح إلى الكتالوج."),
                                  error: quickImportMode
                                    ? t("Quick import failed", "فشل الاستيراد السريع")
                                    : t("Auto-import failed", "فشل الاستيراد التلقائي"),
                                },
                                async () => {
                                  await api("imports/" + job.id + "/auto-confirm", "POST", {
                                    version: job.version,
                                  });
                                  await open(job.id);
                                  await load();
                                }
                              );
                            }
                          }}
                        >
                          {t("Import ready rows", "استيراد الصفوف الجاهزة")}
                        </button>
                        <button
                          type="button"
                          disabled={busy || actionBusy || !problemRows}
                          onClick={() =>
                            run(async () => {
                              await openReviewSection("repair");
                            })
                          }
                        >
                          {t("Open repair items", "فتح عناصر الإصلاح")}
                        </button>
                        <button
                          type="button"
                          disabled={busy || actionBusy}
                          onClick={() =>
                            onAction(
                              {
                                saving: t("Marking valid rows ready…", "جارٍ تجهيز الصفوف الصالحة…"),
                                success: t("Valid rows prepared", "تم تجهيز الصفوف الصالحة"),
                                successDetail: t(
                                  "Valid rows were marked ready across the full file.",
                                  "تم تجهيز الصفوف الصالحة عبر الملف بالكامل.",
                                ),
                                error: t("Could not prepare valid rows", "تعذر تجهيز الصفوف الصالحة"),
                              },
                              async () => {
                                await api("imports/" + job.id + "/bulk-review", "POST", {
                                  version: job.version,
                                  action: "SELECT_ALL",
                                });
                                const opened = await loadJobPage(job.id, 0, guidedGroupColumn, rowView);
                                setQuickActionMessage(
                                  t(
                                    `${opened.quickStats?.selectedRows ?? 0} rows are ready to import`,
                                    `أصبح ${opened.quickStats?.selectedRows ?? 0} صفوف جاهزة للاستيراد`,
                                  ),
                                );
                                await load();
                              },
                            )
                          }
                        >
                          {t("Mark valid rows ready", "تجهيز الصفوف الصالحة")}
                        </button>
                        <button
                          type="button"
                          disabled={busy || actionBusy}
                          onClick={() =>
                            onAction(
                              {
                                saving: t("Skipping problem rows…", "جارٍ تخطي صفوف المشكلات…"),
                                success: t("Problem rows skipped", "تم تخطي صفوف المشكلات"),
                                successDetail: t(
                                  "Problem rows were skipped across the full file.",
                                  "تم تخطي الصفوف التي بها مشكلات عبر الملف بالكامل.",
                                ),
                                error: t("Could not skip problem rows", "تعذر تخطي صفوف المشكلات"),
                              },
                              async () => {
                                await api("imports/" + job.id + "/bulk-review", "POST", {
                                  version: job.version,
                                  action: "SKIP_INVALID",
                                });
                                const opened = await loadJobPage(job.id, 0, guidedGroupColumn, rowView);
                                setQuickActionMessage(
                                  t(
                                    `${opened.quickStats?.skippedRows ?? 0} rows marked to skip. ${opened.reviewStats?.readyRows ?? 0} valid rows remain ready.`,
                                    `تم وضع ${opened.quickStats?.skippedRows ?? 0} صفوف للتخطي. ما زال ${opened.reviewStats?.readyRows ?? 0} صفوف صالحة جاهزة.`,
                                  ),
                                );
                                await load();
                              },
                            )
                          }
                        >
                          {t("Skip problem rows", "تخطي صفوف المشكلات")}
                        </button>
                      </div>
                      <p className="muted">
                        {t(
                          "Use Repair items only for rows with problems. Open Advanced bulk tools only when you want to automate a large review change.",
                          "استخدم عناصر الإصلاح فقط للصفوف التي بها مشكلات. افتح أدوات التعديل الجماعي المتقدمة فقط عند الحاجة لأتمتة تغيير مراجعة كبير.",
                        )}
                      </p>
                    </div>
                  )}
                </div>
                {quickImportMode && quickActionMessage && (
                  <div className="notice warning">{quickActionMessage}</div>
                )}
                {reviewSection !== "summary" && (
                <div className="actions wrap">
                  {quickImportMode ? (
                    <>
                      <button
                        disabled={busy || actionBusy}
                        onClick={() =>
                          onAction(
                            {
                              saving: t("Selecting all rows…", "جارٍ تحديد كل الصفوف…"),
                              success: t("All rows selected", "تم تحديد كل الصفوف"),
                              successDetail: t(
                                "Valid rows were selected across the full file.",
                                "تم تحديد الصفوف الصالحة عبر الملف بالكامل.",
                              ),
                              error: t("Could not select all rows", "تعذر تحديد كل الصفوف"),
                            },
                            async () => {
                              await api("imports/" + job.id + "/bulk-review", "POST", {
                                version: job.version,
                                action: "SELECT_ALL",
                              });
                              const opened = await loadJobPage(
                                job.id,
                                rowView === "repair" ? 0 : page,
                                guidedGroupColumn,
                                rowView,
                              );
                              setQuickActionMessage(
                                t(
                                  `${opened.quickStats?.selectedRows ?? 0} rows selected for import`,
                                  `تم تحديد ${opened.quickStats?.selectedRows ?? 0} صفوف للاستيراد`,
                                ),
                              );
                              await load();
                            },
                          )
                        }
                      >
                        {t("Mark valid rows ready", "تجهيز الصفوف الصالحة")}
                      </button>
                      <button
                        disabled={busy || actionBusy}
                        onClick={() =>
                          onAction(
                            {
                              saving: t("Skipping invalid rows…", "جارٍ تخطي الصفوف غير الصالحة…"),
                              success: t("Invalid rows skipped", "تم تخطي الصفوف غير الصالحة"),
                              successDetail: t(
                                "Problem rows were skipped across the full file.",
                                "تم تخطي الصفوف التي بها مشكلات عبر الملف بالكامل.",
                              ),
                              error: t("Could not skip invalid rows", "تعذر تخطي الصفوف غير الصالحة"),
                            },
                            async () => {
                              await api("imports/" + job.id + "/bulk-review", "POST", {
                                version: job.version,
                                action: "SKIP_INVALID",
                              });
                              const opened = await loadJobPage(
                                job.id,
                                rowView === "repair" ? 0 : page,
                                guidedGroupColumn,
                                rowView,
                              );
                              setQuickActionMessage(
                                t(
                                  `${opened.quickStats?.skippedRows ?? 0} rows marked to skip. ${opened.reviewStats?.readyRows ?? 0} valid rows remain ready to import`,
                                  `تم وضع ${opened.quickStats?.skippedRows ?? 0} صفوف للتخطي. ما زال ${opened.reviewStats?.readyRows ?? 0} صفوف صالحة جاهزة للاستيراد`,
                                ),
                              );
                              await load();
                            },
                          )
                        }
                      >
                        {t("Skip problem rows", "تخطي صفوف المشكلات")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setReviewDrafts((current) => ({
                            ...current,
                            ...Object.fromEntries(
                              job.rows.map((r: any) => [
                                r.id,
                                { ...current[r.id], decision: "SKIP" },
                              ]),
                            ),
                          }));
                          setJob({
                            ...job,
                            rows: job.rows.map((r: any) => ({
                              ...r,
                              decision: "SKIP",
                            })),
                          });
                        }}
                      >
                        {t("Skip visible rows", "تخطي الصفوف الظاهرة")}
                      </button>
                      <button
                        onClick={() => {
                          setReviewDrafts((current) => ({
                            ...current,
                            ...Object.fromEntries(
                              job.rows.map((r: any) => [
                                r.id,
                                {
                                  ...current[r.id],
                                  decision: r.errors.length ? "SKIP" : "UPDATE",
                                },
                              ]),
                            ),
                          }));
                          setJob({
                            ...job,
                            rows: job.rows.map((r: any) => ({
                              ...r,
                              decision: r.errors.length ? "SKIP" : "UPDATE",
                            })),
                          });
                        }}
                      >
                        {t(
                          "Select valid visible rows",
                          "تحديد الصفوف الصالحة الظاهرة",
                        )}
                      </button>
                    </>
                  )}
                </div>
                )}
                <details className="import-advanced-tools">
                  <summary>
                    {t("Advanced bulk tools", "أدوات التعديل الجماعي المتقدمة")}
                  </summary>
                  <p className="muted">
                    {t(
                      "Optional automation for large staged changes. Normal repair work should stay in Summary or Repair items.",
                      "أتمتة اختيارية للتغييرات المرحلية الكبيرة. أعمال الإصلاح العادية يجب أن تبقى في الملخص أو عناصر الإصلاح.",
                    )}
                  </p>
                  <BulkRules
                    t={t}
                    importId={job.id}
                    actionBusy={actionBusy}
                    onAction={onAction}
                    onApplied={() => loadJobPage(job.id, page, guidedGroupColumn)}
                  />
                </details>
              </>
            )}
            {showRowList && (
            <div className="table-scroll import-review-list">
              <div className="section-title">
                <h3>{visibleRowHeading}</h3>
                <span className="muted">
                  {reviewSection === "repair"
                    ? t(
                        "Only rows with problems are shown here.",
                        "هنا يتم عرض الصفوف التي بها مشكلات فقط.",
                      )
                    : t(
                        "Use this view when you want to inspect the full file row by row.",
                        "استخدم هذا العرض عند الحاجة لفحص الملف صفاً صفاً.",
                      )}
                </span>
              </div>
              <div className="import-selection-toolbar">
                {!reviewEditable && (
                  <span className="muted">
                    {t(
                      job?.status === "ROLLED_BACK"
                        ? "This import was rolled back. The original staged rows are retained here for review only."
                        : "These rows are read-only because this import was already completed. Review the problems here, then re-upload or remap the file to fix them.",
                      job?.status === "ROLLED_BACK"
                        ? "تم التراجع عن هذا الاستيراد. يتم الاحتفاظ بالصفوف المرحلية الأصلية هنا للمراجعة فقط."
                        : "هذه الصفوف للقراءة فقط لأن هذا الاستيراد اكتمل بالفعل. راجع المشكلات هنا ثم أعد رفع الملف أو أعد ربطه لإصلاحها.",
                    )}
                  </span>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={!reviewEditable}
                    ref={(input) => {
                      if (input) input.indeterminate = someVisibleSelected;
                    }}
                    aria-label={t("Select all visible rows", "تحديد كل الصفوف الظاهرة")}
                    onChange={(e) =>
                      setSelectedRows(
                        e.target.checked
                          ? Object.fromEntries(
                              visibleRowIds.map((id: string) => [id, true]),
                            )
                          : {},
                      )
                    }
                  />
                  {t("Select all visible", "تحديد الكل الظاهر")}
                </label>
                <span className="muted">
                  {t("Selected", "المحدد")}: {selectedVisibleCount}
                </span>
                <button
                  type="button"
                  disabled={!reviewEditable || !selectedVisibleCount}
                  onClick={() =>
                    setSelectedRows(
                      Object.fromEntries(
                        visibleRowIds
                          .filter((id: string) => !selectedRows[id])
                          .map((id: string) => [id, true]),
                      ),
                    )
                  }
                >
                  {t("Select visible", "تحديد الظاهر")}
                </button>
                <button
                  type="button"
                  disabled={!reviewEditable || !selectedVisibleCount}
                  onClick={() => setSelectedRows({})}
                >
                  {t("Clear selection", "مسح التحديد")}
                </button>
              </div>
              {reviewEditable && selectedVisibleCount > 0 && (
                <div className="import-bulk-bar">
                  <span>
                    {selectedVisibleCount}{" "}
                    {t("visible rows selected", "صفوف ظاهرة محددة")}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateSelectedRows({ decision: "UPDATE" })}
                  >
                    {t("Import changes", "استيراد التغييرات")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedRows({ decision: "KEEP" })}
                  >
                    {t("Keep existing", "إبقاء الحالي")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedRows({ decision: "SKIP" })}
                  >
                    {t("Ignore / Skip", "تجاهل / تخطي")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedRows({ decision: "REVIEW" })}
                  >
                    {t("Needs review", "بحاجة لمراجعة")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedRows({ verified: true })}
                  >
                    {t("Mark verified", "تحديد كمتحقق")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSelectedRows({ verified: false })}
                  >
                    {t("Unverify", "إلغاء التحقق")}
                  </button>
                </div>
              )}
              <table className="import-review-table">
                <thead>
                  <tr>
                    <th>{t("Select", "تحديد")}</th>
                    <th>#</th>
                    <th>{t("Incoming row", "الصف الوارد")}</th>
                    <th>{t("Status / problem", "الحالة / المشكلة")}</th>
                    <th>{t("Next action", "الإجراء التالي")}</th>
                    <th>{t("Verified", "تم التحقق")}</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.map((r: any) => (
                    <tr
                      key={r.id}
                      className={selectedRows[r.id] ? "selected-row" : ""}
                    >
                      <td data-label={t("Select", "تحديد")}>
                        <input
                          type="checkbox"
                          checked={!!selectedRows[r.id]}
                          disabled={!reviewEditable}
                          aria-label={`Select row ${r.row_number}`}
                          onChange={(e) =>
                            setSelectedRows((current) => ({
                              ...current,
                              [r.id]: e.target.checked,
                            }))
                          }
                        />
                      </td>
                      <td data-label="#">{r.row_number}</td>
                      <td data-label={t("Incoming row", "الصف الوارد")}>
                        <strong>
                          {r.proposed?.partNumber ||
                            t("Not mapped", "غير مربوط")}
                        </strong>
                        {mapping.partNumber && (
                          <small>
                            {t("Source part", "رقم الصنف من الملف")}:{" "}
                            {String(r.raw?.[mapping.partNumber] ?? "—")}
                          </small>
                        )}
                        <small>{r.proposed?.description}</small>
                        {guidedMode && mapping.listPrice && (
                          <small>
                            {t("Public price", "السعر العام")}:{" "}
                            {String(r.raw?.[mapping.listPrice] ?? "—")}
                            {guidedGroupColumn &&
                              String(r.raw?.[guidedGroupColumn] ?? "").trim() && (
                                <>
                                  {" · "}
                                  {t("Activity", "النشاط")}:{" "}
                                  {String(r.raw?.[guidedGroupColumn] ?? "").trim()}
                                </>
                              )}
                            {r.proposed?.listPrice && (
                              <>
                                {" · "}
                                {t("Final", "النهائي")}:{" "}
                                {previewPrice(String(r.proposed.baseDiscount), Number(r.proposed.listPrice))}
                                {" · "}
                                {t("Wholesale", "الجملة")}:{" "}
                                {previewPrice(
                                  String(
                                    (r.proposed.levels || []).find(
                                      (level: any) => level.code === "WHOLESALE",
                                    )?.baseDiscount ?? "0",
                                  ),
                                  Number(r.proposed.listPrice),
                                )}
                                {" · "}
                                {t("Minimum", "الحد الأدنى")}: {r.proposed.minimum}
                              </>
                            )}
                          </small>
                        )}
                        <details>
                          <summary>
                            {t("Source & differences", "المصدر والفروقات")}
                          </summary>
                          <pre>
                            {JSON.stringify(
                              {
                                source: r.raw,
                                current: r.current,
                                incoming: r.proposed,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                        {job.status === "AWAITING_REVIEW" && (
                          <button onClick={() => setEditing(r)}>
                            {t("Correct row", "تصحيح الصف")}
                          </button>
                        )}
                      </td>
                      <td data-label={t("Status / problem", "الحالة / المشكلة")}>
                        {!r.duplicate_id && r.proposed?.partNumber && (
                          <span className="pill warning">
                            {t("New Product (Will be created)", "منتج جديد (سيتم إنشاؤه)")}
                            {job.mode === "UPDATE_ONLY"
                              ? " · Update blocked"
                              : ""}
                          </span>
                        )}
                        {r.confidence === "LOW" && (
                          <span className="pill warning">
                            {t("LOW CONFIDENCE", "ثقة منخفضة")}
                          </span>
                        )}
                        {r.duplicate_id && (
                          <span className="pill">
                            {t("Existing Product (Will be updated)", "منتج موجود (سيتم تحديثه)")}
                          </span>
                        )}
                        <small className="error-text">
                          {r.errors.join("; ")}
                        </small>
                        {!!importProblemHint(r, t) && (
                          <small className="muted">{importProblemHint(r, t)}</small>
                        )}
                      </td>
                      <td data-label={t("Next action", "الإجراء التالي")}>
                        <select
                          disabled={!reviewEditable}
                          value={r.decision}
                          onChange={(e) => {
                            const decision = e.target.value;
                            setReviewDrafts((current) => ({
                              ...current,
                              [r.id]: { ...current[r.id], decision },
                            }));
                            setJob({
                              ...job,
                              rows: job.rows.map((x: any) =>
                                x.id === r.id ? { ...x, decision } : x,
                              ),
                            });
                          }}
                        >
                          {["REVIEW", "KEEP", "UPDATE", "SKIP"].map((d) => (
                            <option key={d} value={d}>
                              {decisionLabel(d, t)}
                            </option>
                          ))}
                        </select>
                        <small>{decisionLabel(r.decision, t)}</small>
                      </td>
                      <td data-label={t("Verified", "تم التحقق")}>
                        <input
                          type="checkbox"
                          disabled={!reviewEditable}
                          checked={r.verified}
                          aria-label={"Verify row " + r.row_number}
                          onChange={(e) => {
                            const verified = e.target.checked;
                            setReviewDrafts((current) => ({
                              ...current,
                              [r.id]: { ...current[r.id], verified },
                            }));
                            setJob({
                              ...job,
                              rows: job.rows.map((x: any) =>
                                x.id === r.id ? { ...x, verified } : x,
                              ),
                            });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                  {!job.rows.length && (
                    <tr>
                      <td colSpan={6}>
                        {rowView === "repair"
                          ? t(
                              "No repair items on this import right now.",
                              "لا توجد عناصر إصلاح في هذا الاستيراد حالياً.",
                            )
                          : t(
                              "No rows are available on this page.",
                              "لا توجد صفوف متاحة في هذه الصفحة.",
                            )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
            {job.totalPages > 1 && (
              <div className="actions footer-actions">
                <button
                  disabled={(job.page ?? page) === 0 || busy || actionBusy}
                  onClick={() =>
                    run(async () => {
                      await changePage((job.page ?? page) - 1);
                    })
                  }
                >
                  Previous
                </button>
                <span>
                  {rowView === "repair"
                    ? t("Repair page", "صفحة الإصلاح")
                    : t("Page", "الصفحة")}{" "}
                  {(job.page ?? page) + 1} / {job.totalPages ?? 1}
                </span>
                <button
                  disabled={!job.hasMore || busy || actionBusy}
                  onClick={() =>
                    run(async () => {
                      await changePage((job.page ?? page) + 1);
                    })
                  }
                >
                  Next
                </button>
              </div>
            )}
            {job.status === "AWAITING_REVIEW" && (
              <div className="actions footer-actions">
                <button
                  disabled={busy || actionBusy}
                  onClick={() =>
                    onAction(
                      {
                        saving: t(
                          "Saving review decisions…",
                          "جارٍ حفظ قرارات المراجعة…",
                        ),
                        success: t(
                          "Review decisions saved",
                          "تم حفظ قرارات المراجعة",
                        ),
                        successDetail: t(
                          "The reviewed rows were saved successfully.",
                          "تم حفظ الصفوف المراجعة بنجاح.",
                        ),
                        error: t(
                          "Review decisions could not be saved",
                          "تعذر حفظ قرارات المراجعة",
                        ),
                      },
                      async () => {
                        const currentRowIds = new Set(job.rows.map((r: any) => r.id));
                        await api("imports/" + job.id + "/review", "POST", {
                          rows: job.rows.map((r: any) => ({
                            id: r.id,
                            decision: r.decision,
                            verified: r.verified,
                          })),
                        });
                        setReviewDrafts((current) =>
                          Object.fromEntries(
                            Object.entries(current).filter(
                              ([id]) => !currentRowIds.has(id),
                            ),
                          ),
                        );
                        await loadJobPage(job.id, page, guidedGroupColumn);
                        await load();
                      },
                    )
                  }
                >
                  {t("Save review decisions", "حفظ قرارات المراجعة")}
                </button>
                <button
                  className="primary"
                  style={{ backgroundColor: "#2e7d32", color: "#fff", borderColor: "#2e7d32" }}
                  disabled={busy || actionBusy}
                  onClick={async () => {
                    if (
                      await showConfirm(
                        quickImportMode
                          ? t(
                              "Import all valid rows now and keep invalid rows available for repair afterward?",
                              "استيراد كل الصفوف الصالحة الآن مع إبقاء الصفوف غير الصالحة متاحة للإصلاح بعد ذلك؟",
                            )
                          : t(
                              "Auto-approve and import all valid rows directly? This will import all rows without errors and skip any problem rows.",
                              "تأكيد الموافقة التلقائية واستيراد كافة الصفوف الصالحة مباشرة؟ سيقوم هذا باستيراد الصفوف الخالية من الأخطاء وتخطي الصفوف التي بها مشكلات."
                            )
                      )
                    ) {
                      onAction(
                        {
                          saving: quickImportMode
                            ? t("Importing valid rows…", "جارٍ استيراد الصفوف الصالحة…")
                            : t("Auto-importing valid rows…", "جارٍ الاستيراد التلقائي للصفوف الصالحة…"),
                          success: quickImportMode
                            ? t("Quick import completed", "اكتمل الاستيراد السريع")
                            : t("Auto-import completed", "اكتمل الاستيراد التلقائي"),
                          successDetail: quickImportMode
                            ? t(
                                "Valid rows were imported and invalid rows stayed available for repair.",
                                "تم استيراد الصفوف الصالحة وبقيت الصفوف غير الصالحة متاحة للإصلاح.",
                              )
                            : t("All valid rows were successfully imported to the catalog.", "تم استيراد جميع الصفوف الصالحة بنجاح إلى الكتالوج."),
                          error: quickImportMode
                            ? t("Quick import failed", "فشل الاستيراد السريع")
                            : t("Auto-import failed", "فشل الاستيراد التلقائي"),
                        },
                        async () => {
                          await api("imports/" + job.id + "/auto-confirm", "POST", {
                            version: job.version,
                          });
                          await open(job.id);
                          await load();
                        }
                      );
                    }
                  }}
                >
                  {quickImportMode
                    ? t("Import ready rows", "استيراد الصفوف الجاهزة")
                    : t("Import ready rows", "استيراد الصفوف الجاهزة")}
                </button>
                <button
                  className="primary"
                  disabled={busy || actionBusy || !confirmation}
                  onClick={async () => {
                    if (
                      await showConfirm(
                        t(
                          "Publish the saved, verified rows to the live catalog? Unsaved decisions are not applied.",
                          "نشر الصفوف المحفوظة والمتحقق منها؟ القرارات غير المحفوظة لا تطبق.",
                        ),
                      )
                    )
                      onAction(
                        {
                          saving: t(
                            "Confirming import…",
                            "جارٍ تأكيد الاستيراد…",
                          ),
                          success: t(
                            "Import confirmed",
                            "تم تأكيد الاستيراد",
                          ),
                          successDetail: t(
                            "The live catalog was updated from the reviewed rows.",
                            "تم تحديث الكتالوج المباشر من الصفوف المراجعة.",
                          ),
                          error: t(
                            "Import could not be confirmed",
                            "تعذر تأكيد الاستيراد",
                          ),
                        },
                        async () => {
                          await api("imports/" + job.id + "/confirm", "POST", {
                            version: job.version,
                            token: confirmation.token,
                          });
                          await open(job.id);
                          await load();
                        },
                      );
                  }}
                >
                  {t("Confirm import", "تأكيد الاستيراد")}
                </button>
                <button
                  disabled={busy || actionBusy}
                  onClick={() => run(async () => await loadConfirmation(job.id, page))}
                >
                  Preview saved prices / معاينة الأسعار المحفوظة
                </button>
              </div>
            )}
            {confirmation && (
              <div className="table-scroll">
                <h3>Final reviewed prices / الأسعار النهائية</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>Decision</th>
                      <th>Before → After (excl. VAT)</th>
                      {guidedMode && <th>Guided pricing</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {confirmation.items.map((r: any) => (
                        <tr key={r.id}>
                          <td>{r.proposed?.partNumber}</td>
                          <td>
                            {r.decision === "UPDATE"
                              ? t("Import changes", "استيراد التغييرات")
                              : r.decision === "SKIP"
                              ? t("Ignore / Skip", "تجاهل / تخطي")
                              : r.decision === "KEEP"
                              ? t("Keep existing", "إبقاء الحالي")
                              : r.decision} ·{" "}
                            {r.verified ? t("Verified", "تم التحقق") : t("Not verified", "لم يتم التحقق")}
                          </td>
                          <td>
                            {r.differences.map((d: any) => (
                              <div key={d.code}>
                                {d.code}: {d.before ?? "New"} → {d.after} (
                                {d.changePercent ?? "—"}%)
                              </div>
                            ))}
                          </td>
                          {guidedMode && (
                            <td>
                              {t("Public", "عام")}: {r.proposed?.listPrice ?? "—"}
                              <div>
                                {t("Final", "النهائي")}:{" "}
                                {previewPrice(
                                  String(r.proposed?.baseDiscount ?? "0"),
                                  Number(r.proposed?.listPrice ?? 0),
                                )}
                              </div>
                              <div>
                                {t("Wholesale", "الجملة")}:{" "}
                                {previewPrice(
                                  String(
                                    (r.proposed?.levels || []).find(
                                      (level: any) => level.code === "WHOLESALE",
                                    )?.baseDiscount ?? "0",
                                  ),
                                  Number(r.proposed?.listPrice ?? 0),
                                )}
                              </div>
                              <div>
                                {t("Minimum", "الحد الأدنى")}:{" "}
                                {r.proposed?.minimum ?? "—"}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {job.status === "IMPORTED" && (
              <>
                {quickImportMode && job.quickStats?.invalidRows > 0 && (
                  <div className="notice warning">
                    <span>
                      {t(
                        `This import finished with ${job.quickStats.invalidRows} skipped rows. Open Repair items to review what was skipped and why.`,
                        `اكتمل هذا الاستيراد مع ${job.quickStats.invalidRows} صفوف متخطاة. افتح عناصر الإصلاح لمراجعة ما تم تخطيه وسبب ذلك.`,
                      )}
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy || actionBusy}
                      onClick={() =>
                        run(async () => {
                          await openReviewSection("repair");
                        })
                      }
                    >
                      {t("Open repair items", "فتح عناصر الإصلاح")}
                    </button>
                  </div>
                )}
                <button
                  className="danger"
                  disabled={busy || actionBusy}
                  onClick={async () => {
                    if (
                      await showConfirm(
                        t(
                          "Roll back this import? Later product edits will block rollback.",
                          "التراجع عن الاستيراد؟ التعديلات اللاحقة ستمنع التراجع.",
                        ),
                      )
                    )
                      onAction(
                        {
                          saving: t(
                            "Rolling back import…",
                            "جارٍ التراجع عن الاستيراد…",
                          ),
                          success: t(
                            "Import rolled back",
                            "تم التراجع عن الاستيراد",
                          ),
                          successDetail: t(
                            "The imported changes were rolled back.",
                            "تم التراجع عن التغييرات المستوردة.",
                          ),
                          error: t(
                            "Import could not be rolled back",
                            "تعذر التراجع عن الاستيراد",
                          ),
                        },
                        async () => {
                          await api("imports/" + job.id + "/rollback", "POST", {});
                          await open(job.id);
                          await load();
                        },
                      );
                  }}
                >
                  {t("Roll back import", "التراجع عن الاستيراد")}
                </button>
                <button
                  disabled={busy || actionBusy}
                  onClick={() => void reopenForMapping()}
                >
                  {t("Reopen and remap", "إعادة الفتح وإعادة الربط")}
                </button>
              </>
            )}
            {job.status === "ROLLED_BACK" && (
              <button
                disabled={busy || actionBusy}
                onClick={() => void reopenForMapping()}
              >
                {t("Reopen and remap", "إعادة الفتح وإعادة الربط")}
              </button>
            )}
            {error && <div className="notice error">{error}</div>}
          </section>
        </div>
      )}
      {editing && (
        <ProductEditor
          t={t}
          initial={{ ...blankProduct, ...defaults, ...editing.proposed }}
          actionBusy={actionBusy}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            return onAction(
              {
                saving: t(
                  "Saving corrected row…",
                  "جارٍ حفظ الصف المصحح…",
                ),
                success: t(
                  "Corrected row saved",
                  "تم حفظ الصف المصحح",
                ),
                successDetail: t(
                  "The import row was updated for review.",
                  "تم تحديث صف الاستيراد للمراجعة.",
                ),
                error: t(
                  "Corrected row could not be saved",
                  "تعذر حفظ الصف المصحح",
                ),
              },
              async () => {
                await api("imports/" + job.id + "/review", "POST", {
                  rows: [
                    {
                      id: editing.id,
                      decision: "REVIEW",
                      verified: false,
                      proposed: p,
                    },
                  ],
                });
                setEditing(null);
                setReviewDrafts((current) => {
                  const next = { ...current };
                  delete next[editing.id];
                  return next;
                });
                await loadJobPage(job.id, page, guidedGroupColumn);
                await load();
              },
            );
          }}
        />
      )}
    </>
  );
}
