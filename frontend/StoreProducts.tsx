"use client";
import { useState, useMemo } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";
import { ProductImageManager } from "./ProductImages";
import BulkProductImages from "./BulkProductImages";
import ProductEditor, { blankProduct } from "./ProductEditor";

export interface StoreProductsProps {
  t: Translate;
  user: any;
  data: any;
  offset: number;
  publication: string;
  searchQuery: string;
  selectedIds: string[];
  busy: boolean;
  onSearch: (q: string, pub: string) => void;
  onPageChange: (offset: number) => void;
  onSelectionChange: (ids: string[]) => void;
  onSelectAll: () => Promise<void>;
  onBulkPublish: (published: boolean) => Promise<void>;
  onSinglePublish: (id: string, published: boolean, version: number) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export default function StoreProducts({
  t,
  user,
  data,
  offset,
  publication,
  searchQuery,
  selectedIds,
  busy,
  onSearch,
  onPageChange,
  onSelectionChange,
  onSelectAll,
  onBulkPublish,
  onSinglePublish,
  onRefresh,
}: StoreProductsProps) {
  const [qInput, setQInput] = useState(searchQuery);
  const [pubFilter, setPubFilter] = useState(publication);
  const [activeImageProductId, setActiveImageProductId] = useState<string | null>(null);
  const [quickPriceProduct, setQuickPriceProduct] = useState<any | null>(null);
  const [quickStockProduct, setQuickStockProduct] = useState<any | null>(null);
  const [editProduct, setEditProduct] = useState<any | null>(null);
  const [showBulkImageMatcher, setShowBulkImageMatcher] = useState(false);
  const [expandedSeoId, setExpandedSeoId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localNotice, setLocalNotice] = useState("");

  const can = (p: string) => user?.permissions?.includes(p);
  const products: any[] = data?.products || [];
  const total = data?.total || 0;

  // Quick Price form state
  const [qpMethod, setQpMethod] = useState<"COST_MARKUP" | "LIST_DISCOUNT">("COST_MARKUP");
  const [qpCost, setQpCost] = useState<string>("");
  const [qpMarkup, setQpMarkup] = useState<string>("");
  const [qpListPrice, setQpListPrice] = useState<string>("");
  const [qpDiscount, setQpDiscount] = useState<string>("");
  const [qpVat, setQpVat] = useState<string>("15");
  const [qpDefaultLevel, setQpDefaultLevel] = useState<string>("RETAIL");

  function openQuickPrice(p: any) {
    setQuickPriceProduct(p);
    setQpMethod(p.pricing_method || "COST_MARKUP");
    setQpCost(p.cost || "0");
    setQpMarkup(p.markup || "20");
    setQpListPrice(p.list_price || "0");
    setQpDiscount(p.base_discount || "0");
    setQpVat(p.vat || data.defaultVat || "15");
    setQpDefaultLevel(p.default_level || "RETAIL");
  }

  // Real-time calculation for Quick Price modal
  const qpCalculated = useMemo(() => {
    let masterExcl = 0;
    const costNum = parseFloat(qpCost) || 0;
    const markupNum = parseFloat(qpMarkup) || 0;
    const listNum = parseFloat(qpListPrice) || 0;
    const discNum = parseFloat(qpDiscount) || 0;
    const vatNum = parseFloat(qpVat) || 15;

    if (qpMethod === "COST_MARKUP") {
      masterExcl = costNum * (1 + markupNum / 100);
    } else {
      masterExcl = listNum * (1 - discNum / 100);
    }
    masterExcl = Math.max(0, masterExcl);
    const vatAmount = masterExcl * (vatNum / 100);
    const finalPrice = masterExcl + vatAmount;

    return {
      masterExcl: masterExcl.toFixed(2),
      vatAmount: vatAmount.toFixed(2),
      finalPrice: finalPrice.toFixed(2),
    };
  }, [qpMethod, qpCost, qpMarkup, qpListPrice, qpDiscount, qpVat]);

  async function saveQuickPrice() {
    if (!quickPriceProduct) return;
    setActionBusy(true);
    setLocalError("");
    setLocalNotice("");
    try {
      await api(`storefront-admin/quick-price/${quickPriceProduct.id}`, "PUT", {
        method: qpMethod,
        cost: qpCost,
        markup: qpMarkup,
        listPrice: qpListPrice,
        baseDiscount: qpDiscount,
        vat: qpVat,
        defaultLevel: qpDefaultLevel,
      });
      setLocalNotice(t("Pricing updated successfully", "تم تحديث الأسعار بنجاح"));
      setQuickPriceProduct(null);
      await onRefresh();
    } catch (e: any) {
      setLocalError(e.message || "Failed to update price");
    } finally {
      setActionBusy(false);
    }
  }

  const [qsQuantity, setQsQuantity] = useState<string>("");
  const [qsReason, setQsReason] = useState<string>("");

  function openQuickStock(p: any) {
    setQuickStockProduct(p);
    setQsQuantity("");
    setQsReason("");
  }

  async function saveQuickStock() {
    if (!quickStockProduct || !qsQuantity) return;
    setActionBusy(true);
    setLocalError("");
    setLocalNotice("");
    try {
      await api(`storefront-admin/quick-stock/${quickStockProduct.id}`, "PUT", {
        quantity: qsQuantity,
        reason: qsReason,
      });
      setLocalNotice(t("Stock updated successfully", "تم تحديث المخزون بنجاح"));
      setQuickStockProduct(null);
      await onRefresh();
    } catch (e: any) {
      setLocalError(e.message || "Failed to update stock");
    } finally {
      setActionBusy(false);
    }
  }

  async function saveProductSeo(p: any, form: HTMLFormElement) {
    setActionBusy(true);
    setLocalError("");
    setLocalNotice("");
    const f = new FormData(form);
    try {
      await api(`storefront-admin/products/${p.id}`, "PUT", {
        published: p.storefront_published,
        version: p.version,
        slug: String(f.get("slug") || "").trim() || undefined,
        content: {
          description: String(f.get("description") || "").trim(),
          seoTitle: String(f.get("seoTitle") || "").trim(),
          seoDescription: String(f.get("seoDescription") || "").trim(),
        },
      });
      setLocalNotice(t("Product store content saved", "تم حفظ بيانات ومحتوى المنتج"));
      setExpandedSeoId(null);
      await onRefresh();
    } catch (e: any) {
      setLocalError(e.message || "Failed to save content");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="store-products-hub">
      {/* HEADER & QUICK ACTIONS */}
      <div className="products-hub-top-bar">
        <div className="hub-top-left">
          <h2>{t("Storefront Catalog Management", "إدارة منتجات المتجر")}</h2>
          <p>
            {t(
              "Publish products, manage photos, adjust pricing, and track live stock in one window.",
              "انشر المنتجات، أدر الصور، عدل الأسعار، وتابع المخزون من نافذة واحدة شاملة.",
            )}
          </p>
        </div>
        <div className="hub-top-right">
          {can("PRODUCT_CREATE") && can("COST_VIEW") && (
            <button
              type="button"
              className="primary-action-btn"
              onClick={() => setEditProduct({ ...blankProduct, vat: data.defaultVat })}
            >
              ➕ {t("Add Product", "إضافة منتج")}
            </button>
          )}
          {can("PRODUCT_EDIT") && (
            <button
              type="button"
              className="secondary-action-btn"
              onClick={() => setShowBulkImageMatcher(!showBulkImageMatcher)}
            >
              🖼️ {showBulkImageMatcher ? t("Hide Image Matcher", "إخفاء مطابقة الصور") : t("Bulk Images Matcher", "مطابقة الصور الجماعية")}
            </button>
          )}
          {can("IMPORT_EXCEL") && (
            <a
              href={appPath("/") + "?commerce=imports"}
              className="secondary-action-btn link-btn"
            >
              📥 {t("Bulk Excel Import", "استيراد ملف إكسل")}
            </a>
          )}
        </div>
      </div>

      {/* BULK IMAGES MATCH ACCORDION */}
      {showBulkImageMatcher && can("PRODUCT_EDIT") && (
        <div className="bulk-images-accordion">
          <BulkProductImages t={t} />
        </div>
      )}

      {/* MULTI-SELECT BULK ACTIONS BAR */}
      <div className="products-bulk-actions-bar">
        <div className="bulk-selection-controls">
          <button
            type="button"
            className="bulk-select-btn"
            disabled={busy || !products.length}
            onClick={() =>
              onSelectionChange([...new Set([...selectedIds, ...products.map((p) => p.id)])])
            }
          >
            ☑️ {t("Select page", "تحديد الصفحة")}
          </button>
          <button
            type="button"
            className="bulk-select-btn"
            disabled={busy}
            onClick={onSelectAll}
          >
            🌐 {t("Select all matching", "تحديد كل النتائج")}
          </button>
          {selectedIds.length > 0 && (
            <button
              type="button"
              className="bulk-select-btn clear"
              disabled={busy}
              onClick={() => onSelectionChange([])}
            >
              ✕ {t("Clear selection", "إلغاء التحديد")}
            </button>
          )}
          <span className="selected-count-badge">
            {t("Selected", "المحدد")}: <strong>{selectedIds.length}</strong>
          </span>
        </div>

        <div className="bulk-operation-buttons">
          <button
            type="button"
            className="bulk-op-btn publish"
            disabled={busy || !selectedIds.length}
            onClick={() => onBulkPublish(true)}
          >
            🟢 {t("Publish selected", "نشر المحدد بالمتجر")}
          </button>
          <button
            type="button"
            className="bulk-op-btn unpublish"
            disabled={busy || !selectedIds.length}
            onClick={() => onBulkPublish(false)}
          >
            🔴 {t("Unpublish selected", "إلغاء نشر المحدد")}
          </button>
        </div>
      </div>

      {/* FILTER & SEARCH CONTROLS */}
      <div className="products-filter-toolbar">
        <form
          className="search-and-filter-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(qInput, pubFilter);
          }}
        >
          <div className="filter-select-group">
            <select
              aria-label={t("Publication filter", "تصفية النشر")}
              value={pubFilter}
              onChange={(e) => {
                setPubFilter(e.target.value);
                onSearch(qInput, e.target.value);
              }}
              className="pub-filter-select"
            >
              <option value="ALL">{t("All Products", "كل المنتجات")}</option>
              <option value="PUBLISHED">{t("Published on Store", "منشور بالمتجر")}</option>
              <option value="UNPUBLISHED">{t("Unpublished", "غير منشور")}</option>
              <option value="INACTIVE">{t("Inactive in ERP", "غير نشط في النظام")}</option>
              <option value="MISSING_IMAGE">{t("Missing Photo", "بدون صورة")}</option>
              <option value="MISSING_PRICE">{t("Missing Public Price", "بدون سعر عام")}</option>
            </select>
          </div>

          <div className="search-box-group">
            <span className="search-lens">🔍</span>
            <input
              type="text"
              className="search-product-input"
              placeholder={t("Part number or description…", "رقم الصنف أو الوصف…")}
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            {qInput && (
              <button
                type="button"
                className="clear-input-btn"
                onClick={() => {
                  setQInput("");
                  onSearch("", pubFilter);
                }}
              >
                ✕
              </button>
            )}
            <button type="submit" className="search-submit-btn" disabled={busy}>
              {t("Search", "بحث")}
            </button>
          </div>
        </form>

        {/* PAGING NAVIGATION */}
        <div className="products-pagination-controls">
          <button
            type="button"
            className="pager-btn"
            disabled={busy || offset === 0}
            onClick={() => onPageChange(Math.max(0, offset - 100))}
          >
            ❮ {t("Previous", "السابق")}
          </button>
          <span className="pager-indicator">
            {total ? offset + 1 : 0} – {offset + products.length} / {total}
          </span>
          <button
            type="button"
            className="pager-btn"
            disabled={busy || offset + 100 >= total}
            onClick={() => onPageChange(offset + 100)}
          >
            {t("Next", "التالي")} ❯
          </button>
        </div>
      </div>

      {localError && (
        <div className="notice error" role="alert">
          {localError}
        </div>
      )}
      {localNotice && (
        <div className="notice success" role="status">
          {localNotice}
        </div>
      )}

      {/* PRODUCTS ENTERPRISE TABLE */}
      {products.length === 0 ? (
        <div className="products-empty-state">
          <div className="empty-icon">🔍</div>
          <h3>{t("No products match your criteria", "لم يتم العثور على منتجات مطابقة")}</h3>
          <p>
            {t(
              "Try clearing your search or switching publication filters.",
              "جرب مسح نص البحث أو تغيير خيارات تصفية النشر.",
            )}
          </p>
        </div>
      ) : (
        <div className="products-table-wrapper">
          <table className="products-enterprise-table">
            <thead>
              <tr>
                <th style={{ width: "36px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    aria-label={t("Select page items", "تحديد عناصر الصفحة")}
                    checked={
                      products.length > 0 &&
                      products.every((p) => selectedIds.includes(p.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectionChange([
                          ...new Set([...selectedIds, ...products.map((p) => p.id)]),
                        ]);
                      } else {
                        const pageIds = new Set(products.map((p) => p.id));
                        onSelectionChange(selectedIds.filter((id) => !pageIds.has(id)));
                      }
                    }}
                  />
                </th>
                <th style={{ width: "80px" }}>{t("Photo", "الصورة")}</th>
                <th>{t("Part Number & Details", "رقم الصنف والتفاصيل")}</th>
                <th style={{ width: "130px" }}>{t("Stock", "المخزون")}</th>
                <th style={{ width: "180px" }}>{t("Price & VAT", "السعر والضريبة")}</th>
                <th style={{ width: "120px", textAlign: "center" }}>
                  {t("Store Publish", "النشر بالمتجر")}
                </th>
                <th style={{ width: "220px", textAlign: "center" }}>
                  {t("Quick Actions", "إجراءات سريعة")}
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const isSelected = selectedIds.includes(p.id);
                const isPublished = Boolean(p.storefront_published);
                const stockNum = parseFloat(p.available || "0");
                const priceExcl = parseFloat(p.master_excl || "0");
                const vatRate = parseFloat(p.vat || data?.defaultVat || "15");
                const vatAmount = priceExcl * (vatRate / 100);
                const priceIncl = priceExcl + vatAmount;
                const photoCount = parseInt(p.image_count || "0", 10);

                return (
                  <tr
                    key={p.id}
                    className={`product-row ${isSelected ? "selected-row" : ""} ${
                      !p.active ? "inactive-row" : ""
                    }`}
                  >
                    {/* CHECKBOX */}
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={t("Select product", "تحديد المنتج") + " " + p.part_number}
                        checked={isSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onSelectionChange([...selectedIds, p.id]);
                          } else {
                            onSelectionChange(selectedIds.filter((id) => id !== p.id));
                          }
                        }}
                      />
                    </td>

                    {/* PHOTO THUMBNAIL (1-Click to Photo Manager) */}
                    <td>
                      <div
                        className="product-thumb-container"
                        onClick={() => setActiveImageProductId(p.id)}
                        title={t("Click to manage photos", "اضغط لإدارة الصور")}
                      >
                        {p.primary_image_id ? (
                          <img
                            src={appPath(`/api/v1/products/${p.id}/images/${p.primary_image_id}`)}
                            alt={p.part_number}
                            className="product-thumb-img"
                            loading="lazy"
                          />
                        ) : (
                          <div className="product-thumb-placeholder">
                            <span>📷</span>
                            <small>{t("No photo", "بدون صورة")}</small>
                          </div>
                        )}
                        {photoCount > 1 && (
                          <span className="thumb-count-pill">{photoCount}</span>
                        )}
                      </div>
                    </td>

                    {/* PART NUMBER & DETAILS */}
                    <td>
                      <div className="product-info-cell">
                        <div className="part-number-line">
                          <strong className="part-number-text">{p.part_number}</strong>
                          {p.brand_name && (
                            <span className="brand-tag">🏷️ {p.brand_name}</span>
                          )}
                          {p.category_name && (
                            <span className="category-tag">📁 {p.category_name}</span>
                          )}
                          {!p.active && (
                            <span className="inactive-tag">{t("Inactive ERP", "غير نشط")}</span>
                          )}
                        </div>
                        <div className="description-text">{p.description}</div>
                        {p.storefront_slug && (
                          <small className="slug-preview">
                            🔗 /{p.storefront_slug}
                          </small>
                        )}
                      </div>

                      {/* SLIDE-DOWN STOREFRONT SEO / CONTENT EDITOR */}
                      {expandedSeoId === p.id && (
                        <div className="seo-drawer-card">
                          <h4>🌐 {t("Storefront Content & SEO", "محتوى المتجر ومحركات البحث")}</h4>
                          <form
                            className="seo-form"
                            onSubmit={(e) => {
                              e.preventDefault();
                              saveProductSeo(p, e.currentTarget);
                            }}
                          >
                            <div className="seo-form-grid">
                              <label>
                                <span>{t("URL Slug", "رابط المنتج (Slug)")}</span>
                                <input
                                  name="slug"
                                  defaultValue={p.storefront_slug || ""}
                                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                                  placeholder="e.g. schneider-switch-16a"
                                />
                              </label>
                              <label>
                                <span>{t("Custom Store Headline / Title", "عنوان مخصص للمتجر")}</span>
                                <input
                                  name="seoTitle"
                                  defaultValue={p.storefront_content?.seoTitle || ""}
                                  placeholder={p.description}
                                />
                              </label>
                              <label className="full-width">
                                <span>{t("Storefront Detailed Description", "الوصف التفصيلي للمتجر")}</span>
                                <textarea
                                  name="description"
                                  rows={2}
                                  defaultValue={p.storefront_content?.description || ""}
                                  placeholder={t("Detailed specs, applications, warranty...", "المواصفات، التطبيقات، الضمان...")}
                                />
                              </label>
                              <label className="full-width">
                                <span>{t("Meta Description for Google Search", "وصف البحث في Google")}</span>
                                <textarea
                                  name="seoDescription"
                                  rows={2}
                                  defaultValue={p.storefront_content?.seoDescription || ""}
                                  placeholder={t("Short summary for search results (max 160 chars)", "ملخص قصير لمحركات البحث")}
                                />
                              </label>
                            </div>
                            <div className="seo-form-actions">
                              <button
                                type="submit"
                                className="primary save-seo-btn"
                                disabled={actionBusy}
                              >
                                💾 {t("Save Content", "حفظ المحتوى")}
                              </button>
                              <button
                                type="button"
                                className="cancel-seo-btn"
                                onClick={() => setExpandedSeoId(null)}
                              >
                                {t("Cancel", "إلغاء")}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </td>

                    {/* STOCK STATUS */}
                    <td>
                      <div className="stock-status-cell">
                        {stockNum > 5 ? (
                          <span className="stock-pill in-stock">
                            ✅ {stockNum} {t("In Stock", "متوفر")}
                          </span>
                        ) : stockNum > 0 ? (
                          <span className="stock-pill limited-stock">
                            ⚠️ {stockNum} {t("Limited", "محدود")}
                          </span>
                        ) : (
                          <span className="stock-pill out-of-stock">
                            ❌ {t("Out of stock", "نفد المخزون")}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* PRICING */}
                    <td>
                      <div className="pricing-cell">
                        {priceExcl > 0 ? (
                          <>
                            <div className="price-main-line">
                              <span className="retail-price-bold">
                                {priceIncl.toFixed(2)} SAR
                              </span>
                              <small className="vat-tag">
                                ({t("Incl. 15% VAT", "شامل الضريبة")})
                              </small>
                            </div>
                            <div className="price-sub-line">
                              <span>
                                {priceExcl.toFixed(2)} SAR {t("Excl.", "قبل الضريبة")}
                              </span>
                            </div>
                            {p.default_level && (
                              <span className="price-level-badge">
                                🏷️ {p.default_level}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="unpriced-badge">
                            {t("Unpriced / Quote Only", "طلب تسعير فقط")}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 1-CLICK PUBLISH TOGGLE SWITCH */}
                    <td style={{ textAlign: "center" }}>
                      <label
                        className="store-publish-switch"
                        title={
                          isPublished
                            ? t("Click to unpublish from store", "اضغط لإلغاء النشر من المتجر")
                            : t("Click to publish to store", "اضغط للنشر في المتجر")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={isPublished}
                          disabled={busy || (!p.active && !isPublished)}
                          onChange={() =>
                            onSinglePublish(p.id, !isPublished, p.version)
                          }
                        />
                        <span className="switch-slider"></span>
                      </label>
                      <span className={`publish-label-text ${isPublished ? "pub" : "unpub"}`}>
                        {isPublished ? t("Published", "منشور") : t("Hidden", "مخفي")}
                      </span>
                    </td>

                    {/* QUICK ACTION BUTTONS */}
                    <td>
                      <div className="row-action-buttons">
                        {/* Photos Button */}
                        <button
                          type="button"
                          className="icon-action-btn photo"
                          onClick={() => setActiveImageProductId(p.id)}
                          title={t("Manage Photos", "إدارة الصور")}
                        >
                          📸 {t("Photos", "الصور")}
                          {photoCount > 0 && <span className="btn-badge">{photoCount}</span>}
                        </button>

                        {/* Quick Price Button */}
                        {can("PRODUCT_EDIT") && can("COST_VIEW") && (
                          <button
                            type="button"
                            className="icon-action-btn price"
                            onClick={() => openQuickPrice(p)}
                            title={t("Edit Price & Levels", "تعديل السعر والمستويات")}
                          >
                            💰 {t("Price", "السعر")}
                          </button>
                        )}

                        {/* Quick Stock Button */}
                        {can("PRODUCT_EDIT") && (
                          <button
                            type="button"
                            className="icon-action-btn stock"
                            onClick={() => openQuickStock(p)}
                            title={t("Add/Adjust Stock", "إضافة / تعديل المخزون")}
                          >
                            📦 {t("Stock", "المخزون")}
                          </button>
                        )}

                        {/* Full Edit Button */}
                        {can("PRODUCT_EDIT") && can("PRODUCT_VIEW") && (
                          <button
                            type="button"
                            className="icon-action-btn edit"
                            onClick={async () => {
                              try {
                                const r = await api("products/" + p.id);
                                setEditProduct({
                                  ...r,
                                  partNumber: r.part_number || r.partNumber,
                                });
                              } catch (e: any) {
                                setLocalError(e.message);
                              }
                            }}
                            title={t("Full Product Editor", "محرر المنتج الكامل")}
                          >
                            ✏️ {t("Edit", "تعديل")}
                          </button>
                        )}

                        {/* SEO Button */}
                        <button
                          type="button"
                          className={`icon-action-btn seo ${expandedSeoId === p.id ? "active" : ""}`}
                          onClick={() =>
                            setExpandedSeoId(expandedSeoId === p.id ? null : p.id)
                          }
                          title={t("Store Description & SEO", "وصف المتجر والبحث")}
                        >
                          🌐 SEO
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* QUICK PRICE MODAL */}
      {quickPriceProduct && (
        <div
          className="modal-backdrop"
          onClick={() => setQuickPriceProduct(null)}
        >
          <div
            className="quick-price-modal-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("Quick Price Editor", "محرر السعر السريع")}
          >
            <div className="modal-header">
              <div>
                <h3>💰 {t("Quick Price Editor", "تعديل السعر السريع")}</h3>
                <p>
                  <strong>{quickPriceProduct.part_number}</strong> — {quickPriceProduct.description}
                </p>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setQuickPriceProduct(null)}
              >
                ✕
              </button>
            </div>

            <div className="quick-price-body">
              {/* Pricing Method Selector */}
              <div className="price-method-selector">
                <button
                  type="button"
                  className={`method-chip ${qpMethod === "COST_MARKUP" ? "active" : ""}`}
                  onClick={() => setQpMethod("COST_MARKUP")}
                >
                  📈 {t("Cost + Markup %", "التكلفة + نسبة الربح")}
                </button>
                <button
                  type="button"
                  className={`method-chip ${qpMethod === "LIST_DISCOUNT" ? "active" : ""}`}
                  onClick={() => setQpMethod("LIST_DISCOUNT")}
                >
                  📉 {t("List Price - Discount %", "سعر القائمة - نسبة الخصم")}
                </button>
              </div>

              {/* Pricing Inputs Grid */}
              <div className="qp-form-grid">
                {qpMethod === "COST_MARKUP" ? (
                  <>
                    <label>
                      <span>{t("Cost Price (SAR)", "سعر التكلفة (ر.س)")}</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={qpCost}
                        onChange={(e) => setQpCost(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>{t("Markup Percentage (%)", "نسبة الربح (%)")}</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={qpMarkup}
                        onChange={(e) => setQpMarkup(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      <span>{t("List Price (SAR)", "سعر القائمة (ر.س)")}</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={qpListPrice}
                        onChange={(e) => setQpListPrice(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>{t("Base Discount (%)", "نسبة الخصم الأساسية (%)")}</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        value={qpDiscount}
                        onChange={(e) => setQpDiscount(e.target.value)}
                      />
                    </label>
                  </>
                )}

                <label>
                  <span>{t("VAT Rate (%)", "نسبة الضريبة (%)")}</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={qpVat}
                    onChange={(e) => setQpVat(e.target.value)}
                  />
                </label>

                <label>
                  <span>{t("Default Selling Level", "مستوى السعر الافتراضي")}</span>
                  <select
                    value={qpDefaultLevel}
                    onChange={(e) => setQpDefaultLevel(e.target.value)}
                  >
                    <option value="RETAIL">{t("Retail", "تجزئة")}</option>
                    <option value="WHOLESALE">{t("Wholesale", "جملة")}</option>
                    <option value="END_CUSTOMER">{t("End Customer", "عميل نهائي")}</option>
                  </select>
                </label>
              </div>

              {/* LIVE CALCULATION PREVIEW CARD */}
              <div className="qp-preview-card">
                <div className="qp-preview-line">
                  <span>{t("Base Price (Excl. VAT):", "السعر الأساسي (بدون ضريبة):")}</span>
                  <strong>{qpCalculated.masterExcl} SAR</strong>
                </div>
                <div className="qp-preview-line">
                  <span>{t("VAT Amount (15%):", "مبلغ الضريبة (15%):")}</span>
                  <span>{qpCalculated.vatAmount} SAR</span>
                </div>
                <div className="qp-preview-line total-line">
                  <span>{t("Final Store Price (Incl. VAT):", "سعر البيع النهائي بالمتجر (شامل الضريبة):")}</span>
                  <strong className="final-sar-bold">{qpCalculated.finalPrice} SAR</strong>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="primary save-price-btn"
                disabled={actionBusy}
                onClick={saveQuickPrice}
              >
                💾 {t("Save & Update Price", "حفظ وتحديث السعر")}
              </button>
              <button
                type="button"
                className="cancel-btn"
                onClick={() => setQuickPriceProduct(null)}
                disabled={actionBusy}
              >
                {t("Cancel", "إلغاء")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRODUCT IMAGE MANAGER MODAL */}
      {activeImageProductId && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("Product Images", "صور المنتج")}
          >
            <div className="modal-header" style={{ marginBottom: "15px" }}>
              <h3>📸 {t("Product Images Manager", "إدارة صور المنتج")}</h3>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => {
                  setActiveImageProductId(null);
                  void onRefresh();
                }}
              >
                {t("Close", "إغلاق")}
              </button>
            </div>
            <ProductImageManager
              key={activeImageProductId}
              productId={activeImageProductId}
              t={t}
            />
          </section>
        </div>
      )}

      {/* QUICK STOCK MODAL */}
      {quickStockProduct && (
        <div
          className="modal-backdrop"
          onClick={() => setQuickStockProduct(null)}
        >
          <div
            className="quick-price-modal-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t("Quick Stock Editor", "محرر المخزون السريع")}
          >
            <div className="modal-header">
              <div>
                <h3>📦 {t("Quick Stock Editor", "تعديل المخزون السريع")}</h3>
                <p>
                  <strong>{quickStockProduct.part_number}</strong> — {quickStockProduct.description}
                </p>
                <div style={{ marginTop: '8px' }}>
                    <span className="stock-pill in-stock">
                        ✅ {t("Current Available", "المتوفر حالياً")}: {quickStockProduct.available || 0}
                    </span>
                </div>
              </div>
              <button
                type="button"
                className="close-modal-btn"
                onClick={() => setQuickStockProduct(null)}
              >
                ✕
              </button>
            </div>

            <div className="quick-price-body">
              <div className="qp-form-grid">
                <label>
                  <span>{t("Quantity to Add/Remove (+/-)", "الكمية المضافة/المسحوبة (+/-)")}</span>
                  <input
                    type="number"
                    step="1"
                    value={qsQuantity}
                    placeholder="e.g. 50 or -10"
                    onChange={(e) => setQsQuantity(e.target.value)}
                    required
                  />
                </label>
                <label className="full-width">
                  <span>{t("Reason / Note", "السبب / الملاحظة")}</span>
                  <input
                    type="text"
                    value={qsReason}
                    placeholder={t("e.g. Manual inventory count, Received from supplier", "مثال: جرد يدوي، استلام من المورد")}
                    onChange={(e) => setQsReason(e.target.value)}
                  />
                </label>
              </div>

              <div className="quick-price-actions">
                <button
                  type="button"
                  className="primary-action-btn"
                  onClick={saveQuickStock}
                  disabled={actionBusy || !qsQuantity}
                >
                  {actionBusy ? "⏳" : "💾"} {t("Save Stock", "حفظ المخزون")}
                </button>
                <button
                  type="button"
                  className="secondary-action-btn"
                  onClick={() => setQuickStockProduct(null)}
                  disabled={actionBusy}
                >
                  {t("Cancel", "إلغاء")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FULL PRODUCT EDITOR MODAL */}
      {editProduct && (
        <ProductEditor
          key={editProduct.id || "new"}
          t={t}
          initial={editProduct}
          actionBusy={actionBusy}
          onClose={() => setEditProduct(null)}
          onSave={async (p) => {
            setActionBusy(true);
            try {
              const saved = await api(
                "products" + (editProduct.id ? "/" + editProduct.id : ""),
                editProduct.id ? "PUT" : "POST",
                p,
              );
              setEditProduct({
                ...saved,
                partNumber: saved.part_number || saved.partNumber,
              });
              setLocalNotice(
                t(
                  "Product saved. You can manage its images and publication below.",
                  "تم حفظ المنتج. يمكنك إدارة صوره ونشره أدناه.",
                ),
              );
              await onRefresh();
              return saved;
            } catch (e: any) {
              setLocalError(e.message);
              throw e;
            } finally {
              setActionBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
