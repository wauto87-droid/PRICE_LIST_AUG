"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";
import CommercialLists from "./CommercialLists";
import StorefrontAdmin from "./StorefrontAdmin";
import { ProductImageGallery } from "./ProductImages";
import { showPrompt } from "./confirm";

type Section =
  | "overview"
  | "approvals"
  | "warehouses"
  | "stock"
  | "suppliers"
  | "orders"
  | "purchasing"
  | "storefront";

export default function Commercial({ t, user }: { t: Translate; user: any }) {
  const [section, setSection] = useState<Section>("overview");
  useEffect(() => {
    if (new URLSearchParams(location.search).get("commerce") === "storefront" && user.permissions.includes("STOREFRONT_MANAGE")) setSection("storefront");
  }, []);
  const [stockQuery, setStockQuery] = useState(""),
    [stockSearch, setStockSearch] = useState(""),
    [stockPage, setStockPage] = useState(1),
    [stockSize, setStockSize] = useState(50),
    [stockDetail, setStockDetail] = useState<any>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [warehouseChoice, setWarehouseChoice] = useState<
    Record<string, string>
  >({});
  const canInventory = user.permissions.includes("INVENTORY_VIEW");
  const canPurchase = user.permissions.includes("PURCHASE_MANAGE");
  const loadSequence = useRef(0);
  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      // Storefront owns its requests; unrelated warehouse/order permissions must not block it.
      if (section === "storefront") { setData(null); return; }
      const path =
        section === "overview"
          ? "commercial/dashboard"
          : section === "approvals"
            ? "quotation-approvals"
            : section === "warehouses"
              ? "warehouses"
              : section === "stock"
                ? `inventory/balances?query=${encodeURIComponent(stockQuery)}&page=${stockPage}&pageSize=${stockSize}`
                : section === "suppliers"
                  ? "suppliers"
                  : section === "orders"
                    ? "sales-orders"
                    : section === "purchasing"
                      ? "purchase-orders"
                      : "online-orders";
      const result = await api(path);
      if (sequence === loadSequence.current) setData(result);
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [section, stockQuery, stockPage, stockSize]);
  async function saveWarehouse(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api(
      editing?.id ? `warehouses/${editing.id}` : "warehouses",
      editing?.id ? "PUT" : "POST",
      {
        code: f.get("code"),
        name: f.get("name"),
        nameAr: f.get("nameAr"),
        active: f.get("active") === "on",
        allowNegativeStock: f.get("allowNegativeStock") === "on",
        pickupEnabled: f.get("pickupEnabled") === "on",
        address: {},
        ...(editing?.id ? { version: editing.version } : {}),
      },
    );
    setEditing(null);
    await load();
  }
  async function saveSupplier(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api(
      editing?.id ? `suppliers/${editing.id}` : "suppliers",
      editing?.id ? "PUT" : "POST",
      {
        code: f.get("code"),
        name: f.get("name"),
        taxNumber: f.get("taxNumber"),
        paymentTerms: f.get("paymentTerms"),
        currency: f.get("currency") || "SAR",
        leadTimeDays: Number(f.get("leadTimeDays") || 0),
        contacts: [],
        active: f.get("active") === "on",
        ...(editing?.id ? { version: editing.version } : {}),
      },
    );
    setEditing(null);
    await load();
  }
  const tabs: [Section, string, string, boolean][] = [
    ["overview", "Overview", "نظرة عامة", true],
    [
      "approvals",
      "Approvals",
      "الموافقات",
      user.permissions.includes("QUOTE_APPROVE"),
    ],
    ["orders", "Sales orders", "أوامر البيع", true],
    ["warehouses", "Warehouses", "المستودعات", canInventory],
    ["stock", "Stock", "المخزون", canInventory],
    ["suppliers", "Suppliers", "الموردون", canPurchase],
    ["purchasing", "Purchasing", "المشتريات", canPurchase],
    [
      "storefront",
      "Online store",
      "المتجر الإلكتروني",
      user.permissions.includes("STOREFRONT_MANAGE"),
    ],
  ];
  return (
    <section className="commercial-shell">
      <div className="section-head">
        <div>
          <div className="eyebrow">
            {t("COMMERCIAL OPERATIONS", "العمليات التجارية")}
          </div>
          <h2>
            {t("Sales, stock and purchasing", "المبيعات والمخزون والمشتريات")}
          </h2>
        </div>
      </div>
      <nav className="commercial-tabs">
        {tabs
          .filter((x) => x[3])
          .map(([key, en, ar]) => (
            <button
              key={key}
              className={section === key ? "active" : ""}
              onClick={() => {
                setSection(key);
                setEditing(null);
              }}
            >
              {t(en, ar)}
            </button>
          ))}
      </nav>
      {error && <div className="notice error">{error}</div>}
      {loading && (
        <div className="card compact-card">
          {t("Loading…", "جاري التحميل…")}
        </div>
      )}
      {!loading && section === "overview" && data && (
        <div className="metric-grid commercial-metrics">
          {[
            [
              t("Pending approvals", "موافقات معلقة"),
              data.quotations?.pending_approvals ?? 0,
            ],
            [
              t("Accepted quotations", "عروض مقبولة"),
              data.quotations?.accepted_quotes ?? 0,
            ],
            [
              t("Open sales orders", "أوامر بيع مفتوحة"),
              data.salesOrders?.open_orders ?? 0,
            ],
            [
              t("Active warehouses", "مستودعات نشطة"),
              data.inventory?.active_warehouses ?? 0,
            ],
            [
              t("Incoming purchase orders", "أوامر شراء قادمة"),
              data.purchasing?.incoming_pos ?? 0,
            ],
            [
              t("Online store", "المتجر الإلكتروني"),
              data.storefront?.enabled
                ? t("Enabled", "مفعّل")
                : t("Not published", "غير منشور"),
            ],
          ].map(([label, value]) => (
            <article className="metric-card" key={String(label)}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      )}
      {!loading && section === "approvals" && (
        <div className="card compact-card">
          <div className="section-head">
            <h3>
              {t("Pending quotation approvals", "موافقات عروض الأسعار المعلقة")}
            </h3>
            <button onClick={load}>{t("Refresh", "تحديث")}</button>
          </div>
          <div className="dense-table-wrap">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>{t("Quotation", "عرض السعر")}</th>
                  <th>{t("Customer", "العميل")}</th>
                  <th>{t("Requested by", "مقدم الطلب")}</th>
                  <th>{t("Rule / tier", "القاعدة / المستوى")}</th>
                  <th>{t("Total", "الإجمالي")}</th>
                  <th>{t("Decision", "القرار")}</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(data) &&
                  data.map((row: any) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.number}</strong>
                      </td>
                      <td>
                        {row.customer?.name || row.customer?.number || "—"}
                      </td>
                      <td>{row.requester_name}</td>
                      <td>
                        {row.rule_name} · {row.tier}
                      </td>
                      <td>SAR {row.totals?.total}</td>
                      <td>
                        <div className="actions">
                          <button
                            className="primary"
                            onClick={async () => {
                              await api(
                                `quotation-approvals/${row.id}/approve`,
                                "POST",
                                { comment: "" },
                              );
                              await load();
                            }}
                          >
                            {t("Approve", "موافقة")}
                          </button>
                          <button
                            className="danger"
                            onClick={async () => {
                              const comment = await showPrompt(
                                t(
                                  "Please provide a reason for rejecting this quotation:",
                                  "يرجى ذكر سبب رفض عرض السعر:",
                                ),
                                {
                                  title: t("Reject Quotation", "رفض عرض السعر"),
                                  confirmText: t("Reject", "رفض"),
                                  tone: "danger",
                                  placeholder: t("Rejection reason", "سبب الرفض"),
                                },
                              );
                              if (comment) {
                                await api(
                                  `quotation-approvals/${row.id}/reject`,
                                  "POST",
                                  { comment },
                                );
                                await load();
                              }
                            }}
                          >
                            {t("Reject", "رفض")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                {Array.isArray(data) && !data.length && (
                  <tr>
                    <td colSpan={6}>
                      {t(
                        "No quotations are waiting for your approval.",
                        "لا توجد عروض أسعار بانتظار موافقتك.",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!loading && section === "warehouses" && (
        <div className="commercial-grid">
          <div className="card compact-card">
            <div className="section-head">
              <h3>{t("Warehouses", "المستودعات")}</h3>
              <button className="primary" onClick={() => setEditing({})}>
                {t("Add warehouse", "إضافة مستودع")}
              </button>
            </div>
            <div className="dense-table-wrap">
              <table className="dense-table">
                <thead>
                  <tr>
                    <th>{t("Code", "الرمز")}</th>
                    <th>{t("Name", "الاسم")}</th>
                    <th>{t("Policy", "السياسة")}</th>
                    <th>{t("Pickup", "الاستلام")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data?.items?.map((w: any) => (
                    <tr key={w.id}>
                      <td>
                        <strong>{w.code}</strong>
                      </td>
                      <td>{w.name}</td>
                      <td>
                        {w.allow_negative_stock
                          ? t("Negative allowed", "يسمح بالسالب")
                          : t("Block negative", "منع السالب")}
                      </td>
                      <td>{w.pickup_enabled ? t("Enabled", "مفعّل") : "—"}</td>
                      <td>
                        <button onClick={() => setEditing(w)}>
                          {t("Edit", "تعديل")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {editing && (
            <form
              className="card compact-card compact-form"
              onSubmit={saveWarehouse}
            >
              <h3>
                {editing.id
                  ? t("Edit warehouse", "تعديل المستودع")
                  : t("New warehouse", "مستودع جديد")}
              </h3>
              <label>
                {t("Code", "الرمز")}
                <input name="code" defaultValue={editing.code} required />
              </label>
              <label>
                {t("Name", "الاسم")}
                <input name="name" defaultValue={editing.name} required />
              </label>
              <label>
                {t("Arabic name", "الاسم العربي")}
                <input name="nameAr" defaultValue={editing.name_ar} />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editing.active ?? true}
                />
                {t("Active", "نشط")}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="allowNegativeStock"
                  defaultChecked={editing.allow_negative_stock}
                />
                {t("Allow negative stock", "السماح بالمخزون السالب")}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="pickupEnabled"
                  defaultChecked={editing.pickup_enabled}
                />
                {t("Customer pickup location", "موقع استلام العملاء")}
              </label>
              <div className="actions">
                <button type="button" onClick={() => setEditing(null)}>
                  {t("Cancel", "إلغاء")}
                </button>
                <button className="primary">{t("Save", "حفظ")}</button>
              </div>
            </form>
          )}
        </div>
      )}
      {!loading && section === "stock" && (
        <div className="card compact-card">
          <h3>{t("Warehouse availability", "توفر المخزون")}</h3>
          <form
            className="actions"
            onSubmit={(e) => {
              e.preventDefault();
              setStockQuery(stockSearch);
              setStockPage(1);
            }}
          >
            <input
              aria-label={t(
                "Search all stock products",
                "بحث جميع منتجات المخزون",
              )}
              placeholder={t(
                "Search part number or description",
                "ابحث برقم الصنف أو الوصف",
              )}
              value={stockSearch}
              onChange={(e) => setStockSearch(e.target.value)}
            />
            <button>{t("Search", "بحث")}</button>
            <label>
              {t("Rows per page", "صفوف الصفحة")}
              <select
                value={stockSize}
                onChange={(e) => {
                  setStockSize(Number(e.target.value));
                  setStockPage(1);
                }}
              >
                <option>20</option>
                <option>50</option>
                <option>100</option>
              </select>
            </label>
          </form>
          <p>
            {data?.total || 0}{" "}
            {t("warehouse/product entries", "سجل مستودع / منتج")} ·{" "}
            {t("Page", "صفحة")} {data?.page || 1} / {data?.totalPages || 1}
          </p>
          <div className="dense-table-wrap">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>{t("Warehouse", "المستودع")}</th>
                  <th>{t("Part number", "رقم الصنف")}</th>
                  <th>{t("Description", "الوصف")}</th>
                  <th>{t("On hand", "المتاح فعلياً")}</th>
                  <th>{t("Reserved", "محجوز")}</th>
                  <th>{t("Available", "متاح للبيع")}</th>
                </tr>
              </thead>
              <tbody>
                {data?.items?.map((r: any) => (
                  <tr key={`${r.warehouse_id}-${r.product_id}`}>
                    <td>{r.warehouse_code}</td>
                    <td>
                      {user.permissions.includes("PRODUCT_VIEW") ? (
                        <button
                          onClick={async () => {
                            try {
                              setStockDetail(
                                await api(`products/${r.product_id}`),
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          {r.part_number}
                        </button>
                      ) : (
                        <strong>{r.part_number}</strong>
                      )}
                    </td>
                    <td style={{ whiteSpace: "normal", minWidth: 220 }}>
                      {r.description}
                    </td>
                    <td>{r.on_hand}</td>
                    <td>{r.reserved}</td>
                    <td>
                      <strong>{r.available}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button
              disabled={stockPage <= 1}
              onClick={() => setStockPage((p) => p - 1)}
            >
              {t("Previous", "السابق")}
            </button>
            <span>
              {data?.page || 1} / {data?.totalPages || 1}
            </span>
            <button
              disabled={stockPage >= (data?.totalPages || 1)}
              onClick={() => setStockPage((p) => p + 1)}
            >
              {t("Next", "التالي")}
            </button>
          </div>
          {stockDetail && (
            <section className="card">
              <div className="section-head">
                <h3>{stockDetail.partNumber}</h3>
                <button onClick={() => setStockDetail(undefined)}>
                  {t("Close details", "إغلاق التفاصيل")}
                </button>
              </div>
              <p>{stockDetail.description}</p>
              <p>
                {stockDetail.brand} · {stockDetail.category} ·{" "}
                {stockDetail.unit}
              </p>
              <ProductImageGallery productId={stockDetail.id} t={t} />
              <dl>
                {Object.entries(stockDetail.details || {}).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </section>
          )}
        </div>
      )}
      {!loading && section === "suppliers" && (
        <div className="commercial-grid">
          <div className="card compact-card">
            <div className="section-head">
              <h3>{t("Suppliers", "الموردون")}</h3>
              <button className="primary" onClick={() => setEditing({})}>
                {t("Add supplier", "إضافة مورد")}
              </button>
            </div>
            <div className="dense-table-wrap">
              <table className="dense-table">
                <thead>
                  <tr>
                    <th>{t("Code", "الرمز")}</th>
                    <th>{t("Supplier", "المورد")}</th>
                    <th>{t("Terms", "الشروط")}</th>
                    <th>{t("Lead time", "مدة التوريد")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data?.items?.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.code}</td>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.payment_terms || "—"}</td>
                      <td>
                        {s.lead_time_days} {t("days", "يوم")}
                      </td>
                      <td>
                        <button onClick={() => setEditing(s)}>
                          {t("Edit", "تعديل")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {editing && (
            <form
              className="card compact-card compact-form"
              onSubmit={saveSupplier}
            >
              <h3>
                {editing.id
                  ? t("Edit supplier", "تعديل المورد")
                  : t("New supplier", "مورد جديد")}
              </h3>
              <label>
                {t("Code", "الرمز")}
                <input name="code" defaultValue={editing.code} required />
              </label>
              <label>
                {t("Name", "الاسم")}
                <input name="name" defaultValue={editing.name} required />
              </label>
              <label>
                {t("Tax number", "الرقم الضريبي")}
                <input name="taxNumber" defaultValue={editing.tax_number} />
              </label>
              <label>
                {t("Payment terms", "شروط الدفع")}
                <input
                  name="paymentTerms"
                  defaultValue={editing.payment_terms}
                />
              </label>
              <div className="form-grid">
                <label>
                  {t("Currency", "العملة")}
                  <input
                    name="currency"
                    defaultValue={editing.currency || "SAR"}
                  />
                </label>
                <label>
                  {t("Lead-time days", "أيام التوريد")}
                  <input
                    name="leadTimeDays"
                    type="number"
                    min="0"
                    defaultValue={editing.lead_time_days || 0}
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editing.active ?? true}
                />
                {t("Active", "نشط")}
              </label>
              <div className="actions">
                <button type="button" onClick={() => setEditing(null)}>
                  {t("Cancel", "إلغاء")}
                </button>
                <button className="primary">{t("Save", "حفظ")}</button>
              </div>
            </form>
          )}
        </div>
      )}
      {section === "storefront" &&
        user.permissions.includes("STOREFRONT_MANAGE") && (
          <StorefrontAdmin t={t} user={user} navigate={setSection} />
        )}
      {!loading && ["orders", "purchasing"].includes(section) && (
        <CommercialLists
          section={section}
          data={data}
          t={t}
          reload={load}
          warehouseChoice={warehouseChoice}
          setWarehouseChoice={setWarehouseChoice}
        />
      )}
      {false && ["orders", "purchasing", "storefront"].includes(section) && (
        <div className="card compact-card empty-state">
          <h3>
            {section === "orders"
              ? t("Sales order workflow", "دورة أوامر البيع")
              : section === "purchasing"
                ? t("Purchase orders and receipts", "أوامر الشراء والاستلام")
                : t("B2B and retail storefront", "متجر الشركات والتجزئة")}
          </h3>
          <p>
            {t(
              "The secured data foundation is active. Operational document screens will appear here as their workflows are enabled.",
              "تم تفعيل أساس البيانات الآمن. ستظهر شاشات المستندات التشغيلية هنا عند تفعيل دوراتها.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
