"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";
import CommerceConsole from "./CommerceConsole";
import ProductEditor, { blankProduct } from "./ProductEditor";
import CatalogOptionsSearch from "./CatalogOptionsSearch";
import CategorySeo from "./CategorySeo";
import BulkProductImages from "./BulkProductImages";
import { ProductImageManager } from "./ProductImages";
import WhatsAppAdmin from "./WhatsAppAdmin";
import StoreInventory from "./StoreInventory";
import StoreOrders from "./StoreOrders";
import StoreProducts from "./StoreProducts";
import "./storefront.css";

export default function StorefrontAdmin({
  t,
  user,
  navigate,
}: {
  t: Translate;
  user: any;
  navigate: (section: any) => void;
}) {
  const [edit, setEdit] = useState<any>();
  const [imageProduct, setImageProduct] = useState<string>();
  const [optionProducts, setOptionProducts] = useState<any[]>([]);
  const addOptions = (rows: any[]) =>
    setOptionProducts((current) => [
      ...new Map([...current, ...rows].map((p) => [p.id, p])).values(),
    ]);
  const loadSequence = useRef(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [offset, setOffset] = useState(0);
  const [publication, setPublication] = useState("ALL");
  const [data, setData] = useState<any>();
  const [commerceData, setCommerceData] = useState<any>();
  const [warehouses, setWarehouses] = useState<any[]>([]);

  // 6 Primary Enterprise Hubs
  // "orders" | "products" | "marketing" | "corporate" | "whatsapp" | "settings"
  const [tab, updateTab] = useState<string>("orders");

  // Secondary sub-tabs for grouped hubs
  const [marketingSubTab, setMarketingSubTab] = useState<"homepage" | "promotions" | "seo">("homepage");
  const [corporateSubTab, setCorporateSubTab] = useState<"customers" | "accounts" | "pricing" | "quotes" | "returns">("customers");
  const [settingsSubTab, setSettingsSubTab] = useState<"general" | "zones" | "inventory">("general");

  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const queryParams = (queryStr = q, pubStr = publication) =>
    `q=${encodeURIComponent(queryStr)}&publication=${pubStr}`;

  async function selectAll() {
    setBusy(true);
    try {
      const r = await api(
        `storefront-admin/management?${queryParams()}&selection=true`,
      );
      setSelected(r.products.map((p: any) => p.id));
      setVersions(
        Object.fromEntries(r.products.map((p: any) => [p.id, p.version])),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publishSelected(published: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    const pending = new Set(selected),
      failures: string[] = [];
    let updated = 0;
    try {
      for (let i = 0; i < selected.length; i += 100) {
        const result = await api("storefront-admin/bulk-publish", "PUT", {
          items: selected
            .slice(i, i + 100)
            .map((id) => ({ id, version: versions[id], published })),
        });
        for (const row of result.results) {
          if (row.ok) {
            pending.delete(row.id);
            updated++;
          } else failures.push(row.id + ": " + row.error);
        }
      }
    } catch (e) {
      failures.push((e as Error).message);
    } finally {
      setSelected([...pending]);
      await load();
      setNotice(t("Updated", "تم تحديث") + ": " + updated);
      if (failures.length) setError(failures.join("; "));
      setBusy(false);
    }
  }

  const can = (p: string) => user?.permissions?.includes(p);

  const hubs = [
    ["orders", "🛍️ Orders & Sales", "🛍️ الطلبات والمبيعات"],
    ["products", "📦 Products Catalog", "📦 كتالوج المنتجات"],
    ["marketing", "🎨 Store & Marketing", "🎨 واجهة المتجر والتسويق"],
    ["corporate", "🏢 Corporate & B2B", "🏢 حسابات وطلبات الشركات"],
    ...(can("SETTINGS_MANAGE")
      ? [["whatsapp", "💬 WhatsApp & Bot", "💬 واتساب والبوت"]]
      : []),
    ["settings", "⚙️ Store Settings", "⚙️ إعدادات المتجر"],
  ];

  function setTab(value: string) {
    updateTab(value);
    const url = new URL(location.href);
    url.searchParams.set("commerce", "storefront");
    url.searchParams.set("storeTab", value);
    history.pushState(null, "", url);
  }

  // Restore active tab from query params with backward compatibility for old tabs
  useEffect(() => {
    const restore = () => {
      const value = new URLSearchParams(location.search).get("storeTab");
      if (!value) return;

      if (["orders"].includes(value)) {
        updateTab("orders");
      } else if (["products"].includes(value)) {
        updateTab("products");
      } else if (["homepage", "promotions", "marketing"].includes(value)) {
        updateTab("marketing");
        if (value === "homepage" || value === "promotions") {
          setMarketingSubTab(value as any);
        }
      } else if (["customers", "pricing", "quotes", "returns", "accounts", "corporate"].includes(value)) {
        updateTab("corporate");
        if (["customers", "pricing", "quotes", "returns", "accounts"].includes(value)) {
          setCorporateSubTab(value as any);
        }
      } else if (["whatsapp"].includes(value)) {
        updateTab("whatsapp");
      } else if (["settings", "zones", "inventory"].includes(value)) {
        updateTab("settings");
        if (value === "zones" || value === "inventory") {
          setSettingsSubTab(value as any);
        }
      } else {
        updateTab("orders");
      }
    };
    restore();
    window.addEventListener("popstate", restore);

    const id = new URLSearchParams(location.search).get("editProduct");
    if (id && can("PRODUCT_EDIT") && can("PRODUCT_VIEW")) {
      if (can("COST_VIEW"))
        api("products/" + encodeURIComponent(id))
          .then((r) =>
            setEdit({ ...r, partNumber: r.part_number || r.partNumber }),
          )
          .catch((e) => setError(e.message));
      else setImageProduct(id);
    }
    return () => window.removeEventListener("popstate", restore);
  }, []);

  async function loadCommerce() {
    try {
      const c = await api("storefront-admin/commerce");
      setCommerceData(c);
    } catch (e: any) {
      console.error("Failed to load commerce data", e);
    }
  }

  async function loadWarehouses() {
    try {
      const w = await api("warehouses?pageSize=100&active=ACTIVE");
      setWarehouses(w.items || []);
    } catch (e: any) {
      console.error("Failed to load warehouses", e);
    }
  }

  async function load(nextOffset = offset, queryStr = q, pubStr = publication) {
    const sequence = ++loadSequence.current;
    try {
      const result = await api(
        `storefront-admin/management?${queryParams(queryStr, pubStr)}&offset=${nextOffset}`,
      );
      if (sequence !== loadSequence.current) return;
      setData(result);
      setOffset(nextOffset);
      addOptions(result.products);
      setVersions((previous) => ({
        ...previous,
        ...Object.fromEntries(
          result.products
            .filter((p: any) => !selected.includes(p.id))
            .map((p: any) => [p.id, p.version]),
        ),
      }));
      setError("");
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    loadCommerce();
    loadWarehouses();
  }, []);

  async function save(path: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, "PUT", body);
      await load();
      await loadCommerce();
      setNotice(t("Saved", "تم الحفظ"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="storefront-admin-container"
      aria-label={t("Storefront Operations & Hub", "مركز إدارة وتشغيل المتجر")}
    >
      {/* ENTERPRISE STOREFRONT HEADER */}
      <div className="storefront-admin-header">
        <div className="header-title-block">
          <h2>{t("Storefront Operations & Management", "إدارة المتجر الإلكتروني والطلبات")}</h2>
          <p>
            {t(
              "Process orders, manage catalog, configure promotions, and control store settings in a unified dashboard.",
              "معالجة الطلبات، إدارة المنتجات والصور والأسعار، وتحديث إعدادات المتجر من لوحة تحكم موحدة.",
            )}
          </p>
        </div>
        <div className="header-right-actions">
          <a
            href={appPath("/store")}
            target="_blank"
            rel="noreferrer"
            className="storefront-preview-btn"
          >
            🌐 {t("Open Storefront ↗", "فتح المتجر الإلكتروني ↗")}
          </a>
        </div>
      </div>

      {/* 6 MODERN ENTERPRISE HUBS NAVIGATION */}
      <nav className="storefront-hubs-nav" aria-label={t("Storefront Hubs", "أقسام إدارة المتجر")}>
        {hubs.map(([key, en, ar]) => {
          const isActive = tab === key;
          const orderBadge = key === "orders" && commerceData?.orders?.length ? commerceData.orders.length : null;
          return (
            <button
              key={key}
              type="button"
              className={`hub-nav-btn ${isActive ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              <span>{t(en, ar)}</span>
              {orderBadge !== null && (
                <span className="hub-badge-count">{orderBadge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* SYSTEM NOTIFICATIONS & ALERTS */}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}

      {/* MAIN CONTENT HUBS */}
      <div className="storefront-hub-content">
        {/* HUB 1: ORDERS & SALES (AMAZON / FLIPKART STYLE) */}
        {tab === "orders" && (
          <StoreOrders
            t={t}
            user={user}
            orders={commerceData?.orders || []}
            warehouses={warehouses}
            onRefresh={async () => {
              await loadCommerce();
            }}
          />
        )}

        {/* HUB 2: PRODUCTS CATALOG (ALL-IN-ONE WINDOW) */}
        {tab === "products" && data && (
          <StoreProducts
            t={t}
            user={user}
            data={data}
            offset={offset}
            publication={publication}
            searchQuery={q}
            selectedIds={selected}
            busy={busy}
            onSearch={(newQ, newPub) => {
              setQ(newQ);
              setPublication(newPub);
              setSelected([]);
              load(0, newQ, newPub);
            }}
            onPageChange={(newOffset) => load(newOffset)}
            onSelectionChange={(ids) => setSelected(ids)}
            onSelectAll={selectAll}
            onBulkPublish={publishSelected}
            onSinglePublish={async (id, published, version) => {
              await save(`storefront-admin/products/${id}`, { published, version });
            }}
            onRefresh={async () => {
              await load();
            }}
          />
        )}

        {/* HUB 3: STOREFRONT & MARKETING */}
        {tab === "marketing" && (
          <div className="marketing-hub-wrapper">
            <div className="sub-hubs-toolbar">
              {[
                ["homepage", "🖼️ Banners & Sections", "🖼️ البنرات والأقسام"],
                ["promotions", "🎟️ Offers & Coupons", "🎟️ العروض والكوبونات"],
                ["seo", "🌐 Category SEO", "🌐 تهيئة محركات البحث للفئات"],
              ].map(([subKey, en, ar]) => (
                <button
                  key={subKey}
                  type="button"
                  className={`sub-hub-btn ${marketingSubTab === subKey ? "active" : ""}`}
                  onClick={() => setMarketingSubTab(subKey as any)}
                >
                  {t(en, ar)}
                </button>
              ))}
            </div>

            {marketingSubTab === "seo" ? (
              <CategorySeo t={t} />
            ) : (
              <>
                <CatalogOptionsSearch t={t} onResults={addOptions} />
                <CommerceConsole
                  tab={marketingSubTab}
                  t={t}
                  products={optionProducts}
                  user={user}
                />
              </>
            )}
          </div>
        )}

        {/* HUB 4: CORPORATE & B2B */}
        {tab === "corporate" && (
          <div className="corporate-hub-wrapper">
            <div className="sub-hubs-toolbar">
              {[
                ["customers", "🏢 Companies", "🏢 الشركات المسجلة"],
                ["accounts", "👥 Business Accounts", "👥 حسابات الشركات"],
                ["pricing", "🏷️ Custom Price Lists", "🏷️ قوائم أسعار الشركات"],
                ["quotes", "📋 RFQ Requirements & Quotes", "📋 طلبات عروض الأسعار"],
                ["returns", "🔄 Returns & Refunds", "🔄 المرتجعات"],
              ].map(([subKey, en, ar]) => (
                <button
                  key={subKey}
                  type="button"
                  className={`sub-hub-btn ${corporateSubTab === subKey ? "active" : ""}`}
                  onClick={() => setCorporateSubTab(subKey as any)}
                >
                  {t(en, ar)}
                </button>
              ))}
            </div>

            {corporateSubTab === "accounts" ? (
              <div className="accounts-management-section">
                {!data?.accounts?.length ? (
                  <p className="empty-message">
                    {t("No business account applications yet.", "لا توجد طلبات حسابات شركات.")}
                  </p>
                ) : (
                  data.accounts.map((a: any) => (
                    <form
                      className="card"
                      key={JSON.stringify(a)}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        save(`storefront-admin/accounts/${a.id}`, {
                          status: f.get("status"),
                          priceLevel: f.get("priceLevel") || null,
                          creditEnabled: f.has("creditEnabled"),
                          creditLimit: f.get("creditLimit") || null,
                        });
                      }}
                    >
                      <div className="account-header">
                        <strong>{a.name} · {a.email}</strong>
                        <span>📞 {a.mobile}</span>
                      </div>
                      <div className="form-grid">
                        <label>
                          {t("Status", "الحالة")}
                          <select name="status" defaultValue={a.status}>
                            <option value="PENDING">{t("Pending approval", "بانتظار الموافقة")}</option>
                            <option value="ACTIVE">{t("Active", "نشط")}</option>
                            <option value="BLOCKED">{t("Blocked", "محظور")}</option>
                          </select>
                        </label>
                        <label>
                          {t("Price level", "مستوى السعر")}
                          <select name="priceLevel" defaultValue={a.price_level || ""}>
                            <option value="">{t("Default retail", "تجزئة افتراضي")}</option>
                            <option>WHOLESALE</option>
                            <option>RETAIL</option>
                            <option>END_CUSTOMER</option>
                          </select>
                        </label>
                        <label>
                          {t("Credit limit (SAR)", "حد الائتمان")}
                          <input
                            name="creditLimit"
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={a.credit_limit || ""}
                          />
                        </label>
                        <label className="checkbox-label">
                          <input
                            name="creditEnabled"
                            type="checkbox"
                            defaultChecked={a.credit_enabled}
                          />
                          {t("Enable credit terms", "تفعيل الائتمان")}
                        </label>
                      </div>
                      <button disabled={busy} className="save-account-btn">
                        {t("Save account", "حفظ الحساب")}
                      </button>
                    </form>
                  ))
                )}
              </div>
            ) : (
              <>
                {["pricing", "quotes"].includes(corporateSubTab) && (
                  <CatalogOptionsSearch t={t} onResults={addOptions} />
                )}
                <CommerceConsole
                  tab={corporateSubTab}
                  t={t}
                  products={optionProducts}
                  user={user}
                />
              </>
            )}
          </div>
        )}

        {/* HUB 5: WHATSAPP & BOT */}
        {tab === "whatsapp" && can("SETTINGS_MANAGE") && (
          <WhatsAppAdmin t={t} />
        )}

        {/* HUB 6: STORE SETTINGS */}
        {tab === "settings" && data && (
          <div className="settings-hub-wrapper">
            <div className="sub-hubs-toolbar">
              {[
                ["general", "⚙️ Store Configuration", "⚙️ إعدادات المتجر"],
                ["zones", "🚚 Delivery Zones", "🚚 مناطق التوصيل"],
                ["inventory", "🏬 Inventory & Replenishment", "🏬 المستودعات وإعادة الطلب"],
              ].map(([subKey, en, ar]) => (
                <button
                  key={subKey}
                  type="button"
                  className={`sub-hub-btn ${settingsSubTab === subKey ? "active" : ""}`}
                  onClick={() => setSettingsSubTab(subKey as any)}
                >
                  {t(en, ar)}
                </button>
              ))}
            </div>

            {settingsSubTab === "general" && (
              <form
                key={data.settings.version}
                className="card settings-card"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  save("storefront-admin", {
                    version: data.settings.version,
                    enabled: f.has("enabled"),
                    companyName: f.get("companyName"),
                    companyNameAr: f.get("companyNameAr"),
                    hero: f.get("hero"),
                    heroAr: f.get("heroAr"),
                    supportMobile: f.get("supportMobile"),
                    deliveryEnabled: f.has("deliveryEnabled"),
                    pickupEnabled: f.has("pickupEnabled"),
                    businessEnabled: f.has("businessEnabled"),
                    operationsEnabled: f.has("operationsEnabled"),
                    bankTransferEnabled: f.has("bankTransferEnabled"),
                    bankInstructions: String(f.get("bankInstructions") || ""),
                    onlineHoldMinutes: Number(f.get("onlineHoldMinutes")),
                    bankHoldMinutes: Number(f.get("bankHoldMinutes")),
                  });
                }}
              >
                <div className={`store-status-banner ${data.settings.enabled ? "open" : "closed"}`}>
                  <div className="status-indicator-dot"></div>
                  <div>
                    <strong>
                      {data.settings.enabled
                        ? t("Store is currently OPEN", "المتجر مفتوح حالياً")
                        : t("Store is currently CLOSED", "المتجر مغلق حالياً")}
                    </strong>
                    <p>
                      {data.settings.enabled
                        ? t(
                            "Customers can browse and place orders for published products.",
                            "يمكن للعملاء تصفح وشراء المنتجات المنشورة.",
                          )
                        : t(
                            "Storefront is hidden. Enable it below when ready to accept orders.",
                            "واجهة المتجر مخفية. فعّلها أدناه عندما تكون جاهزاً لاستقبال الطلبات.",
                          )}
                    </p>
                  </div>
                  <label className="toggle-open-label">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={data.settings.enabled}
                    />{" "}
                    {t("Open Store", "فتح المتجر")}
                  </label>
                </div>

                <div className="form-grid" style={{ marginTop: "20px" }}>
                  <label>
                    <input
                      type="checkbox"
                      name="bankTransferEnabled"
                      defaultChecked={data.settings.data.bankTransferEnabled !== false}
                    />
                    {t("Enable reviewed bank transfers", "تفعيل التحويل البنكي بعد المراجعة")}
                  </label>
                  <label className="full-width">
                    {t("Bank payment instructions (beneficiary, bank, IBAN)", "تعليمات التحويل (المستفيد، البنك، الآيبان)")}
                    <textarea
                      name="bankInstructions"
                      rows={2}
                      defaultValue={data.settings.data.bankInstructions || ""}
                    />
                  </label>
                  {[
                    ["companyName", "Company name", "اسم الشركة"],
                    ["companyNameAr", "Arabic company name", "اسم الشركة بالعربية"],
                    ["hero", "Store headline", "عنوان المتجر"],
                    ["heroAr", "Arabic headline", "العنوان بالعربية"],
                    ["supportMobile", "Support phone", "هاتف الدعم"],
                  ].map(([key, en, ar]) => (
                    <label key={key}>
                      {t(en, ar)}
                      <input
                        name={key}
                        defaultValue={
                          data.settings.data[key] ||
                          (key === "companyName" ? "AMT Electric" : "")
                        }
                        required={key === "companyName"}
                      />
                    </label>
                  ))}
                </div>

                <div className="fulfillment-toggles">
                  <label>
                    <input
                      type="checkbox"
                      name="deliveryEnabled"
                      defaultChecked={data.settings.data.deliveryEnabled !== false}
                    />{" "}
                    {t("Enable delivery (configure zones below)", "تفعيل التوصيل (حدد المناطق)")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      name="pickupEnabled"
                      defaultChecked={data.settings.data.pickupEnabled !== false}
                    />{" "}
                    {t("Enable pickup (branches in Warehouses)", "تفعيل الاستلام (حدد الفروع في المستودعات)")}
                  </label>
                </div>

                <div className="form-grid" style={{ marginTop: "15px" }}>
                  <label>
                    <input
                      name="businessEnabled"
                      type="checkbox"
                      defaultChecked={data.settings.data.businessEnabled}
                    />
                    {t("Enable company portal and requests", "تفعيل بوابة الشركات والطلبات")}
                  </label>
                  <label>
                    <input
                      name="operationsEnabled"
                      type="checkbox"
                      defaultChecked={data.settings.data.operationsEnabled}
                    />
                    {t("Enable payment operations and returns", "تفعيل عمليات الدفع والمرتجعات")}
                  </label>
                  <label>
                    {t("Online payment hold (minutes)", "حجز الدفع الإلكتروني (دقائق)")}
                    <input
                      type="number"
                      min="5"
                      max="120"
                      name="onlineHoldMinutes"
                      defaultValue={data.settings.data.onlineHoldMinutes || 15}
                    />
                  </label>
                  <label>
                    {t("Bank review hold (minutes)", "حجز مراجعة التحويل (دقائق)")}
                    <input
                      type="number"
                      min="30"
                      max="10080"
                      name="bankHoldMinutes"
                      defaultValue={data.settings.data.bankHoldMinutes || 1440}
                    />
                  </label>
                </div>

                <button className="primary" disabled={busy} style={{ marginTop: "20px" }}>
                  💾 {t("Save store settings", "حفظ إعدادات المتجر")}
                </button>
              </form>
            )}

            {settingsSubTab === "zones" && (
              <div className="zones-management-section">
                {[
                  ...data.zones,
                  {
                    id: "new",
                    name: "",
                    fee: "0",
                    active: true,
                    free_above: null,
                  },
                ].map((zone: any) => (
                  <form
                    className="card zone-card"
                    key={zone.id + JSON.stringify(zone)}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      save("storefront-admin/zones", {
                        ...(zone.id !== "new" ? { id: zone.id } : {}),
                        name: f.get("name"),
                        fee: f.get("fee"),
                        freeAbove: f.get("freeAbove") || null,
                        active: f.has("active"),
                      });
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        {t("Zone name", "اسم المنطقة")}
                        <input name="name" required defaultValue={zone.name} />
                      </label>
                      <label>
                        {t("Delivery fee (SAR)", "رسوم التوصيل")}
                        <input
                          name="fee"
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          defaultValue={Number(zone.fee)}
                        />
                      </label>
                      <label>
                        {t("Free above subtotal (optional)", "توصيل مجاني فوق (اختياري)")}
                        <input
                          name="freeAbove"
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={zone.free_above === null ? "" : Number(zone.free_above)}
                        />
                      </label>
                      <label className="checkbox-label">
                        <input
                          name="active"
                          type="checkbox"
                          defaultChecked={zone.active}
                        />
                        {t("Active", "نشط")}
                      </label>
                    </div>
                    <button disabled={busy} className="primary">
                      {zone.id === "new"
                        ? t("Add zone", "إضافة منطقة")
                        : t("Save zone", "حفظ المنطقة")}
                    </button>
                  </form>
                ))}
              </div>
            )}

            {settingsSubTab === "inventory" && (
              <StoreInventory t={t} products={optionProducts} user={user} />
            )}
          </div>
        )}
      </div>

      {/* MODALS */}
      {imageProduct && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("Product images", "صور المنتج")}
          >
            <button
              onClick={() => {
                setImageProduct(undefined);
                void load();
              }}
            >
              {t("Close", "إغلاق")}
            </button>
            <ProductImageManager
              key={imageProduct}
              productId={imageProduct}
              t={t}
            />
          </section>
        </div>
      )}

      {edit && (
        <ProductEditor
          key={edit.id || "new"}
          t={t}
          initial={edit}
          actionBusy={busy}
          onClose={() => setEdit(undefined)}
          onSave={async (p) => {
            setBusy(true);
            try {
              const saved = await api(
                "products" + (edit.id ? "/" + edit.id : ""),
                edit.id ? "PUT" : "POST",
                p,
              );
              setEdit({
                ...saved,
                partNumber: saved.part_number || saved.partNumber,
              });
              setNotice(
                t(
                  "Product saved. You can now manage its images below.",
                  "تم حفظ المنتج. يمكنك إدارة صوره أدناه.",
                ),
              );
              await load();
              return saved;
            } catch (e) {
              setError((e as Error).message);
              throw e;
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}
