"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import type { AdminActionRunner } from "./admin-actions";
import { appPath } from "../shared/paths";
import ProductEditor, { blankProduct } from "./ProductEditor";
import { tierColumns } from "@/backend/pricing/transfer";
import BulkRules from "./BulkRules";
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
  | "SUPPLIER_SIMPLE";
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
    [confirmation, setConfirmation] = useState<any>(null),
    [job, setJob] = useState<any>(null),
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
    [editing, setEditing] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const guidedMode = importProfile !== "STANDARD";
  const supplierSimpleMode = importProfile === "SUPPLIER_SIMPLE";
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
      minimumEnabled: true,
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
  async function open(id: string) {
    const j = await api("imports/" + id);
    const savedDefaults = j.defaults || {};
    const guided = savedDefaults.guidedImport;
    const { guidedImport, ...productDefaults } = savedDefaults;
    const columns = j.summary.columns || [];
    setJob(j);
    setConfirmation(null);
    setPage(0);
    setMode(j.mode || "UPDATE_ONLY");
    setDefaults(
      Object.keys(productDefaults).length
        ? { ...defaultImportDefaults(productDefaults.vat || defaults.vat), ...productDefaults }
        : defaultImportDefaults(defaults.vat),
    );
    setGuidedGroupColumn(
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
    setMapping(nextMapping);
    setImportProfile(
      isSupplierSimpleMapping(nextMapping, columns) || hasSupplierSimpleColumns(columns)
        ? "SUPPLIER_SIMPLE"
        : guided?.mode === "PUBLIC_PRICE_DISCOUNT"
          ? "PUBLIC_PRICE_DISCOUNT"
          : "STANDARD",
    );
  }
  const rawGroupValues = ((job?.rows || []) as any[])
    .map((row) => String(row.raw?.[guidedGroupColumn] ?? "").trim())
    .filter(Boolean);
  const groupValues = [...new Set(rawGroupValues)].sort((a, b) =>
    a.localeCompare(b),
  );
  const presetForGroup = (groupValue: string) =>
    guidedGroupPresets[groupValue] || guidedDefaultPreset;
  const saveDefaults = guidedMode
    ? {
        ...defaults,
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
    : defaults;
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
              "Upload → map → review → verify → confirm. Nothing publishes automatically.",
              "رفع ← ربط ← مراجعة ← تحقق ← تأكيد. لا يتم النشر تلقائياً.",
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
              {job.status} · {job.rows.length} {t("rows", "صفوف")}
            </p>
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
                      onChange={(e) =>
                        setImportProfile(e.target.value as ImportProfile)
                      }
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
                    </select>
                  </label>
                  {(supplierSimpleMode ? supplierSimpleFields : mappingFields).map(
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
                  {guidedMode ? (
                    <>
                      <label>
                        {t(
                          "Activity grouping column",
                          "عمود تجميع النشاط",
                        )}
                        <select
                          value={guidedGroupColumn}
                          onChange={(e) => setGuidedGroupColumn(e.target.value)}
                        >
                          <option value="">
                            {t("No grouping", "بدون تجميع")}
                          </option>
                          {job.summary.columns?.map((c: string) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t("Default final discount %", "الخصم النهائي الافتراضي %")}
                        <input
                          value={guidedDefaultPreset.finalDiscount}
                          onChange={(e) =>
                            setGuidedDefaultPreset({
                              ...guidedDefaultPreset,
                              finalDiscount: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("Default wholesale discount %", "خصم الجملة الافتراضي %")}
                        <input
                          value={guidedDefaultPreset.wholesaleDiscount}
                          onChange={(e) =>
                            setGuidedDefaultPreset({
                              ...guidedDefaultPreset,
                              wholesaleDiscount: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        {t("Default minimum discount %", "الحد الأدنى الافتراضي للخصم %")}
                        <input
                          value={guidedDefaultPreset.minimumDiscount}
                          onChange={(e) =>
                            setGuidedDefaultPreset({
                              ...guidedDefaultPreset,
                              minimumDiscount: e.target.value,
                            })
                          }
                        />
                      </label>
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
                                <th>{t("Final discount %", "الخصم النهائي %")}</th>
                                <th>{t("Wholesale discount %", "خصم الجملة %")}</th>
                                <th>{t("Minimum discount %", "الحد الأدنى للخصم %")}</th>
                                <th>{t("Preview", "معاينة")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {groupValues.map((groupValue) => {
                                const preset = presetForGroup(groupValue);
                                return (
                                  <tr key={groupValue}>
                                    <td>{groupValue}</td>
                                    {(
                                      [
                                        "finalDiscount",
                                        "wholesaleDiscount",
                                        "minimumDiscount",
                                      ] as const
                                    ).map((field) => (
                                      <td key={field}>
                                        <input
                                          value={preset[field]}
                                          onChange={(e) =>
                                            setGuidedGroupPresets({
                                              ...guidedGroupPresets,
                                              [groupValue]: {
                                                ...preset,
                                                [field]: e.target.value,
                                              },
                                            })
                                          }
                                        />
                                      </td>
                                    ))}
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
                  disabled={busy || actionBusy}
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
                          "The file was validated with the new mapping.",
                          "تم التحقق من الملف باستخدام الربط الجديد.",
                        ),
                        error: t(
                          "Import mapping could not be saved",
                          "تعذر حفظ ربط الاستيراد",
                        ),
                      },
                      async () => {
                        await api("imports/" + job.id + "/mapping", "POST", {
                          mapping: Object.fromEntries(
                            Object.entries(mapping).filter(([, v]) => v),
                          ),
                          defaults: saveDefaults,
                          version: job.version,
                          mode,
                        });
                        await open(job.id);
                        await load();
                      },
                    )
                  }
                >
                  {t("Apply mapping & validate", "تطبيق الربط والتحقق")}
                </button>
                <h3>{t("2. Review every row", "٢. مراجعة كل صف")}</h3>
                <p className="muted">
                  {t(
                    supplierSimpleMode
                      ? "Simple supplier imports are set to Create & Update so missing part numbers can be created. Every row still requires review and verification before anything goes live."
                      : "UPDATE changes matched products. New items require Create & Update mode and individual verification. KEEP/SKIP leaves live data unchanged. Save decisions before previewing prices.",
                    supplierSimpleMode
                      ? "استيراد المورد البسيط مضبوط على إنشاء وتحديث حتى يمكن إنشاء الأصناف غير الموجودة. ومع ذلك كل صف يحتاج مراجعة وتحقق قبل النشر."
                      : "تحديث يغيّر الأصناف المطابقة. الأصناف الجديدة تتطلب وضع إنشاء وتحديث والتحقق الفردي. إبقاء/تخطي لا يغيّر البيانات. احفظ القرارات قبل معاينة الأسعار.",
                  )}
                </p>
                <div className="actions wrap">
                  <button
                    onClick={() =>
                      setJob({
                        ...job,
                        rows: job.rows.map((r: any) => ({
                          ...r,
                          decision: "SKIP",
                        })),
                      })
                    }
                  >
                    {t("Skip all", "تخطي الكل")}
                  </button>
                  <button
                    onClick={() =>
                      setJob({
                        ...job,
                        rows: job.rows.map((r: any) => ({
                          ...r,
                          decision: r.errors.length ? "SKIP" : "UPDATE",
                        })),
                      })
                    }
                  >
                    {t(
                      "Select valid rows for update",
                      "تحديد الصفوف الصالحة للتحديث",
                    )}
                  </button>
                </div>
                <BulkRules
                  t={t}
                  importId={job.id}
                  actionBusy={actionBusy}
                  onAction={onAction}
                  onApplied={() => open(job.id)}
                />
              </>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("Incoming / current", "وارد / حالي")}</th>
                    <th>{t("Validation", "التحقق")}</th>
                    <th>{t("Decision", "القرار")}</th>
                    <th>{t("Verified", "تم التحقق")}</th>
                  </tr>
                </thead>
                <tbody>
                  {job.rows.slice(page * 50, page * 50 + 50).map((r: any) => (
                    <tr key={r.id}>
                      <td>{r.row_number}</td>
                      <td>
                        <strong>
                          {r.proposed?.partNumber ||
                            t("Not mapped", "غير مربوط")}
                        </strong>
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
                      <td>
                        {!r.duplicate_id && r.proposed?.partNumber && (
                          <span className="pill warning">
                            {t("UNKNOWN ITEM", "صنف غير موجود")}
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
                            {t("EXISTING MATCH", "صنف موجود")}
                          </span>
                        )}
                        <small className="error-text">
                          {r.errors.join("; ")}
                        </small>
                      </td>
                      <td>
                        <select
                          disabled={job.status !== "AWAITING_REVIEW"}
                          value={r.decision}
                          onChange={(e) =>
                            setJob({
                              ...job,
                              rows: job.rows.map((x: any, n: number) =>
                                x.id === r.id
                                  ? { ...x, decision: e.target.value }
                                  : x,
                              ),
                            })
                          }
                        >
                          {["REVIEW", "KEEP", "UPDATE", "SKIP"].map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          disabled={job.status !== "AWAITING_REVIEW"}
                          checked={r.verified}
                          aria-label={"Verify row " + r.row_number}
                          onChange={(e) =>
                            setJob({
                              ...job,
                              rows: job.rows.map((x: any, n: number) =>
                                x.id === r.id
                                  ? { ...x, verified: e.target.checked }
                                  : x,
                              ),
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {job.status === "AWAITING_REVIEW" && (
              <div className="actions footer-actions">
                <button
                  disabled={page === 0 || busy || actionBusy}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} /{" "}
                  {Math.max(1, Math.ceil(job.rows.length / 50))}
                </span>
                <button
                  disabled={(page + 1) * 50 >= job.rows.length || busy || actionBusy}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
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
                        await api("imports/" + job.id + "/review", "POST", {
                          rows: job.rows.map((r: any) => ({
                            id: r.id,
                            decision: r.decision,
                            verified: r.verified,
                          })),
                        });
                        await open(job.id);
                        await load();
                      },
                    )
                  }
                >
                  {t("Save review decisions", "حفظ قرارات المراجعة")}
                </button>
                <button
                  className="primary"
                  disabled={busy || actionBusy || !confirmation}
                  onClick={() => {
                    if (
                      confirm(
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
                  onClick={() =>
                    run(async () =>
                      setConfirmation(
                        await api(
                          "imports/" + job.id + "/preview-confirmation",
                          "POST",
                          {},
                        ),
                      ),
                    )
                  }
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
                    {confirmation.items
                      .slice(page * 50, page * 50 + 50)
                      .map((r: any) => (
                        <tr key={r.id}>
                          <td>{r.proposed?.partNumber}</td>
                          <td>
                            {r.decision} ·{" "}
                            {r.verified ? "Verified" : "Not verified"}
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
              <button
                className="danger"
                disabled={busy || actionBusy}
                onClick={() => {
                  if (
                    confirm(
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
                await open(job.id);
                await load();
              },
            );
          }}
        />
      )}
    </>
  );
}
