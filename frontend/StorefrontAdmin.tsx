"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";

export default function StorefrontAdmin({ t }: { t: Translate }) {
  const [data, setData] = useState<any>(),
    [tab, setTab] = useState("settings"),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function load() {
    try {
      setData(
        await api(`storefront-admin/management?q=${encodeURIComponent(q)}`),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function save(path: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, "PUT", body);
      await load();
      setNotice(t("Saved", "تم الحفظ"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="card"
      aria-label={t("Store management", "إدارة المتجر")}
    >
      <div className="section-head">
        <div>
          <h2>{t("Store management", "إدارة المتجر")}</h2>
          <p>
            {t(
              "Open your store, publish products and manage customer access.",
              "افتح متجرك وانشر المنتجات وأدر حسابات العملاء.",
            )}
          </p>
        </div>
        <a href={appPath("/store")} target="_blank" rel="noreferrer">
          {t("Open storefront ↗", "فتح المتجر ↗")}
        </a>
      </div>
      <div className="actions">
        {[
          ["settings", "Store settings", "إعدادات المتجر"],
          ["products", "Products", "المنتجات"],
          ["zones", "Delivery zones", "مناطق التوصيل"],
          ["accounts", "Business accounts", "حسابات الشركات"],
        ].map(([key, en, ar]) => (
          <button
            key={key}
            className={tab === key ? "primary" : ""}
            onClick={() => setTab(key)}
          >
            {t(en, ar)}
          </button>
        ))}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <button onClick={load}>{t("Load management", "تحميل الإدارة")}</button>
      ) : (
        <>
          {tab === "settings" && (
            <form
              key={data.settings.version}
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
                });
              }}
            >
              <p className="notice">
                {data.settings.enabled
                  ? t(
                      "Your store is open. Only published products appear.",
                      "المتجر مفتوح. تظهر المنتجات المنشورة فقط.",
                    )
                  : t(
                      "Your store is closed. Enable it below, then publish products in Products.",
                      "المتجر مغلق. فعّله أدناه ثم انشر المنتجات.",
                    )}
              </p>
              <label>
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={data.settings.enabled}
                />{" "}
                {t("Store is open", "المتجر مفتوح")}
              </label>
              <div className="form-grid">
                {[
                  ["companyName", "Company name", "اسم الشركة"],
                  [
                    "companyNameAr",
                    "Arabic company name",
                    "اسم الشركة بالعربية",
                  ],
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
              <label>
                <input
                  type="checkbox"
                  name="deliveryEnabled"
                  defaultChecked={data.settings.data.deliveryEnabled !== false}
                />{" "}
                {t(
                  "Enable delivery (configure zones below)",
                  "تفعيل التوصيل (حدد المناطق)",
                )}
              </label>
              <label>
                <input
                  type="checkbox"
                  name="pickupEnabled"
                  defaultChecked={data.settings.data.pickupEnabled !== false}
                />{" "}
                {t(
                  "Enable pickup (configure pickup branches in Warehouses)",
                  "تفعيل الاستلام (حدد الفروع في المستودعات)",
                )}
              </label>
              <p>
                {t(
                  "Card payments and verification require server provider configuration.",
                  "الدفع بالبطاقة والتحقق يتطلبان إعداد المزود على الخادم.",
                )}
              </p>
              <button className="primary" disabled={busy}>
                {t("Save store settings", "حفظ إعدادات المتجر")}
              </button>
            </form>
          )}
          {tab === "products" && (
            <>
              <form
                className="actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  load();
                }}
              >
                <input
                  aria-label={t("Find products", "بحث المنتجات")}
                  placeholder={t(
                    "Part number or description",
                    "رقم الصنف أو الوصف",
                  )}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <button>{t("Search", "بحث")}</button>
              </form>
              <p>
                {t(
                  "Showing up to 100 matches. Search to find more products. Publication requires an active product and selling level.",
                  "عرض حتى 100 نتيجة. ابحث للوصول لمنتجات أخرى. النشر يتطلب منتجاً نشطاً ومستوى بيع.",
                )}
              </p>
              <div className="dense-table-wrap">
                <table className="dense-table">
                  <thead>
                    <tr>
                      <th>{t("Product", "المنتج")}</th>
                      <th>{t("Store visibility", "ظهور المنتج")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((p: any) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.part_number}</strong>
                          <div>{p.description}</div>
                        </td>
                        <td>
                          <button
                            disabled={
                              busy || (!p.active && !p.storefront_published)
                            }
                            onClick={() =>
                              save(`storefront-admin/products/${p.id}`, {
                                published: !p.storefront_published,
                                version: p.version,
                              })
                            }
                          >
                            {p.storefront_published
                              ? t(
                                  "Published · Unpublish",
                                  "منشور · إلغاء النشر",
                                )
                              : t("Publish to store", "نشر في المتجر")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "zones" && (
            <>
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
                  className="form-grid"
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
                    {t(
                      "Free above subtotal (optional)",
                      "توصيل مجاني فوق (اختياري)",
                    )}
                    <input
                      name="freeAbove"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={
                        zone.free_above === null ? "" : Number(zone.free_above)
                      }
                    />
                  </label>
                  <label>
                    <input
                      name="active"
                      type="checkbox"
                      defaultChecked={zone.active}
                    />
                    {t("Active", "نشط")}
                  </label>
                  <button disabled={busy}>
                    {zone.id === "new"
                      ? t("Add zone", "إضافة منطقة")
                      : t("Save zone", "حفظ المنطقة")}
                  </button>
                </form>
              ))}
            </>
          )}
          {tab === "accounts" && (
            <>
              {!data.accounts.length && (
                <p>
                  {t(
                    "No business account applications yet.",
                    "لا توجد طلبات حسابات شركات.",
                  )}
                </p>
              )}
              {data.accounts.map((a: any) => (
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
                  <strong>
                    {a.name} · {a.email}
                  </strong>
                  <p>{a.mobile}</p>
                  <div className="form-grid">
                    <label>
                      {t("Status", "الحالة")}
                      <select name="status" defaultValue={a.status}>
                        <option value="PENDING">
                          {t("Pending approval", "بانتظار الموافقة")}
                        </option>
                        <option value="ACTIVE">{t("Active", "نشط")}</option>
                        <option value="BLOCKED">{t("Blocked", "محظور")}</option>
                      </select>
                    </label>
                    <label>
                      {t("Price level", "مستوى السعر")}
                      <select
                        name="priceLevel"
                        defaultValue={a.price_level || ""}
                      >
                        <option value="">
                          {t("Default retail", "تجزئة افتراضي")}
                        </option>
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
                    <label>
                      <input
                        name="creditEnabled"
                        type="checkbox"
                        defaultChecked={a.credit_enabled}
                      />
                      {t("Enable credit terms", "تفعيل الائتمان")}
                    </label>
                  </div>
                  <button disabled={busy}>
                    {t("Save account", "حفظ الحساب")}
                  </button>
                </form>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
