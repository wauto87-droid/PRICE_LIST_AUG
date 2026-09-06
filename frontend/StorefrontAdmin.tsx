"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";
import CommerceConsole from "./CommerceConsole";
import ProductEditor, { blankProduct } from "./ProductEditor";
import CatalogOptionsSearch from "./CatalogOptionsSearch";
import CategorySeo from "./CategorySeo";
import BulkProductImages from "./BulkProductImages";
import WhatsAppAdmin from "./WhatsAppAdmin";
import StoreInventory from "./StoreInventory";

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
  const [optionProducts,setOptionProducts]=useState<any[]>([]);
  const addOptions=(rows:any[])=>setOptionProducts(current=>[...new Map([...current,...rows].map(p=>[p.id,p])).values()]);
  const [selected, setSelected] = useState<string[]>([]);
  const [versions,setVersions]=useState<Record<string,number>>({});
  const [offset,setOffset]=useState(0),[publication,setPublication]=useState("ALL");
  const queryParams=()=>`q=${encodeURIComponent(q)}&publication=${publication}`;
  async function selectAll(){setBusy(true);try{const r=await api(`storefront-admin/management?${queryParams()}&selection=true`);setSelected(r.products.map((p:any)=>p.id));setVersions(Object.fromEntries(r.products.map((p:any)=>[p.id,p.version])))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function publishSelected(published:boolean){setBusy(true);setError("");setNotice("");const failed:string[]=[];try{for(let i=0;i<selected.length;i+=100){const result=await api("storefront-admin/bulk-publish","PUT",{items:selected.slice(i,i+100).map(id=>({id,version:versions[id],published}))});for(const r of result.results)if(!r.ok)failed.push(`${r.id}: ${r.error}`)}setSelected([]);await load();setNotice(`${t("Updated","تم تحديث")}: ${selected.length-failed.length}`);if(failed.length)setError(failed.join("; "))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const can = (p: string) => user?.permissions?.includes(p);
  const [data, setData] = useState<any>(),
    [tab, setTab] = useState("overview"),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function load(nextOffset=offset) {
    try {
      const result=await api(`storefront-admin/management?${queryParams()}&offset=${nextOffset}`);
      setData(result);setOffset(nextOffset);addOptions(result.products);
      setVersions(previous=>({...previous,...Object.fromEntries(result.products.filter((p:any)=>!selected.includes(p.id)).map((p:any)=>[p.id,p.version]))}));
      setError("");
    } catch(e){setError((e as Error).message)}
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
          ["overview", "Overview", "نظرة عامة"],
          ["homepage", "Homepage", "الصفحة الرئيسية"],
          ["customers", "Companies", "الشركات"],
          ["pricing", "Company prices", "أسعار الشركات"],
          ["quotes", "Requirements & quotes", "المتطلبات والعروض"],
          ["orders", "Orders & payments", "الطلبات والمدفوعات"],
          ["returns", "Returns & refunds", "المرتجعات والمبالغ المستردة"],
          ["promotions", "Promotions", "العروض"],
          ["settings", "Store settings", "إعدادات المتجر"],
          ...(can("SETTINGS_MANAGE") ? [["whatsapp", "WhatsApp OTP", "واتساب والتحقق"]] : []),
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
      <div className="actions">
        {can("INVENTORY_VIEW") && (
          <button onClick={() => setTab("inventory")}>
            {t("Inventory & stock", "المخزون والأرصدة")}
          </button>
        )}
        {can("INVENTORY_MANAGE") && (
          <button onClick={() => navigate("warehouses")}>
            {t("Warehouses", "المستودعات")}
          </button>
        )}
        {can("SALES_ORDER_MANAGE") && (
          <button onClick={() => navigate("orders")}>
            {t("Fulfillment & deliveries", "التنفيذ والتسليم")}
          </button>
        )}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <button onClick={() => load()}>{t("Load management", "تحميل الإدارة")}</button>
      ) : (
        <>
          {["homepage","pricing","quotes","promotions","inventory"].includes(tab) && <CatalogOptionsSearch t={t} onResults={addOptions}/>}
          {[
            "overview",
            "homepage",
            "customers",
            "pricing",
            "quotes",
            "orders",
            "returns",
            "promotions",
          ].includes(tab) && (
            <CommerceConsole
              tab={tab}
              t={t}
              products={optionProducts}
              user={user}
            />
          )}
          {tab === "homepage" && <CategorySeo t={t}/>}
          {tab === "inventory" && (
            <StoreInventory t={t} products={optionProducts} user={user} />
          )}
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
                  businessEnabled: f.has("businessEnabled"),
                  operationsEnabled: f.has("operationsEnabled"),
                  bankTransferEnabled:f.has('bankTransferEnabled'),bankInstructions:String(f.get('bankInstructions')||''),
                  onlineHoldMinutes: Number(f.get("onlineHoldMinutes")),
                  bankHoldMinutes: Number(f.get("bankHoldMinutes")),
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
                <label><input type="checkbox" name="bankTransferEnabled" defaultChecked={data.settings.data.bankTransferEnabled!==false}/>{t('Enable reviewed bank transfers','تفعيل التحويل البنكي بعد المراجعة')}</label><label>{t('Bank payment instructions (beneficiary, bank, IBAN)','تعليمات التحويل (المستفيد، البنك، الآيبان)')}<textarea name="bankInstructions" defaultValue={data.settings.data.bankInstructions||''}/></label>
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
              <div className="form-grid">
                <label>
                  <input
                    name="businessEnabled"
                    type="checkbox"
                    defaultChecked={data.settings.data.businessEnabled}
                  />
                  {t(
                    "Enable company portal and requests",
                    "تفعيل بوابة الشركات والطلبات",
                  )}
                </label>
                <label>
                  <input
                    name="operationsEnabled"
                    type="checkbox"
                    defaultChecked={data.settings.data.operationsEnabled}
                  />
                  {t(
                    "Enable payment operations and returns",
                    "تفعيل عمليات الدفع والمرتجعات",
                  )}
                </label>
                <label>
                  {t(
                    "Online payment hold (minutes)",
                    "حجز الدفع الإلكتروني (دقائق)",
                  )}
                  <input
                    type="number"
                    min="5"
                    max="120"
                    name="onlineHoldMinutes"
                    defaultValue={data.settings.data.onlineHoldMinutes || 15}
                  />
                </label>
                <label>
                  {t(
                    "Bank review hold (minutes)",
                    "حجز مراجعة التحويل (دقائق)",
                  )}
                  <input
                    type="number"
                    min="30"
                    max="10080"
                    name="bankHoldMinutes"
                    defaultValue={data.settings.data.bankHoldMinutes || 1440}
                  />
                </label>
              </div>
              <button className="primary" disabled={busy}>
                {t("Save store settings", "حفظ إعدادات المتجر")}
              </button>
            </form>
          )}
          {tab === "whatsapp" && can("SETTINGS_MANAGE") && <WhatsAppAdmin t={t}/>}
          {tab === "products" && (
            <>
              {can("PRODUCT_EDIT") && <BulkProductImages t={t}/>}
              <div className="actions">
                {can("PRODUCT_CREATE") && can("COST_VIEW") && (
                  <button
                    className="primary"
                    onClick={() => setEdit({ ...blankProduct,vat:data.defaultVat })}
                  >
                    {t("Add product", "إضافة منتج")}
                  </button>
                )}
                {can("IMPORT_EXCEL") && (
                  <a href={appPath("/") + "?commerce=imports"}>
                    {t("Bulk import workspace", "مساحة الاستيراد الجماعي")}
                  </a>
                )}
                <button type="button" disabled={busy} onClick={() => setSelected(v=>[...new Set([...v,...data.products.map((p:any)=>p.id)])])}>{t("Select page", "تحديد الصفحة")}</button>
                <button type="button" disabled={busy} onClick={selectAll}>{t("Select all matching", "تحديد كل النتائج")}</button>
                <button type="button" disabled={busy} onClick={() => setSelected([])}>{t("Clear selection", "إلغاء التحديد")}</button>
                <span>{t("Selected", "المحدد")}: {selected.length}</span>
                <button type="button" disabled={busy || !selected.length} onClick={()=>publishSelected(true)}>{t("Publish selected", "نشر المحدد")}</button>
                <button type="button" disabled={busy || !selected.length} onClick={()=>publishSelected(false)}>{t("Unpublish selected", "إلغاء نشر المحدد")}</button>
              </div>
              <form
                className="actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSelected([]);load(0);
                }}
              >
                <select aria-label={t("Publication filter", "تصفية النشر")} value={publication} onChange={e=>setPublication(e.target.value)}>{[["ALL","All products","كل المنتجات"],["PUBLISHED","Published","منشور"],["UNPUBLISHED","Unpublished","غير منشور"],["INACTIVE","Inactive","غير نشط"],["MISSING_IMAGE","Missing image","بدون صورة"],["MISSING_PRICE","Missing public price","بدون سعر عام"]].map(([value,en,ar])=><option key={value} value={value}>{t(en,ar)}</option>)}</select>
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
                  "Unpriced products can be published for quotation requests. Only priced, available quantities can be purchased.",
                  "يمكن نشر المنتجات بدون أسعار لطلب عروض الأسعار. الشراء للكميات المتاحة والمسعّرة فقط.",
                )}
              </p>
              <div className="actions"><button disabled={busy||offset===0} onClick={()=>load(Math.max(0,offset-100))}>{t("Previous","السابق")}</button><span>{offset+1}–{offset+data.products.length} / {data.total}</span><button disabled={busy||offset+100>=data.total} onClick={()=>load(offset+100)}>{t("Next","التالي")}</button></div>
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
                          <input
                            type="checkbox"
                            aria-label={
                              t("Select product", "اختيار المنتج") +
                              " " +
                              p.part_number
                            }
                            checked={selected.includes(p.id)}
                            onChange={(e) =>
                              setSelected((v) =>
                                e.target.checked
                                  ? [...v, p.id]
                                  : v.filter((id) => id !== p.id),
                              )
                            }
                          />
                          <strong>{p.part_number}</strong>
                          <div>{p.description}</div>
                          <details>
                            <summary>
                              {t(
                                "Store description & SEO",
                                "وصف المتجر وتحسين البحث",
                              )}
                            </summary>
                            <form
                              className="form-grid"
                              onSubmit={(e) => {
                                e.preventDefault();
                                const f = new FormData(e.currentTarget);
                                save("storefront-admin/products/" + p.id, {
                                  published: p.storefront_published,
                                  version: p.version,
                                  slug: f.get("slug") || undefined,
                                  content: {
                                    description: f.get("description") || "",
                                    seoTitle: f.get("seoTitle") || "",
                                    seoDescription:
                                      f.get("seoDescription") || "",
                                  },
                                });
                              }}
                            >
                              <label>
                                {t("Product URL slug", "عنوان رابط المنتج")}
                                <input
                                  name="slug"
                                  defaultValue={p.storefront_slug || ""}
                                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                                />
                              </label>
                              <label>
                                {t("Store description", "وصف المتجر")}
                                <textarea
                                  name="description"
                                  defaultValue={
                                    p.storefront_content?.description || ""
                                  }
                                />
                              </label>
                              <label>
                                {t("Search engine title", "عنوان محرك البحث")}
                                <input
                                  name="seoTitle"
                                  defaultValue={
                                    p.storefront_content?.seoTitle || ""
                                  }
                                />
                              </label>
                              <label>
                                {t(
                                  "Search engine description",
                                  "وصف محرك البحث",
                                )}
                                <textarea
                                  name="seoDescription"
                                  defaultValue={
                                    p.storefront_content?.seoDescription || ""
                                  }
                                />
                              </label>
                              <button disabled={busy}>
                                {t("Save content", "حفظ المحتوى")}
                              </button>
                            </form>
                          </details>
                          {can("PRODUCT_EDIT") && can("COST_VIEW") && (
                            <button
                              onClick={async () => {
                                try {
                                  const r = await api("products/" + p.id);
                                  setEdit({
                                    ...r,
                                    partNumber: r.part_number || r.partNumber,
                                  });
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            >
                              {t(
                                "Edit product / images / price",
                                "تعديل المنتج / الصور / السعر",
                              )}
                            </button>
                          )}
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
      {edit && (
        <ProductEditor
          t={t}
          initial={edit}
          actionBusy={busy}
          onClose={() => setEdit(undefined)}
          onSave={async (p) => {
            setBusy(true);
            try {
              await api(
                "products" + (edit.id ? "/" + edit.id : ""),
                edit.id ? "PUT" : "POST",
                p,
              );
              setEdit(undefined);
              await load();
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
