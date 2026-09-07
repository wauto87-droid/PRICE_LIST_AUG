"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";
import RequirementMatcher from './RequirementMatcher';

function Field({
  label,
  name,
  value = "",
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  value?: any;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        required={required}
        step={type === "number" ? "0.01" : undefined}
      />
    </label>
  );
}
const val = (f: FormData, k: string) => String(f.get(k) || "");
const utc = (v: string) => (v ? new Date(v+"+03:00").toISOString() : null);
const local = (v: any) =>
  v
    ? new Date(new Date(v).getTime() + 3 * 60 * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
export default function CommerceConsole({
  tab,
  t,
  products: initialProducts,
  user,
}: {
  tab: string;
  t: Translate;
  products: any[];
  user: any;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<any>(),
    [preview, setPreview] = useState(false);
  const [extraProducts,setExtraProducts]=useState<any[]>([]);
  const products=[...new Map([...initialProducts,...extraProducts].map(p=>[p.id,p])).values()];
  useEffect(()=>{if(edit?.data?.productIds?.length)api('storefront-admin/catalog-options','POST',{ids:edit.data.productIds}).then(r=>setExtraProducts(r.products)).catch(e=>setError(e.message))},[edit?.id,edit?.kind]);
  const can = (p: string) => user?.permissions?.includes(p);
  async function load() {
    try {
      setData(await api("storefront-admin/commerce"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    setEdit(undefined);
  }, [tab]);
  async function save(path: string, body: any, method = "PUT") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("storefront-admin/" + path, method, body);
      await load();
      setNotice(t("Saved successfully", "تم الحفظ بنجاح"));
      return result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function media(file: File, key: string) {
    setBusy(true);
    try {
      const response = await fetch(appPath("/api/v1/storefront-admin/media"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": (globalThis as any).amtCsrf || "" },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Upload failed");
      setEdit((e: any) => ({ ...e, data: { ...e.data, [key]: result.url } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const productSelect = (name = "productId", value = "") => (
    <select name={name} defaultValue={value} required>
      <option value="">{t("Choose product", "اختر المنتج")}</option>
      {value && !products.some(p=>p.id===value) && <option value={value}>{t("Current product", "المنتج الحالي")}</option>}
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.part_number} · {p.description}
        </option>
      ))}
    </select>
  );
  if (!data)
    return <div><p role={error ? "alert" : "status"}>{error || t("Loading management…", "جارٍ تحميل الإدارة…")}</p>{error && <button onClick={() => void load()}>{t("Try again", "حاول مرة أخرى")}</button>}</div>;
  return (
    <div className="commerce-console">
      {tab==='quotes'&&data.requests.filter((r:any)=>!r.quotation_id&&['SUBMITTED','REVIEW'].includes(r.status)).map((r:any)=><RequirementMatcher key={r.id+':'+r.version} request={r} products={products} t={t} save={save} busy={busy}/>)}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {tab === "overview" && data.lowStock.length > 0 && (
        <section className="card">
          <h3>{t("Low stock", "مخزون منخفض")}</h3>
          {data.lowStock.map((s: any, i: number) => (
            <p key={i}>
              {s.part_number} · {s.warehouse}: {s.available} / {s.minimum}
            </p>
          ))}
        </section>
      )}
      {["customers", "quotes"].includes(tab) && data.attachments.length > 0 && (
        <details>
          <summary>
            {t(
              "Supporting documents and requirements files",
              "المستندات الداعمة وملفات المتطلبات",
            )}
          </summary>
          {data.attachments
            .filter((a: any) =>
              tab === "customers" ? !a.request_id : !!a.request_id,
            )
            .map((a: any) => (
              <p key={a.id}>
                {data.companies.find((c: any) => c.id === a.company_id)?.name} ·{" "}
                {data.requests.find((r: any) => r.id === a.request_id)?.number}{" "}
                ·{" "}
                <a
                  href={appPath("/api/v1/storefront-admin/attachments/" + a.id)}
                >
                  {a.name}
                </a>
              </p>
            ))}
        </details>
      )}
      {tab === "returns" && (
        <>
          {data.returns.length === 0 && (
            <p>{t("No returns requested.", "لا توجد طلبات إرجاع.")}</p>
          )}
          {data.returns.map((r: any) => (
            <form
              className="card"
              key={r.id + ":" + r.version}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save("returns/" + r.id, {
                  version: r.version,
                  action: val(f, "action"),
                  inspection: val(f, "inspection"),
                  restock: f.has("restock"),
                  amount: val(f, "amount") || "0",
                  reference: val(f, "reference"),
                });
              }}
            >
              <h3>
                {r.order_number} · {r.status}
              </h3>
              <p>{r.reason}</p>
              <p>
                {r.lines
                  .map(
                    (l: any) =>
                      l.quantity +
                      " × " +
                      (products.find((p) => p.id === l.productId)
                        ?.part_number || l.productId),
                  )
                  .join(", ")}
              </p>
              <div className="form-grid">
                <label>
                  {t("Next action", "الإجراء التالي")}
                  <select name="action">
                    {(r.status === "REQUESTED"
                      ? ["APPROVED", "REJECTED"]
                      : r.status === "APPROVED"
                        ? ["INSPECTED"]
                        : r.status === "INSPECTED"
                          ? ["REFUNDED"]
                          : []
                    ).map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <Field
                  name="inspection"
                  label={t(
                    "Decision / inspection notes",
                    "ملاحظات القرار / الفحص",
                  )}
                  value={r.inspection}
                />
                {can("INVENTORY_MANAGE") && (
                  <label>
                    <input type="checkbox" name="restock" />
                    {t(
                      "Inspection passed: restock returned items",
                      "اجتاز الفحص: إعادة المنتجات إلى المخزون",
                    )}
                  </label>
                )}
                <Field
                  name="amount"
                  type="number"
                  label={t("Refund amount (SAR)", "المبلغ المسترد")}
                  value={r.refund_amount || ""}
                />
                <Field
                  name="reference"
                  label={t(
                    "Verified bank refund reference",
                    "مرجع الاسترداد البنكي المؤكد",
                  )}
                  value={r.refund_reference}
                />
              </div>
              <p>
                {t(
                  "For card payments, refund in Moyasar first. This action verifies the provider refund before recording it.",
                  "للدفع بالبطاقة، نفّذ الاسترداد في Moyasar أولاً. يتحقق هذا الإجراء من الاسترداد لدى المزود قبل تسجيله.",
                )}
              </p>
              {!["REFUNDED", "REJECTED"].includes(r.status) && (
                <button disabled={busy}>
                  {t("Update return", "تحديث الإرجاع")}
                </button>
              )}
            </form>
          ))}
        </>
      )}
      {tab === "overview" && (
        <>
          <div className="commerce-metrics">
            {[
              [
                t("Confirmed sales (SAR)", "المبيعات المؤكدة"),
                data.summary.sales,
              ],
              [
                t("Pending quotes", "عروض قيد الانتظار"),
                data.summary.pending_quotes,
              ],
              [
                t("Company balances (SAR)", "أرصدة الشركات"),
                data.summary.credit_used,
              ],
            ].map(([label, value]) => (
              <article className="card" key={label}>
                <small>{label}</small>
                <h2>{value}</h2>
              </article>
            ))}
          </div>
          <h3>{t("Searches with no results", "عمليات بحث بدون نتائج")}</h3>
          {data.searches.map((s: any) => (
            <p key={s.query}>
              {s.query} · {s.count}
            </p>
          ))}
          <h3>{t("Notification queue", "قائمة الإشعارات")}</h3>
          {data.notifications.map((n: any) => (
            <div className="card" key={n.id}>
              {n.message}
              <p>
                {n.status} {n.error}
              </p>
              {n.status === "FAILED" && (
                <button
                  disabled={busy}
                  onClick={() => save("notifications/" + n.id, {})}
                >
                  {t("Retry delivery", "إعادة الإرسال")}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {["homepage", "promotions"].includes(tab) && (
        <>
          <p>
            {t(
              "Create a draft, preview it, then publish. Schedule dates use Riyadh time (UTC+3).",
              "أنشئ مسودة وعاينها ثم انشرها. أوقات الجدولة بتوقيت الرياض (UTC+3).",
            )}
          </p>
          <div className="actions">
            {(tab === "homepage"
              ? ["BANNER", "SECTION"]
              : ["OFFER", "COUPON"]
            ).map((kind) => (
              <button
                key={kind}
                onClick={() => {
                  setEdit({
                    kind,
                    title: "",
                    status: "DRAFT",
                    audience: "ALL",
                    position: 0,
                    data: {
                      productIds: [],
                      names: [],
                      sectionType: "PRODUCTS",
                      discount: "0",
                    },
                  });
                  setPreview(false);
                }}
              >
                {t("Add", "إضافة")} {kind}
              </button>
            ))}
          </div>
          {data.campaigns
            .filter((c: any) =>
              tab === "homepage"
                ? ["BANNER", "SECTION"].includes(c.kind)
                : ["OFFER", "COUPON"].includes(c.kind),
            )
            .map((c: any) => (
              <div className="card commerce-row" key={c.id}>
                <div>
                  <strong>{c.title}</strong>
                  <p>
                    {c.kind} · {c.status} · {c.audience} · #{c.position}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEdit(c);
                    setPreview(false);
                  }}
                >
                  {t("Edit / preview", "تعديل / معاينة")}
                </button>
              </div>
            ))}
          {edit && (
            <form
              key={edit.id || edit.kind}
              className="card"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const result = await save("campaigns", {
                  id: edit.id,
                  version: edit.version,
                  kind: edit.kind,
                  title: val(f, "title"),
                  status: val(f, "status"),
                  audience: val(f, "audience"),
                  position: Number(f.get("position")),
                  startsAt: utc(val(f, "startsAt")),
                  endsAt: utc(val(f, "endsAt")),
                  data: {
                    ...edit.data,
                    titleAr: val(f, "titleAr"),
                    text: val(f, "text"),
                    textAr: val(f, "textAr"),
                    link: val(f, "link"),
                    button: val(f, "button") || "Shop now",
                    buttonAr: val(f, "buttonAr") || "تسوق الآن",
                    productIds: f.getAll("productIds"),
                    names: val(f, "names")
                      .split("\n")
                      .map((v) => v.trim())
                      .filter(Boolean),
                    sectionType: val(f, "sectionType") || "PRODUCTS",
                    code: val(f, "code"),
                    discount: val(f, "discount") || "0",
                    usageLimit: val(f, "usageLimit")
                      ? Number(f.get("usageLimit"))
                      : null,
                  },
                });
                if (result) setEdit(result);
              }}
            >
              <h3>
                {t("Campaign editor", "محرر الحملات")} · {edit.kind}
              </h3>
              <div className="form-grid">
                <Field
                  label={t("Title", "العنوان")}
                  name="title"
                  value={edit.title}
                  required
                />
                <Field
                  label={t("Arabic title", "العنوان العربي")}
                  name="titleAr"
                  value={edit.data.titleAr}
                />
                <label>
                  {t("Status", "الحالة")}
                  <select name="status" defaultValue={edit.status}>
                    <option>DRAFT</option>
                    <option>PUBLISHED</option>
                    <option>DISABLED</option>
                  </select>
                </label>
                <label>
                  {t("Audience", "الجمهور")}
                  <select name="audience" defaultValue={edit.audience}>
                    <option>ALL</option>
                    <option>RETAIL</option>
                    <option>BUSINESS</option>
                  </select>
                </label>
                <Field
                  label={t("Display order", "ترتيب العرض")}
                  name="position"
                  type="number"
                  value={edit.position}
                />
                <Field
                  label={t("Start", "البداية")}
                  name="startsAt"
                  type="datetime-local"
                  value={local(edit.starts_at)}
                />
                <Field
                  label={t("End", "النهاية")}
                  name="endsAt"
                  type="datetime-local"
                  value={local(edit.ends_at)}
                />
              </div>
              {edit.kind === "BANNER" && (
                <>
                  <div className="form-grid">
                    <Field
                      label={t("Text", "النص")}
                      name="text"
                      value={edit.data.text}
                    />
                    <Field
                      label={t("Arabic text", "النص العربي")}
                      name="textAr"
                      value={edit.data.textAr}
                    />
                    <Field
                      label={t("Button label", "نص الزر")}
                      name="button"
                      value={edit.data.button}
                    />
                    <Field
                      label={t("Arabic button", "الزر بالعربية")}
                      name="buttonAr"
                      value={edit.data.buttonAr}
                    />
                    <Field
                      label={t("Store link", "رابط المتجر")}
                      name="link"
                      value={edit.data.link}
                    />
                    {["image", "mobileImage"].map((key) => (
                      <label key={key}>
                        {key === "image"
                          ? t("Desktop image", "صورة سطح المكتب")
                          : t("Mobile image", "صورة الجوال")}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            if (e.target.files?.[0])
                              media(e.target.files[0], key);
                          }}
                        />
                        {edit.data[key] && (
                          <img
                            className="commerce-thumb"
                            src={edit.data[key]}
                            alt=""
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  <button type="button" onClick={(e) => {const form=e.currentTarget.form;if(form){const f=new FormData(form);setEdit((v:any)=>({...v,title:val(f,'title'),data:{...v.data,text:val(f,'text'),titleAr:val(f,'titleAr'),textAr:val(f,'textAr'),button:val(f,'button')}}))}setPreview(!preview)}}>
                    {t(
                      "Preview banner",
                      "معاينة الإعلان",
                    )}
                  </button>
                  {preview && (
                    <div className="commerce-banner-preview">
                      {edit.data.image && <img src={edit.data.image} alt="" />}
                      <h2>{edit.title}</h2>
                      <p>{edit.data.text}</p>
                      <span>{edit.data.button}</span>
                    </div>
                  )}
                </>
              )}
              {edit.kind === "SECTION" && (
                <>
                  <label>
                    {t("Section type", "نوع القسم")}
                    <select
                      name="sectionType"
                      defaultValue={edit.data.sectionType}
                    >
                      {[
                        "PRODUCTS",
                        "CATEGORIES",
                        "BRANDS",
                        "NEW",
                        "BESTSELLERS",
                        "OFFERS",
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t(
                      "Category or brand names, one per line",
                      "أسماء الفئات أو العلامات، اسم بكل سطر",
                    )}
                    <textarea
                      name="names"
                      defaultValue={edit.data.names?.join("\n")}
                    />
                  </label>
                </>
              )}
              {edit.kind !== "BANNER" && (
                <label>
                  {t(
                    "Selected products (hold Ctrl to select several)",
                    "المنتجات المختارة (Ctrl لاختيار عدة منتجات)",
                  )}
                  <select
                    name="productIds"
                    multiple
                    value={edit.data.productIds || []}
                    onChange={e=>setEdit((current:any)=>({...current,data:{...current.data,productIds:Array.from(e.target.selectedOptions,o=>o.value)}}))}
                    size={8}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.part_number} · {p.description}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {["OFFER", "COUPON"].includes(edit.kind) && (
                <div className="form-grid">
                  <Field
                    label={t("Discount %", "نسبة الخصم")}
                    name="discount"
                    type="number"
                    value={edit.data.discount}
                  />
                  {edit.kind === "COUPON" && (
                    <>
                      <Field
                        label={t("Coupon code", "رمز القسيمة")}
                        name="code"
                        value={edit.data.code}
                        required
                      />
                      <Field
                        label={t(
                          "Maximum uses (blank = unlimited)",
                          "عدد الاستخدامات (فارغ = بلا حد)",
                        )}
                        name="usageLimit"
                        type="number"
                        value={edit.data.usageLimit}
                      />
                    </>
                  )}
                </div>
              )}
              <div className="actions">
                <button className="primary" disabled={busy}>
                  {t("Save campaign", "حفظ الحملة")}
                </button>
                <button type="button" onClick={() => setEdit(undefined)}>
                  {t("Close", "إغلاق")}
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {tab === "customers" && (
        <>
          {data.companies.map((c: any) => (
            <form
              className="card"
              key={c.id + ":" + c.version}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save("company/" + c.id, {
                  version: c.version,
                  status: val(f, "status"),
                  reviewNote: val(f, "reviewNote"),
                  priceListId: val(f, "priceListId") || null,
                  priceLevel: val(f, "priceLevel") || null,
                  creditEnabled: f.has("creditEnabled"),
                  creditLimit: val(f, "creditLimit") || "0",
                });
              }}
            >
              <h3>{c.name}</h3>
              <p>
                {c.profile.registrationNumber} · {c.profile.taxNumber} ·{" "}
                {c.profile.contactPerson}
              </p>
              <p>{c.profile.address}</p>
              {c.profile.needsReview && (
                <p className="notice">
                  {t(
                    "Legacy profile: verify company documents.",
                    "ملف سابق: تحقق من مستندات الشركة.",
                  )}
                </p>
              )}
              <p>
                {t("Credit used", "الائتمان المستخدم")}: SAR {c.credit_used}
              </p>
              <div className="form-grid">
                <label>
                  {t("Status", "الحالة")}
                  <select name="status" defaultValue={c.status}>
                    {["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <Field
                  label={t("Decision reason", "سبب القرار")}
                  name="reviewNote"
                  value={c.review_note}
                />
                <label>
                  {t("Price list", "قائمة الأسعار")}
                  <select
                    name="priceListId"
                    defaultValue={c.price_list_id || ""}
                  >
                    <option value="">{t("None", "بدون")}</option>
                    {data.priceLists.map((l: any) => (
                      <option value={l.id} key={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Existing selling level", "مستوى البيع الحالي")}
                  <select name="priceLevel" defaultValue={c.price_level || ""}>
                    <option value="">
                      {t("Public retail", "التجزئة العامة")}
                    </option>
                    {["WHOLESALE", "RETAIL", "END_CUSTOMER"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <Field
                  label={t("Credit limit (SAR)", "حد الائتمان")}
                  name="creditLimit"
                  type="number"
                  value={c.credit_limit}
                />
                <label>
                  <input
                    type="checkbox"
                    name="creditEnabled"
                    defaultChecked={c.credit_enabled}
                  />
                  {t("Enable credit", "تفعيل الائتمان")}
                </label>
              </div>
              <button disabled={busy}>{t("Save company", "حفظ الشركة")}</button>
            </form>
          ))}
        </>
      )}
      {tab === "pricing" && (
        <>
          <form
            className="actions"
            onSubmit={(e) => {
              e.preventDefault();
              save(
                "price-lists",
                { name: val(new FormData(e.currentTarget), "name") },
                "POST",
              );
            }}
          >
            <Field
              label={t("New price list", "قائمة أسعار جديدة")}
              name="name"
              required
            />
            <button disabled={busy}>{t("Create list", "إنشاء القائمة")}</button>
          </form>
          <details><summary>{t('Manage price lists','إدارة قوائم الأسعار')}</summary>{data.priceLists.map((l:any)=><form className="actions" key={l.id+':'+l.version} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save('price-lists/'+l.id,{version:l.version,name:val(f,'name'),active:f.has('active')})}}><Field name="name" label={t('List name','اسم القائمة')} value={l.name}/><label><input type="checkbox" name="active" defaultChecked={l.active}/>{t('Active','نشطة')}</label><button disabled={busy}>{t('Save list','حفظ القائمة')}</button></form>)}</details>
          {can("PRODUCT_EDIT") && (
            <form
              className="card"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save("prices", {
                  companyId: val(f, "companyId") || null,
                  priceListId: val(f, "priceListId") || null,
                  productId: val(f, "productId"),
                  minQuantity: val(f, "minQuantity"),
                  price: val(f, "price"),
                  startsAt: utc(val(f, "startsAt")),
                  endsAt: utc(val(f, "endsAt")),
                });
              }}
            >
              <h3>
                {t(
                  "Add a company price or quantity tier",
                  "إضافة سعر شركة أو شريحة كمية",
                )}
              </h3>
              <p>
                {t(
                  "Choose either a company or a reusable list. Higher qualifying quantity tiers apply.",
                  "اختر شركة أو قائمة قابلة لإعادة الاستخدام. تُطبق شريحة الكمية المؤهلة الأعلى.",
                )}
              </p>
              <div className="form-grid">
                <label>
                  {t("Company", "الشركة")}
                  <select name="companyId">
                    <option value="">—</option>
                    {data.companies.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Price list", "قائمة الأسعار")}
                  <select name="priceListId">
                    <option value="">—</option>
                    {data.priceLists.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Product", "المنتج")}
                  {productSelect()}
                </label>
                <Field
                  name="minQuantity"
                  label={t("Minimum quantity", "أقل كمية")}
                  value="1"
                  type="number"
                  required
                />
                <Field
                  name="price"
                  label={t(
                    "Unit price excluding VAT",
                    "سعر الوحدة بدون الضريبة",
                  )}
                  type="number"
                  required
                />
                <Field
                  name="startsAt"
                  label={t("Start", "البداية")}
                  type="datetime-local"
                />
                <Field
                  name="endsAt"
                  label={t("Expiry", "الانتهاء")}
                  type="datetime-local"
                />
              </div>
              <button disabled={busy}>{t("Save price", "حفظ السعر")}</button>
            </form>
          )}
          <div className="dense-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Product", "المنتج")}</th>
                  <th>{t("Company / list", "الشركة / القائمة")}</th>
                  <th>{t("Quantity", "الكمية")}</th>
                  <th>SAR</th>
                  <th>{t("Expiry", "الانتهاء")}</th>
                </tr>
              </thead>
              <tbody>
                {data.prices.map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.part_number}</td>
                    <td>
                      {data.companies.find((c: any) => c.id === p.company_id)
                        ?.name ||
                        data.priceLists.find(
                          (c: any) => c.id === p.price_list_id,
                        )?.name}
                    </td>
                    <td>{p.min_quantity}+</td>
                    <td>{p.price}</td>
                    <td>
                      {p.ends_at
                        ? new Date(p.ends_at).toLocaleDateString()
                        : "—"}
                      {can('PRODUCT_EDIT')&&<details><summary>{t('Edit price','تعديل السعر')}</summary><form key={p.version} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save('prices',{id:p.id,version:p.version,companyId:p.company_id,priceListId:p.price_list_id,productId:p.product_id,minQuantity:val(f,'minQuantity'),price:val(f,'price'),startsAt:utc(val(f,'startsAt')),endsAt:utc(val(f,'endsAt'))})}}><Field name="minQuantity" label={t('Minimum quantity','أقل كمية')} type="number" value={p.min_quantity}/><Field name="price" label={t('Price excluding VAT','السعر بدون الضريبة')} type="number" value={p.price}/><Field name="startsAt" label={t('Start','البداية')} type="datetime-local" value={local(p.starts_at)}/><Field name="endsAt" label={t('End','النهاية')} type="datetime-local" value={local(p.ends_at)}/><button disabled={busy}>{t('Save changes','حفظ التغييرات')}</button></form></details>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === "quotes" && (
        <>
          {data.requests.length === 0 && (
            <p>
              {t("No requirements requests yet.", "لا توجد طلبات متطلبات بعد.")}
            </p>
          )}
          {data.requests.map((r: any) => (
            <form
              className="card"
              key={r.id + ":" + r.version}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save("requirements/" + r.id, {
                  version: r.version,
                  action: val(f, "action"),
                  quotationId: val(f, "quotationId") || undefined,
                  leadTime: val(f, "leadTime"),
                  days: Number(f.get("days") || 30),
                });
              }}
            >
              <h3>
                {r.number} · {r.company_name}
              </h3>
              <p>
                {r.status} · {r.quote_number} {r.quote_status}
              </p>
              <p>{r.notes}</p>
              <p>
                {t("Required by", "مطلوب بتاريخ")}:{" "}
                {r.required_date?.slice(0, 10) || "—"}
              </p>
              {r.lines.map((l: any, i: number) => (
                <p key={i}>
                  {l.quantity} {l.unit} · {l.partNumber} {l.description}
                </p>
              ))}
              <p>
                {t(
                  "Create a draft, review materials and prices in Quotations, issue it through existing approvals, then share it here.",
                  "أنشئ مسودة وراجع المواد والأسعار في عروض الأسعار، ثم أصدرها عبر الموافقات وشاركها هنا.",
                )}
              </p>
              <div className="form-grid">
                <label>
                  {t("Action", "الإجراء")}
                  <select name="action">
                    <option value="REVIEW">
                      {t("Mark in review", "قيد المراجعة")}
                    </option>
                    {!r.quotation_id && (
                      <option value="CREATE_DRAFT">
                        {t("Create quotation draft", "إنشاء مسودة عرض")}
                      </option>
                    )}
                    <option value="SHARE">
                      {t(
                        "Share issued quote / revision",
                        "مشاركة عرض صادر / مراجعة",
                      )}
                    </option>
                  </select>
                </label>
                <Field
                  name="quotationId"
                  label={t("Quotation ID", "معرف عرض السعر")}
                  value={r.quotation_id}
                />
                <Field
                  name="leadTime"
                  label={t(
                    "Supply lead time / delivery terms",
                    "مهلة التوريد / شروط التسليم",
                  )}
                  value={r.lead_time}
                />
                <Field
                  name="days"
                  label={t("Valid for days", "مدة الصلاحية بالأيام")}
                  value="30"
                  type="number"
                />
              </div>
              <button disabled={busy}>
                {t("Update request", "تحديث الطلب")}
              </button>
            </form>
          ))}
        </>
      )}
      {tab === "orders" && (
        <>
          {data.orders.map((o: any) => (
            <form
              className="card"
              key={o.id + ":" + o.version}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                save("order-actions/" + o.id, {
                  version: o.version,
                  action: val(f, "action"),
                  amount: val(f, "amount") || undefined,
                  reference: val(f, "reference"),
                  carrier: val(f, "carrier"),
                  tracking: val(f, "tracking"),
                  idempotencyKey: crypto.randomUUID(),
                });
              }}
            >
              <h3>
                {o.number} · {o.company_name || o.guest_contact?.name}
              </h3>
              <p>
                {o.status} · {o.payment_method} · SAR {o.totals.total} ·{" "}
                {t("Paid", "المدفوع")}: {o.paid_amount}
              </p>
              <p>{o.fulfillment_data.paymentReview}</p>
              {o.lines.map((l: any, i: number) => (
                <p key={i}>
                  {l.quantity} × {l.partNumber} · SAR {l.lineTotal}
                </p>
              ))}
              <div className="form-grid">
                <label>
                  {t("Action", "الإجراء")}
                  <select name="action">
                    <option value="PAYMENT">
                      {t("Record verified bank payment", "تسجيل دفع بنكي مؤكد")}
                    </option>
                    <option value="TRACKING">
                      {t("Update shipment", "تحديث الشحنة")}
                    </option>
                    <option value="CANCEL">
                      {t("Cancel undelivered order", "إلغاء طلب لم يتم تسليمه")}
                    </option>
                  </select>
                </label>
                <Field
                  name="amount"
                  label={t("Payment amount", "مبلغ الدفعة")}
                  type="number"
                />
                <Field
                  name="reference"
                  label={t("Verified bank reference", "مرجع البنك المؤكد")}
                />
                <Field
                  name="carrier"
                  label={t("Carrier", "شركة الشحن")}
                  value={o.fulfillment_data.carrier}
                />
                <Field
                  name="tracking"
                  label={t("Tracking reference", "مرجع التتبع")}
                  value={o.fulfillment_data.tracking}
                />
              </div>
              <button disabled={busy}>
                {t("Apply action", "تنفيذ الإجراء")}
              </button>
            </form>
          ))}
        </>
      )}
    </div>
  );
}
