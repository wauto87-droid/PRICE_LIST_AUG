"use client";
import { useEffect, useRef, useState } from "react";
import { sectionData, validateAdminData, type AdminResult } from "./admin-data";
import { api, type Translate } from "./api";
import {
  AdminActionModal,
  type AdminActionMessages,
  type AdminActionRunner,
  type AdminActionState,
} from "./admin-actions";
import {
  buildBulkItems,
  chunkBulkItems,
  formatBulkDeleteError,
  getProductSuggestions,
} from "./admin-products";
import { activeSuggestionIndex } from "./lookup-suggestions";
import { appPath } from "../shared/paths";
import ProductEditor, { blankProduct } from "./ProductEditor";
import Imports from "./Imports";
import BulkRules from "./BulkRules";
import QuotationSettings from "./QuotationSettings";
import DiscountRequestsAdmin from "./DiscountRequestsAdmin";
import { levelCodes, levelLabel } from "./levels";
import HistoryDetails from "./HistoryDetails";
import { describeHistory } from "./history-details";
import { showConfirm } from "./confirm";
const sections = [
  ["rules", "Bulk pricing rules", "قواعد التسعير الجماعي", "PRODUCT_EDIT"],
  [
    "quotation-settings",
    "Quotation Settings",
    "إعدادات عروض الأسعار",
    "SETTINGS_MANAGE",
  ],
  ["dashboard", "Dashboard", "لوحة التحكم", "ADMIN_VIEW"],
  ["products", "Products", "الأصناف", "PRODUCT_EDIT"],
  ["imports", "Imports / PDF", "الاستيراد / PDF", "IMPORT_CONFIRM"],
  ["discount-requests", "Discount Requests", "طلبات الخصم", "OVERRIDE_MINIMUM_PRICE"],
  ["brands", "Brands", "العلامات", "PRODUCT_EDIT"],
  ["categories", "Categories", "الفئات", "PRODUCT_EDIT"],
  ["users", "Users", "المستخدمون", "USER_MANAGE"],
  ["roles", "Roles", "الأدوار", "USER_MANAGE"],
  ["history", "Price history", "سجل الأسعار", "PRICE_HISTORY_VIEW"],
  ["audit", "Audit log", "سجل التدقيق", "AUDIT_VIEW"],
  ["backups", "Backups", "النسخ الاحتياطية", "BACKUP_MANAGE"],
  ["settings", "Settings", "الإعدادات", "SETTINGS_MANAGE"],
];
const importActionErrors = new Set([
  "Import could not be uploaded",
  "Import mapping could not be saved",
  "Review decisions could not be saved",
  "Auto-import failed",
  "Import could not be confirmed",
  "Import rollback failed",
]);
function formatImportActionError(rawMessage: string, t: Translate) {
  if (/Please correct the highlighted values/i.test(rawMessage))
    return t(
      "Please correct the highlighted import values. Check the mapped columns, defaults, and selected import before trying again.",
      "يرجى تصحيح قيم الاستيراد المظللة. تحقق من ربط الأعمدة والقيم الافتراضية والاستيراد المحدد ثم حاول مرة أخرى.",
    );
  if (/Map at least one column/i.test(rawMessage) || /Map the part number column/i.test(rawMessage))
    return rawMessage;
  if (/Import changed or is not awaiting review/i.test(rawMessage) || /Import changed\. Reload/i.test(rawMessage))
    return t(
      "This import changed while you were reviewing it. Refresh the import, review the latest rows, then try again.",
      "تم تغيير هذا الاستيراد أثناء مراجعته. حدّث الاستيراد وراجع أحدث الصفوف ثم حاول مرة أخرى.",
    );
  if (/Row \d+ must be verified/i.test(rawMessage))
    return t(
      "Some rows still need verification before they can be imported. Review the highlighted rows and save the decisions first.",
      "لا تزال بعض الصفوف تحتاج إلى تحقق قبل استيرادها. راجع الصفوف المظللة واحفظ القرارات أولاً.",
    );
  if (/Row \d+ contains errors/i.test(rawMessage))
    return t(
      "Some rows still contain import errors. Fix or skip those rows, save the review, then try importing again.",
      "لا تزال بعض الصفوف تحتوي على أخطاء استيراد. صحح هذه الصفوف أو تخطاها ثم احفظ المراجعة وحاول الاستيراد مرة أخرى.",
    );
  return rawMessage;
}
export default function Admin({ t, user }: { t: Translate; user: any }) {
  const [section, setSection] = useState("dashboard"),
    [result, setResult] = useState<AdminResult>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [productQuery, setProductQuery] = useState(""),
    [productPage, setProductPage] = useState(0),
    [edit, setEdit] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [actionState, setActionState] = useState<AdminActionState>({
      phase: "idle",
    }),
    [selected, setSelected] = useState<Record<string, number>>({}),
    [bulk, setBulk] = useState<any>({ operation: "MARKUP", value: "25" }),
    [searchFocused, setSearchFocused] = useState(false),
    [activeSuggestion, setActiveSuggestion] = useState(-1),
    [loadedProductQuery, setLoadedProductQuery] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [roles, setRoles] = useState<any>(null),
    [exportJob, setExportJob] = useState<any>(null);
  const data = sectionData(result, section);
  const productData =
    section === "products" && data && !Array.isArray(data) ? data : null;
  const productItems = productData?.items ?? [];
  const requestGeneration = useRef(0),
    currentSection = useRef(section),
    productSearchInput = useRef<HTMLInputElement | null>(null),
    successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  currentSection.current = section;
  useEffect(
    () => () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!exportJob || ["DONE", "FAILED"].includes(exportJob.status)) return;
    const timer = setInterval(
      () =>
        api("exports/" + exportJob.id)
          .then(setExportJob)
          .catch((e) => setError(e.message)),
      1500,
    );
    return () => clearInterval(timer);
  }, [exportJob]);
  async function load(overrides?: { page?: number; query?: string }) {
    if (currentSection.current !== section) return;
    const generation = ++requestGeneration.current;
    setError("");
    if (["imports", "rules", "quotation-settings", "discount-requests"].includes(section)) return;
    try {
      const payload = await api(
        section === "products"
          ? "products?q=" +
              encodeURIComponent(overrides?.query ?? productQuery) +
              "&page=" +
              String(overrides?.page ?? productPage) +
              "&pageSize=50"
          : "admin/" + section,
      );
      if (
        generation !== requestGeneration.current ||
        currentSection.current !== section
      )
        return;
      if (section === "products" && payload && !Array.isArray(payload)) {
        setProductPage(payload.page ?? 0);
        setLoadedProductQuery(overrides?.query ?? productQuery);
      }
      setResult({ section, payload: validateAdminData(section, payload) });
    } catch (e) {
      if (
        generation === requestGeneration.current &&
        currentSection.current === section
      ) {
        setResult(null);
        setError((e as Error).message);
      }
    }
  }
  useEffect(() => {
    setResult(null);
    setEdit(null);
    setSelected({});
    setPreview(null);
    setProductPage(0);
    setLoadedProductQuery("");
    setSearchFocused(false);
    setActiveSuggestion(-1);
    load();
    return () => {
      requestGeneration.current++;
    };
  }, [section]);
  useEffect(() => {
    if (section !== "products" || query === productQuery) return;
    const timer = setTimeout(() => {
      setProductQuery(query);
      setProductPage(0);
      void load({ query, page: 0 });
    }, 220);
    return () => clearTimeout(timer);
  }, [section, query, productQuery]);
  useEffect(() => {
    if (user.permissions.includes("USER_MANAGE"))
      api("admin/roles")
        .then((value) => setRoles(validateAdminData("roles", value)))
        .catch(() => {});
  }, [user]);
  const dismissAction = () => {
    if (actionState.phase === "saving") return;
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = null;
    setActionState({ phase: "idle" });
  };
  const bulkOptions = [
    ["ARCHIVE", t("Archive selected", "أرشفة المحدد")],
    ["REACTIVATE", t("Reactivate selected", "إعادة تفعيل المحدد")],
    ["DELETE", t("Delete selected permanently", "حذف المحدد نهائياً")],
    ["COST_INCREASE", "COST_INCREASE"],
    ["COST_DECREASE", "COST_DECREASE"],
    ["MARKUP", "MARKUP"],
    ["BASE_DISCOUNT", "BASE_DISCOUNT"],
    ["MINIMUM", "MINIMUM"],
    ["REMOVE_MINIMUM", "REMOVE_MINIMUM"],
    ["VAT", "VAT"],
    ["FIXED_PRICE", "FIXED_PRICE"],
  ] as const;
  const priceBulkOperations = new Set([
    "COST_INCREASE",
    "COST_DECREASE",
    "MARKUP",
    "BASE_DISCOUNT",
    "MINIMUM",
    "REMOVE_MINIMUM",
    "VAT",
    "FIXED_PRICE",
  ]);
  const runAction: AdminActionRunner = async (messages, action) => {
    if (busy) return undefined;
    if (successTimer.current) clearTimeout(successTimer.current);
    setBusy(true);
    setActionState({
      phase: "saving",
      title: messages.saving,
      message: messages.savingDetail,
    });
    try {
      const value = await action();
      setActionState({
        phase: "success",
        title: messages.success,
        message: messages.successDetail,
      });
      successTimer.current = setTimeout(
        () => setActionState({ phase: "idle" }),
        1600,
      );
      return value;
    } catch (e) {
      const rawMessage = (e as Error).message;
      setActionState({
        phase: "error",
        title: messages.error,
        message:
          messages.error === t("Products could not be deleted", "تعذر حذف الأصناف")
            ? formatBulkDeleteError(rawMessage, t)
            : importActionErrors.has(messages.error)
              ? formatImportActionError(rawMessage, t)
            : rawMessage,
      });
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  async function mutate<T>(
    messages: AdminActionMessages,
    fn: () => Promise<T>,
    options: { reload?: boolean } = {},
  ) {
    return runAction(messages, async () => {
      const value = await fn();
      if (options.reload !== false) await load();
      return value;
    });
  }
  async function runBulkRequests<T>(
    items: { id: string; version: unknown }[],
    messages: {
      title: string;
      detail: string;
      progress: (current: number, total: number) => string;
    },
    requestForChunk: (
      chunk: { id: string; version: unknown }[],
      index: number,
      total: number,
    ) => Promise<T>,
  ) {
    const chunks = chunkBulkItems(items);
    const results: T[] = [];
    for (let index = 0; index < chunks.length; index++) {
      setActionState({
        phase: "saving",
        title: messages.title,
        message:
          chunks.length > 1
            ? `${messages.detail} ${messages.progress(index + 1, chunks.length)}`
            : messages.detail,
      });
      results.push(await requestForChunk(chunks[index], index, chunks.length));
    }
    return results;
  }
  const heading = sections.find((s) => s[0] === section)!;
  const visibleProductIds =
    section === "products"
      ? productItems.map((p: any) => p.id)
      : [];
  const suggestions =
    section === "products" && loadedProductQuery.trim() === query.trim()
      ? getProductSuggestions(productItems, query)
      : [];
  const showSuggestions =
    searchFocused &&
    !!query.trim() &&
    suggestions.length > 0 &&
    loadedProductQuery.trim() === query.trim();
  useEffect(() => {
    if (section !== "products") return;
    if (!showSuggestions) {
      setActiveSuggestion(-1);
      return;
    }
    setActiveSuggestion((current) =>
      activeSuggestionIndex(current, suggestions.length),
    );
  }, [section, showSuggestions, suggestions.length]);
  const matchedProductItems = productData?.selectableItems ?? [];
  const allVisibleSelected =
    !!visibleProductIds.length &&
    visibleProductIds.every((id: string) => id in selected);
  const someVisibleSelected =
    visibleProductIds.some((id: string) => id in selected) &&
    !allVisibleSelected;
  const allMatchedSelected =
    !!matchedProductItems.length &&
    matchedProductItems.every((item: any) => item.id in selected);
  const selectedCount = Object.keys(selected).length;
  const bulkItems = buildBulkItems(selected);
  const editField = (key: string, label: string, type = "text") => (
    <label key={key}>
      {label}
      <input
        type={type}
        minLength={type === "password" ? 4 : undefined}
        value={edit?.[key] ?? ""}
        onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
      />
    </label>
  );
  const triggerProductSearch = (nextQuery: string) => {
    setSelected({});
    setPreview(null);
    setProductQuery(nextQuery);
    setProductPage(0);
    setActiveSuggestion(-1);
    void load({ query: nextQuery, page: 0 });
  };
  const chooseSuggestion = (item: any) => {
    setQuery(item.partNumber);
    setSearchFocused(false);
    triggerProductSearch(item.partNumber);
    productSearchInput.current?.focus();
  };
  return (
    <div className="admin-layout">
      <aside className="admin-menu">
        <div className="eyebrow">{t("ADMINISTRATION", "الإدارة")}</div>
        {sections
          .filter((s) => user.permissions.includes(s[3]))
          .map(([key, en, ar]) => (
            <button
              disabled={busy}
              className={section === key ? "active" : ""}
              key={key}
              onClick={() => {
                if (key === section) return;
                requestGeneration.current++;
                currentSection.current = key;
                setEdit(null);
                setSection(key);
              }}
            >
              {t(en, ar)}
            </button>
          ))}
      </aside>
      <section className="card admin-content">
        <div className="section-title">
          <h2>{t(heading[1], heading[2])}</h2>
          {!["imports", "rules", "quotation-settings", "discount-requests"].includes(section) && (
            <button disabled={busy} onClick={() => void load()}>
              {t("Refresh", "تحديث")}
            </button>
          )}
        </div>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {section === "imports" ? (
          <Imports t={t} actionBusy={busy} onAction={runAction} />
        ) : section === "rules" ? (
          <BulkRules t={t} actionBusy={busy} onAction={runAction} />
        ) : section === "quotation-settings" ? (
          <QuotationSettings t={t} actionBusy={busy} onAction={runAction} />
        ) : section === "discount-requests" ? (
          <DiscountRequestsAdmin t={t} actionBusy={busy} onAction={runAction} />
        ) : !data ? (
          <p>
            {error
              ? t(
                  "This section could not be loaded. Use Refresh to retry.",
                  "تعذر تحميل هذا القسم. استخدم تحديث للمحاولة مجدداً.",
                )
              : t("Loading…", "جارٍ التحميل…")}
          </p>
        ) : (
          <>
            {section === "dashboard" && (
              <div className="stat-grid">
                {[
                  ["Total products", "إجمالي الأصناف", data.products.total],
                  ["Active products", "أصناف نشطة", data.products.active],
                  ["Cost + markup", "التكلفة + الزيادة", data.products.markup],
                  [
                    "List − discount",
                    "القائمة − الخصم",
                    data.products.discount,
                  ],
                  [
                    "Minimum protected",
                    "محمية بالحد الأدنى",
                    data.products.protected,
                  ],
                  ["Updated today", "محدثة اليوم", data.products.updated],
                  ["Draft quotations", "مسودات", data.quotes.drafts],
                  ["Issued today", "صادرة اليوم", data.quotes.today],
                  ["Pending imports", "استيراد معلق", data.imports.pending],
                  ["Import errors", "أخطاء الاستيراد", data.imports.errors],
                  ["Duplicate rows", "صفوف مكررة", data.duplicates],
                ].map(([en, ar, n]) => (
                  <div className="stat" key={en}>
                    <span>{t(en, ar)}</span>
                    <strong>{n}</strong>
                  </div>
                ))}
              </div>
            )}
            {section === "products" && (
              <>
                <div className="actions wrap">
                  <div className="admin-product-search grow">
                    <input
                      ref={productSearchInput}
                      className="grow"
                      placeholder={t(
                        "Find a product or part number…",
                        "ابحث عن صنف أو رقم جزء…",
                      )}
                      value={query}
                      onFocus={() => setSearchFocused(true)}
                      onBlur={() => {
                        setTimeout(() => setSearchFocused(false), 120);
                      }}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setSelected({});
                        setPreview(null);
                        setActiveSuggestion(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown" && suggestions.length) {
                          e.preventDefault();
                          setSearchFocused(true);
                          setActiveSuggestion((current) =>
                            Math.min(
                              activeSuggestionIndex(current, suggestions.length) + 1,
                              suggestions.length - 1,
                            ),
                          );
                          return;
                        }
                        if (e.key === "ArrowUp" && suggestions.length) {
                          e.preventDefault();
                          setActiveSuggestion((current) =>
                            Math.max(
                              activeSuggestionIndex(current, suggestions.length) - 1,
                              0,
                            ),
                          );
                          return;
                        }
                        if (e.key === "Escape") {
                          setSearchFocused(false);
                          setActiveSuggestion(-1);
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (
                            showSuggestions &&
                            suggestions[
                              activeSuggestionIndex(
                                activeSuggestion,
                                suggestions.length,
                              )
                            ]
                          ) {
                            chooseSuggestion(
                              suggestions[
                                activeSuggestionIndex(
                                  activeSuggestion,
                                  suggestions.length,
                                )
                              ],
                            );
                            return;
                          }
                          triggerProductSearch(query);
                        }
                      }}
                    />
                    {showSuggestions && (
                      <div className="admin-product-suggestions" role="listbox">
                        {suggestions.map((item: any, index: number) => (
                          <button
                            key={item.id}
                            type="button"
                            className={
                              "admin-product-suggestion" +
                              (index === activeSuggestion ? " active" : "")
                            }
                            role="option"
                            aria-selected={index === activeSuggestion}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              chooseSuggestion(item);
                            }}
                          >
                            <strong>{item.partNumber}</strong>
                            <small>
                              {[item.description, item.brand]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => triggerProductSearch(query)}
                  >
                    {t("Search", "بحث")}
                  </button>
                  <button
                    className="primary"
                    onClick={() =>
                      (async () => {
                        if (busy) return;
                        const s = await api("auth/me");
                        setEdit({ ...blankProduct, vat: s.settings.vat });
                      })()
                    }
                  >
                    {t("＋ Add product", "＋ إضافة صنف")}
                  </button>
                  {user.permissions.includes("EXPORT") && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          {
                            saving: t(
                              "Queueing export…",
                              "جارٍ تجهيز التصدير…",
                            ),
                            success: t(
                              "Export queued",
                              "تمت إضافة التصدير",
                            ),
                            successDetail: t(
                              "The workbook is being prepared now.",
                              "يجري تجهيز ملف التصدير الآن.",
                            ),
                            error: t(
                              "Export could not be started",
                              "تعذر بدء التصدير",
                            ),
                          },
                          async () => setExportJob(await api("exports", "POST", {})),
                          { reload: false },
                        )
                      }
                    >
                      {t("Export XLSX", "تصدير XLSX")}
                    </button>
                  )}
                  {exportJob &&
                    (exportJob.status === "DONE" ? (
                      <a
                        className="button primary"
                        href={appPath(
                          "/api/v1/exports/" + exportJob.id + "/download",
                        )}
                      >
                        {t("Download workbook", "تنزيل الملف")}
                      </a>
                    ) : (
                      <span className="muted">
                        {exportJob.status === "FAILED"
                          ? exportJob.error
                          : t("Preparing export…", "جارٍ تجهيز التصدير…")}
                      </span>
                    ))}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            aria-label={t(
                              "Select all visible products",
                              "تحديد كل الأصناف الظاهرة",
                            )}
                            checked={allVisibleSelected}
                            ref={(node) => {
                              if (node) node.indeterminate = someVisibleSelected;
                            }}
                            onChange={(e) => {
                              setSelected(
                                e.target.checked
                                  ? Object.fromEntries([
                                      ...Object.entries(selected),
                                      ...productItems.map((item: any) => [
                                        item.id,
                                        item.version,
                                      ]),
                                    ])
                                  : Object.fromEntries(
                                      Object.entries(selected).filter(
                                        ([id]) => !visibleProductIds.includes(id),
                                      ),
                                    ),
                              );
                              setPreview(null);
                            }}
                          />
                        </th>
                        <th>{t("Part / description", "الصنف / الوصف")}</th>
                        <th>{t("Method", "الطريقة")}</th>
                        <th>{t("Brand", "العلامة")}</th>
                        <th>{t("Status", "الحالة")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {productItems.map((p: any) => (
                        <tr key={p.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={"Select " + p.partNumber}
                              checked={p.id in selected}
                              onChange={(e) => {
                                setSelected(
                                  e.target.checked
                                    ? { ...selected, [p.id]: p.version }
                                    : Object.fromEntries(
                                        Object.entries(selected).filter(
                                          ([id]) => id !== p.id,
                                        ),
                                      ),
                                );
                                setPreview(null);
                              }}
                            />
                          </td>
                          <td>
                            <strong>{p.partNumber}</strong>
                            <small>{p.description}</small>
                          </td>
                          <td>{p.method}</td>
                          <td>{p.brand}</td>
                          <td>
                            {p.active
                              ? t("Active", "نشط")
                              : t("Archived", "مؤرشف")}
                          </td>
                          <td>
                            <button onClick={() => setEdit(p)}>
                              {t("Edit", "تعديل")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="actions wrap">
                  <button
                    disabled={busy || (productData?.page ?? 0) === 0}
                    onClick={() => {
                      const nextPage = Math.max((productData?.page ?? 0) - 1, 0);
                      setProductPage(nextPage);
                      load({ page: nextPage });
                    }}
                  >
                    {t("Previous page", "الصفحة السابقة")}
                  </button>
                  <span className="muted">
                    {t("Page", "الصفحة")} {(productData?.page ?? 0) + 1} /{" "}
                    {productData?.totalPages ?? 1} · {t("Results", "النتائج")}:{" "}
                    {productData?.totalRows ?? 0}
                  </span>
                  <button
                    disabled={busy || !productData?.hasMore}
                    onClick={() => {
                      const nextPage = (productData?.page ?? 0) + 1;
                      setProductPage(nextPage);
                      load({ page: nextPage });
                    }}
                  >
                    {t("Next page", "الصفحة التالية")}
                  </button>
                </div>
                {!productItems.length && (
                  <p className="empty-state">
                    {t(
                      "No products yet. Add one or import a supplier price list.",
                      "لا توجد أصناف. أضف صنفاً أو استورد قائمة أسعار.",
                    )}
                  </p>
                )}
                {!!selectedCount && (
                  <div className="review-panel">
                    <h3>
                      {t("Bulk actions", "إجراءات جماعية")} ({selectedCount})
                    </h3>
                    <div className="actions wrap">
                      <button
                        disabled={busy || !visibleProductIds.length}
                        onClick={() => {
                          setSelected({
                            ...selected,
                            ...Object.fromEntries(
                              productItems.map((item: any) => [item.id, item.version]),
                            ),
                          });
                          setPreview(null);
                        }}
                      >
                        {t("Select visible", "تحديد الظاهر")}
                      </button>
                      <button
                        disabled={busy || !matchedProductItems.length || allMatchedSelected}
                        onClick={() => {
                          setSelected({
                            ...selected,
                            ...Object.fromEntries(
                              matchedProductItems.map((item: any) => [
                                item.id,
                                item.version,
                              ]),
                            ),
                          });
                          setPreview(null);
                        }}
                      >
                        {t("Select all matched", "تحديد كل النتائج")}
                      </button>
                      <button
                        disabled={busy || !selectedCount}
                        onClick={() => {
                          setSelected({});
                          setPreview(null);
                        }}
                      >
                        {t("Clear selection", "مسح التحديد")}
                      </button>
                      <span className="muted">
                        {t("Selected", "المحدد")}: {selectedCount}
                        {productData?.selectionLimitReached
                          ? t(" (first 5000 matches)", " (أول 5000 نتيجة)")
                          : ""}
                      </span>
                      <select
                        value={bulk.operation}
                        onChange={(e) => {
                          setBulk({ ...bulk, operation: e.target.value });
                          setPreview(null);
                        }}
                      >
                        {bulkOptions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      {["MARKUP", "BASE_DISCOUNT", "FIXED_PRICE"].includes(
                        bulk.operation,
                      ) && (
                        <select
                          aria-label={t("Selling level", "مستوى سعر البيع")}
                          value={bulk.sellingLevel ?? "DEFAULT"}
                          onChange={(e) => {
                            setBulk({ ...bulk, sellingLevel: e.target.value });
                            setPreview(null);
                          }}
                        >
                          <option value="DEFAULT">
                            {t("Product default", "افتراضي الصنف")}
                          </option>
                          <option value="ALL">
                            {t("All active levels", "كل المستويات النشطة")}
                          </option>
                          {levelCodes.map((code) => (
                            <option value={code} key={code}>
                              {levelLabel(code, t)}
                            </option>
                          ))}
                        </select>
                      )}
                      {bulk.operation !== "REMOVE_MINIMUM" &&
                        priceBulkOperations.has(bulk.operation) && (
                          <input
                            className="compact"
                            value={bulk.value}
                            onChange={(e) => {
                              setBulk({ ...bulk, value: e.target.value });
                              setPreview(null);
                            }}
                          />
                        )}
                      {priceBulkOperations.has(bulk.operation) ? (
                        <button
                          disabled={busy || !selectedCount}
                          onClick={async () => {
                            if (busy) return;
                            setBusy(true);
                            try {
                              const responses = await runBulkRequests(
                                bulkItems,
                                {
                                  title: t(
                                    "Preparing bulk preview…",
                                    "جارٍ تجهيز المعاينة الجماعية…",
                                  ),
                                  detail: t(
                                    "AMT is building the preview in smaller batches.",
                                    "يقوم AMT بإعداد المعاينة على دفعات أصغر.",
                                  ),
                                  progress: (current, total) =>
                                    t(
                                      `Batch ${current} of ${total}`,
                                      `الدفعة ${current} من ${total}`,
                                    ),
                                },
                                (chunk) =>
                                  api("products/bulk", "POST", {
                                    ...bulk,
                                    items: chunk,
                                    confirm: false,
                                  }),
                              );
                              setPreview({
                                preview: responses.flatMap(
                                  (response: any) => response.preview,
                                ),
                                applied: false,
                                deleted: [],
                              });
                              setActionState({ phase: "idle" });
                            } catch (e) {
                              setActionState({
                                phase: "error",
                                title: t(
                                  "Bulk preview could not be prepared",
                                  "تعذر تجهيز المعاينة الجماعية",
                                ),
                                message: (e as Error).message,
                              });
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          {t("Preview", "معاينة")}
                        </button>
                      ) : (
                        <button
                          className={
                            bulk.operation === "DELETE" ? "primary danger-action" : ""
                          }
                          disabled={busy || !selectedCount}
                          onClick={async () => {
                            if (
                              !(await showConfirm(
                                bulk.operation === "DELETE"
                                  ? t(
                                      `Permanently delete ${selectedCount} selected products?`,
                                      `حذف ${selectedCount} من الأصناف المحددة نهائياً؟`,
                                    )
                                  : bulk.operation === "ARCHIVE"
                                    ? t(
                                        `Archive ${selectedCount} selected products?`,
                                        `أرشفة ${selectedCount} من الأصناف المحددة؟`,
                                      )
                                    : t(
                                        `Reactivate ${selectedCount} selected products?`,
                                        `إعادة تفعيل ${selectedCount} من الأصناف المحددة؟`,
                                      ),
                              ))
                            )
                              return;
                            if (
                              bulk.operation === "DELETE" &&
                              !(await showConfirm(
                                t(
                                  "This permanently deletes the selected products and cannot be undone.",
                                  "هذا يحذف الأصناف المحددة نهائياً ولا يمكن التراجع عنه.",
                                ),
                              ))
                            )
                              return;
                            await mutate(
                              {
                                saving:
                                  bulk.operation === "DELETE"
                                    ? t(
                                        "Deleting products…",
                                        "جارٍ حذف الأصناف…",
                                      )
                                    : bulk.operation === "ARCHIVE"
                                      ? t(
                                          "Archiving products…",
                                          "جارٍ أرشفة الأصناف…",
                                        )
                                      : t(
                                          "Reactivating products…",
                                          "جارٍ إعادة تفعيل الأصناف…",
                                        ),
                                success:
                                  bulk.operation === "DELETE"
                                    ? t("Products deleted", "تم حذف الأصناف")
                                    : bulk.operation === "ARCHIVE"
                                      ? t(
                                          "Products archived",
                                          "تمت أرشفة الأصناف",
                                        )
                                      : t(
                                          "Products reactivated",
                                          "تمت إعادة تفعيل الأصناف",
                                        ),
                                successDetail:
                                  bulk.operation === "DELETE"
                                    ? t(
                                        "The selected products were permanently removed.",
                                        "تمت إزالة الأصناف المحددة نهائياً.",
                                      )
                                    : bulk.operation === "ARCHIVE"
                                      ? t(
                                          "The selected products were archived.",
                                          "تمت أرشفة الأصناف المحددة.",
                                        )
                                      : t(
                                          "The selected products are active again.",
                                          "أصبحت الأصناف المحددة نشطة مرة أخرى.",
                                        ),
                                error:
                                  bulk.operation === "DELETE"
                                    ? t(
                                        "Products could not be deleted",
                                        "تعذر حذف الأصناف",
                                      )
                                    : bulk.operation === "ARCHIVE"
                                      ? t(
                                          "Products could not be archived",
                                          "تعذر أرشفة الأصناف",
                                        )
                                      : t(
                                          "Products could not be reactivated",
                                          "تعذر إعادة تفعيل الأصناف",
                                        ),
                              },
                              async () => {
                                await runBulkRequests(
                                  bulkItems,
                                  {
                                    title:
                                      bulk.operation === "DELETE"
                                        ? t(
                                            "Deleting products…",
                                            "جارٍ حذف الأصناف…",
                                          )
                                        : bulk.operation === "ARCHIVE"
                                          ? t(
                                              "Archiving products…",
                                              "جارٍ أرشفة الأصناف…",
                                            )
                                          : t(
                                              "Reactivating products…",
                                              "جارٍ إعادة تفعيل الأصناف…",
                                            ),
                                    detail: t(
                                      "Large changes are processed in smaller batches so the app stays responsive.",
                                      "تتم معالجة التغييرات الكبيرة على دفعات أصغر حتى يظل التطبيق مستجيباً.",
                                    ),
                                    progress: (current, total) =>
                                      t(
                                        `Batch ${current} of ${total}`,
                                        `الدفعة ${current} من ${total}`,
                                      ),
                                  },
                                  (chunk) =>
                                    api("products/bulk", "POST", {
                                      operation: bulk.operation,
                                      items: chunk,
                                      confirm: true,
                                    }),
                                );
                                setSelected({});
                                setPreview(null);
                              },
                            );
                          }}
                        >
                          {bulk.operation === "DELETE"
                            ? t("Delete selected", "حذف المحدد")
                            : bulk.operation === "ARCHIVE"
                              ? t("Archive selected", "أرشفة المحدد")
                              : t(
                                  "Reactivate selected",
                                  "إعادة تفعيل المحدد",
                                )}
                        </button>
                      )}
                    </div>
                    {preview && (
                      <>
                        <div className="table-scroll">
                          <table>
                            <tbody>
                              {preview.preview.map((r: any) => (
                                <tr key={r.id}>
                                  <td>{r.partNumber}</td>
                                  <td>
                                    {r.levels.map((l: any) => (
                                      <div key={l.code}>
                                        {levelLabel(l.code, t)}: {l.before} →{" "}
                                        {l.after}
                                      </div>
                                    ))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            mutate(
                              {
                                saving: t(
                                  "Saving bulk update…",
                                  "جارٍ حفظ التحديث الجماعي…",
                                ),
                                success: t(
                                  "Bulk update saved",
                                  "تم حفظ التحديث الجماعي",
                                ),
                                successDetail: t(
                                  "The selected products were updated.",
                                  "تم تحديث الأصناف المحددة.",
                                ),
                                error: t(
                                  "Bulk update could not be saved",
                                  "تعذر حفظ التحديث الجماعي",
                                ),
                              },
                              async () => {
                                await runBulkRequests(
                                  bulkItems,
                                  {
                                    title: t(
                                      "Saving bulk update…",
                                      "جارٍ حفظ التحديث الجماعي…",
                                    ),
                                    detail: t(
                                      "Large updates are processed in smaller batches so the app keeps moving.",
                                      "تتم معالجة التحديثات الكبيرة على دفعات أصغر حتى يظل التطبيق متحركاً.",
                                    ),
                                    progress: (current, total) =>
                                      t(
                                        `Batch ${current} of ${total}`,
                                        `الدفعة ${current} من ${total}`,
                                      ),
                                  },
                                  (chunk) =>
                                    api("products/bulk", "POST", {
                                      ...bulk,
                                      items: chunk,
                                      confirm: true,
                                    }),
                                );
                                setSelected({});
                                setPreview(null);
                              },
                            )
                          }
                        >
                          {t("Confirm bulk update", "تأكيد التحديث الجماعي")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {["brands", "categories"].includes(section) && (
              <>
                <button
                  className="primary"
                  onClick={() =>
                    setEdit({
                      name: "",
                      active: true,
                      defaultMethod: "COST_MARKUP",
                    })
                  }
                >
                  {t("Add", "إضافة")}
                </button>
                <table>
                  <tbody>
                    {data.map((row: any) => (
                      <tr key={row.id}>
                        <td>{row.name}</td>
                        <td>
                          {row.active
                            ? t("Active", "نشط")
                            : t("Archived", "مؤرشف")}
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              setEdit({
                                id: row.id,
                                name: row.name,
                                active: row.active,
                                defaultMethod:
                                  row.default_method || "COST_MARKUP",
                              })
                            }
                          >
                            {t("Edit", "تعديل")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {section === "users" && (
              <>
                <button
                  className="primary"
                  onClick={() =>
                    setEdit({
                      username: "",
                      name: "",
                      role: "STAFF",
                      permissions: [],
                      maxDiscount: null,
                      disabled: false,
                      password: "",
                    })
                  }
                >
                  {t("Add user", "إضافة مستخدم")}
                </button>
                <table>
                  <thead>
                    <tr>
                      <th>{t("Name", "الاسم")}</th>
                      <th>{t("Role", "الدور")}</th>
                      <th>{t("Status", "الحالة")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((u: any) => (
                      <tr key={u.id}>
                        <td>
                          {u.name}
                          <small>{u.username}</small>
                        </td>
                        <td>{u.role_id}</td>
                        <td>
                          {u.disabled
                            ? t("Disabled", "معطل")
                            : t("Active", "نشط")}
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              setEdit({
                                id: u.id,
                                username: u.username,
                                name: u.name,
                                role: u.role_id,
                                permissions: u.permissions,
                                maxDiscount: u.max_discount,
                                disabled: u.disabled,
                              })
                            }
                          >
                            {t(
                              "Edit / reset password",
                              "تعديل / إعادة تعيين كلمة المرور",
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {section === "roles" && (
              <>
                <button
                  onClick={() =>
                    setEdit({ id: "", permissions: [], maxDiscount: "5" })
                  }
                >
                  {t("Add role", "إضافة دور")}
                </button>
                {data.roles.map((r: any) => (
                  <div className="quote-line" key={r.id}>
                    <span>
                      <strong>{r.id}</strong>
                      <small>{r.permissions.join(", ")}</small>
                    </span>
                    <span>{r.max_discount}%</span>
                    <button
                      disabled={r.id === "ADMIN"}
                      onClick={() =>
                        setEdit({
                          id: r.id,
                          permissions: r.permissions,
                          maxDiscount: r.max_discount,
                        })
                      }
                    >
                      {t("Edit", "تعديل")}
                    </button>
                  </div>
                ))}
              </>
            )}
            {["history", "audit"].includes(section) && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Date", "التاريخ")}</th>
                      <th>{t("Action / product", "الإجراء / الصنف")}</th>
                      <th>{t("User", "المستخدم")}</th>
                      <th>{t("Details", "التفاصيل")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((r: any) => (
                      <tr key={r.id}>
                        <td>{new Date(r.created_at).toLocaleString()}</td>
                        <td>
                          <strong>{describeHistory(r, t).title}</strong>
                          <div>{describeHistory(r, t).subject}</div>
                          <small>{describeHistory(r, t).source}</small>
                        </td>
                        <td>{r.actor || t("System", "النظام")}</td>
                        <td>
                          <HistoryDetails row={r} t={t} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {section === "backups" && (
              <>
                <p className="notice">
                  {t(
                    "Backups run in a dedicated service and persist outside the application container. Restore using the documented isolated restore procedure.",
                    "تعمل النسخ الاحتياطية في خدمة مستقلة وتحفظ خارج حاوية التطبيق. استخدم دليل الاستعادة المعزولة.",
                  )}
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    mutate(
                      {
                        saving: t(
                          "Starting backup…",
                          "جارٍ بدء النسخ الاحتياطي…",
                        ),
                        success: t(
                          "Backup started",
                          "بدأ النسخ الاحتياطي",
                        ),
                        successDetail: t(
                          "The backup job was queued successfully.",
                          "تمت إضافة مهمة النسخ الاحتياطي بنجاح.",
                        ),
                        error: t(
                          "Backup could not be started",
                          "تعذر بدء النسخ الاحتياطي",
                        ),
                      },
                      () => api("admin/backups", "POST", {}),
                    )
                  }
                >
                  {t("Back up now", "نسخ احتياطي الآن")}
                </button>
                <table>
                  <tbody>
                    {data.map((b: any) => (
                      <tr key={b.id}>
                        <td>{new Date(b.created_at).toLocaleString()}</td>
                        <td>{b.status}</td>
                        <td>
                          {b.filename || "—"}
                          <small>{b.error}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {section === "settings" && (
              <Settings
                t={t}
                initial={data}
                busy={busy}
                onSave={(p) =>
                  mutate(
                    {
                      saving: t(
                        "Saving settings…",
                        "جارٍ حفظ الإعدادات…",
                      ),
                      success: t(
                        "Settings saved",
                        "تم حفظ الإعدادات",
                      ),
                      successDetail: t(
                        "The latest settings were saved and reloaded.",
                        "تم حفظ الإعدادات الأخيرة وإعادة تحميلها.",
                      ),
                      error: t(
                        "Settings could not be saved",
                        "تعذر حفظ الإعدادات",
                      ),
                    },
                    () => api("admin/settings", "PUT", p),
                  )
                }
              />
            )}
          </>
        )}
        {edit && section === "products" && (
          <ProductEditor
            t={t}
            initial={edit}
            actionBusy={busy}
            onClose={() => setEdit(null)}
            onSave={async (p) => {
              const ok = await mutate(
                {
                  saving: t(
                    "Saving product…",
                    "جارٍ حفظ الصنف…",
                  ),
                  success: t(
                    "Product saved",
                    "تم حفظ الصنف",
                  ),
                  successDetail: t(
                    "The product and price history were updated.",
                    "تم تحديث الصنف وسجل الأسعار.",
                  ),
                  error: t(
                    "Product could not be saved",
                    "تعذر حفظ الصنف",
                  ),
                },
                async () => {
                  await api(
                    "products" + (edit.id ? "/" + edit.id : ""),
                    edit.id ? "PUT" : "POST",
                    p,
                  );
                  setEdit(null);
                },
              );
              return ok;
            }}
          />
        )}
        {edit && section !== "products" && (
          <div className="modal-backdrop">
            <form
              className="modal"
              onSubmit={(e) => {
                e.preventDefault();
                mutate(
                  {
                    saving: t(
                      "Saving changes…",
                      "جارٍ حفظ التغييرات…",
                    ),
                    success: t(
                      "Changes saved",
                      "تم حفظ التغييرات",
                    ),
                    successDetail: t(
                      "The administration record was updated.",
                      "تم تحديث سجل الإدارة.",
                    ),
                    error: t(
                      "Changes could not be saved",
                      "تعذر حفظ التغييرات",
                    ),
                  },
                  async () => {
                    const { id, ...rest } = edit;
                    const payload =
                      section === "roles"
                        ? edit
                        : {
                            ...rest,
                            ...(rest.password === ""
                              ? { password: undefined }
                              : {}),
                          };
                    await api(
                      "admin/" +
                        section +
                        (section !== "roles" && id ? "/" + id : ""),
                      "POST",
                      payload,
                    );
                    setEdit(null);
                  },
                );
              }}
            >
              <div className="section-title">
                <h2>{t("Edit record", "تعديل السجل")}</h2>
                <button type="button" disabled={busy} onClick={() => setEdit(null)}>
                  ×
                </button>
              </div>
              <div className="form-grid">
                {section === "roles"
                  ? editField("id", t("Role ID", "معرف الدور"))
                  : editField("name", t("Name", "الاسم"))}
                {section === "users" && (
                  <>
                    {editField("username", t("Username", "اسم المستخدم"))}
                    {editField(
                      "password",
                      t(
                        "New password (4+ characters)",
                        "كلمة مرور جديدة (٤ أحرف أو أكثر)",
                      ),
                      "password",
                    )}
                    <label>
                      {t("Role", "الدور")}
                      <select
                        value={edit.role}
                        onChange={(e) =>
                          setEdit({ ...edit, role: e.target.value })
                        }
                      >
                        {roles?.roles.map((r: any) => (
                          <option key={r.id}>{r.id}</option>
                        ))}
                      </select>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={edit.disabled}
                        onChange={(e) =>
                          setEdit({ ...edit, disabled: e.target.checked })
                        }
                      />
                      {t("Disabled", "معطل")}
                    </label>
                  </>
                )}
                {["users", "roles"].includes(section) && (
                  <>
                    <label>
                      {t(
                        "Maximum discount % (empty = role default)",
                        "الحد الأقصى للخصم % (فارغ = افتراضي الدور)",
                      )}
                      <input
                        value={edit.maxDiscount ?? ""}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            maxDiscount: e.target.value || null,
                          })
                        }
                      />
                    </label>
                    <fieldset>
                      <legend>
                        {t("Explicit permissions", "صلاحيات صريحة")}
                      </legend>
                      {(roles?.permissions || data?.permissions || []).map(
                        (p: string) => (
                          <label className="check" key={p}>
                            <input
                              type="checkbox"
                              checked={edit.permissions.includes(p)}
                              onChange={(e) =>
                                setEdit({
                                  ...edit,
                                  permissions: e.target.checked
                                    ? [...edit.permissions, p]
                                    : edit.permissions.filter(
                                        (v: string) => v !== p,
                                      ),
                                })
                              }
                            />
                            {p}
                          </label>
                        ),
                      )}
                    </fieldset>
                  </>
                )}
                {["brands", "categories"].includes(section) && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={edit.active}
                        onChange={(e) =>
                          setEdit({ ...edit, active: e.target.checked })
                        }
                      />
                      {t("Active", "نشط")}
                    </label>
                    {section === "brands" && (
                      <label>
                        {t("Default method", "الطريقة الافتراضية")}
                        <select
                          value={edit.defaultMethod}
                          onChange={(e) =>
                            setEdit({ ...edit, defaultMethod: e.target.value })
                          }
                        >
                          <option>COST_MARKUP</option>
                          <option>LIST_DISCOUNT</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
              </div>
              <button className="primary" disabled={busy}>
                {busy
                  ? t("Saving…", "جارٍ الحفظ…")
                  : t("Save changes", "حفظ التغييرات")}
              </button>
            </form>
          </div>
        )}
        <AdminActionModal state={actionState} dismiss={dismissAction} t={t} />
      </section>
    </div>
  );
}
function Settings({
  t,
  initial,
  busy,
  onSave,
}: {
  t: Translate;
  initial: any;
  busy: boolean;
  onSave: (p: any) => Promise<any>;
}) {
  const [p, setP] = useState(initial);
  useEffect(() => {
    setP(initial);
  }, [initial]);
  const labels: Record<string, [string, string]> = {
    companyName: ["Company name", "اسم الشركة"],
    companyArabic: ["Arabic company name", "اسم الشركة بالعربية"],
    currency: ["Currency", "العملة"],
    vat: ["Default VAT %", "الضريبة الافتراضية %"],
    quotePrefix: ["Quotation prefix", "بادئة عرض السعر"],
    draftPrefix: ["Draft prefix", "بادئة المسودة"],
    staffDiscount: ["Staff discount limit %", "حد خصم الموظف %"],
    minimumVisible: [
      "Show minimum prices to staff",
      "عرض الحد الأدنى للموظفين",
    ],
    showMaxDiscount: ["Show maximum discount", "عرض الحد الأقصى للخصم"],
    allowOfflineCache: [
      "Allow offline cached prices",
      "السماح بأسعار مخزنة دون اتصال",
    ],
    pdfUnitPrices: ["PDF unit prices", "أسعار الوحدة في PDF"],
    backupRetentionDays: ["Backup retention days", "أيام الاحتفاظ بالنسخ"],
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(p);
      }}
    >
      <div className="form-grid">
        {Object.entries(labels).map(([k, [en, ar]]) => (
          <label className={typeof p[k] === "boolean" ? "check" : ""} key={k}>
            {typeof p[k] === "boolean" ? (
              <>
                <input
                  type="checkbox"
                  checked={p[k]}
                  onChange={(e) => setP({ ...p, [k]: e.target.checked })}
                />
                {t(en, ar)}
              </>
            ) : (
              <>
                {t(en, ar)}
                {k === "pdfUnitPrices" ? (
                  <select
                    value={p[k]}
                    onChange={(e) => setP({ ...p, [k]: e.target.value })}
                  >
                    {["BOTH", "EXCL", "INCL"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    readOnly={k === "currency"}
                    value={p[k]}
                    onChange={(e) =>
                      setP({
                        ...p,
                        [k]:
                          k === "backupRetentionDays"
                            ? Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </>
            )}
          </label>
        ))}
      </div>
      <p className="notice">
        {t(
          "Default VAT applies to new entries; existing product VAT changes require a reviewed bulk update. Issued quotations remain unchanged.",
          "الضريبة الافتراضية للأصناف الجديدة. تحديث ضريبة الأصناف الحالية يتطلب مراجعة جماعية. العروض الصادرة لا تتغير.",
        )}
      </p>
      <button className="primary" disabled={busy}>
        {busy ? t("Saving…", "جارٍ الحفظ…") : t("Save settings", "حفظ الإعدادات")}
      </button>
    </form>
  );
}
