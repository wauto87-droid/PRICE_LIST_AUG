"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { appPath } from "../shared/paths";
import { StoreDialog } from "./StorefrontCheckout";
import type { StoreCart } from "./Storefront";
export default function BusinessPortal({
  t,
  cart,
  close,
}: {
  t: Translate;
  cart: StoreCart;
  close: () => void;
}) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [lines, setLines] = useState<any[]>(() =>
      Object.values(cart).map((p) => ({
        productId: p.id,
        partNumber: p.part_number,
        description: p.description,
        quantity: p.quantity,
        unit: p.unit,
      })),
    ),
    [files, setFiles] = useState<File[]>([]),
    [requestId, setRequestId] = useState<string>(),
    [tab, setTab] = useState("requirements");
  async function load() {
    try {
      setData(await api("storefront/business"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function action(fn: () => Promise<any>) {
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
  async function attach(id: string | null, file: File) {
    const form = new FormData();
    form.set("file", file);
    if (id) form.set("requestId", id);
    await api("storefront/attachments", "POST", form);
  }
  return (
    <StoreDialog
      title={t("Company purchasing", "مشتريات الشركة")}
      close={close}
    >
      {error && (
        <p className="sf-alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p>{t("Loading your company…", "جارٍ تحميل الشركة…")}</p>
      ) : (
        <>
          <h3>{data.company.name}</h3>
          <p>
            {t("Available credit", "الائتمان المتاح")}: SAR{" "}
            {Math.max(
              0,
              Number(data.company.credit_limit) - Number(data.creditUsed),
            ).toFixed(2)}
          </p>
          <div className="sf-tabs">
            {[
              ["requirements", "Requirements & quotes", "المتطلبات والعروض"],
              ["orders", "Orders", "الطلبات"],
              ["team", "Company & team", "الشركة والفريق"],
            ].map(([key, en, ar]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {t(en, ar)}
              </button>
            ))}
          </div>
          {tab === "requirements" && (
            <>
              <form
                className="sf-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  action(async () => {
                    const id =
                      requestId ||
                      (
                        await api("storefront/requirements", "POST", {
                          lines,
                          notes: String(f.get("notes") || ""),
                          requiredDate: f.get("requiredDate") || null,
                        })
                      ).id;
                    setRequestId(id);
                    for (const file of files) await attach(id, file);
                    setRequestId(undefined);
                    setFiles([]);
                    setLines([]);
                    setNotice(
                      t(
                        "Requirements submitted. Our team will prepare your offer.",
                        "تم إرسال المتطلبات. سيقوم فريقنا بإعداد عرضك.",
                      ),
                    );
                  });
                }}
              >
                <h3>{t("Request our best price", "اطلب أفضل أسعارنا")}</h3>
                <p>
                  {t(
                    "Use your cart, add materials below, or attach your Excel/PDF list. You can request an extra discount in the notes.",
                    "استخدم سلتك أو أضف المواد أدناه أو أرفق قائمة Excel/PDF. يمكنك طلب خصم إضافي في الملاحظات.",
                  )}
                </p>
                {lines.map((l, i) => (
                  <div className="commerce-material" key={i}>
                    <input
                      aria-label={t("Part number", "رقم الصنف")}
                      value={l.partNumber}
                      disabled={!!l.productId || !!requestId}
                      onChange={(e) =>
                        setLines((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, partNumber: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={t("Material description", "وصف المادة")}
                      value={l.description}
                      required
                      disabled={!!requestId}
                      onChange={(e) =>
                        setLines((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, description: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={t("Quantity", "الكمية")}
                      type="number"
                      min="0.000001"
                      step="any"
                      value={l.quantity}
                      required
                      disabled={!!requestId}
                      onChange={(e) =>
                        setLines((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, quantity: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={t("Unit", "الوحدة")}
                      value={l.unit}
                      disabled={!!requestId}
                      onChange={(e) =>
                        setLines((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, unit: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      disabled={!!requestId}
                      onClick={() =>
                        setLines((v) => v.filter((_, j) => i !== j))
                      }
                    >
                      {t("Remove", "حذف")}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={!!requestId}
                  onClick={() =>
                    setLines((v) => [
                      ...v,
                      {
                        productId: null,
                        partNumber: "",
                        description: "",
                        quantity: "1",
                        unit: "pcs",
                      },
                    ])
                  }
                >
                  {t("Add material", "إضافة مادة")}
                </button>
                <label>
                  {t("Notes / requested discount", "ملاحظات / الخصم المطلوب")}
                  <textarea
                    name="notes"
                    required={!lines.length}
                    disabled={!!requestId}
                  />
                </label>
                <label>
                  {t("Required date", "التاريخ المطلوب")}
                  <input
                    name="requiredDate"
                    type="date"
                    disabled={!!requestId}
                  />
                </label>
                <label>
                  {t(
                    "Attach Excel, CSV or PDF (10 MB each)",
                    "إرفاق Excel أو CSV أو PDF (10 ميغابايت لكل ملف)",
                  )}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf"
                    multiple
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  />
                </label>
                <button className="sf-primary" disabled={busy}>
                  {requestId
                    ? t("Retry attachments", "إعادة رفع المرفقات")
                    : t("Submit requirements", "إرسال المتطلبات")}
                </button>
              </form>
              <h3>{t("Your requests", "طلباتك")}</h3>
              {data.requests.map((r: any) => (
                <article className="card" key={r.id}>
                  <strong>{r.number}</strong>
                  <p>
                    {r.status} · {r.quote_status}
                  </p>
                  <p>{r.notes}</p>
                  {r.lead_time && (
                    <p>
                      {t("Supply terms", "شروط التوريد")}: {r.lead_time}
                    </p>
                  )}
                  {r.quoteUrl && (
                    <a href={r.quoteUrl} target="_blank" rel="noreferrer">
                      {t(
                        "Review quote, accept or decline",
                        "مراجعة العرض والقبول أو الرفض",
                      )}
                    </a>
                  )}
                  {r.status==='QUOTED'&&<form className="sf-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);action(async()=>{await api('storefront/requirements/'+r.id+'/discount','POST',{note:String(f.get('note'))});setNotice(t('Discount request sent. Our team will revise your offer.','تم إرسال طلب الخصم. سيقوم فريقنا بمراجعة العرض.'))})}}><label>{t('Request an additional discount','طلب خصم إضافي')}<input name="note" minLength={3} required placeholder={t('Target price, discount or comments','السعر المستهدف أو الخصم أو الملاحظات')}/></label><button disabled={busy}>{t('Request revised offer','طلب عرض معدل')}</button></form>}
                  {r.status === "ACCEPTED" && (
                    <p>
                      <a href={appPath("/store") + "?request=" + r.id}>
                        {t(
                          "Purchase quoted catalog items",
                          "شراء المنتجات المعروضة",
                        )}
                      </a>
                    </p>
                  )}
                  <p>
                    {r.status === "ACCEPTED" &&
                      t(
                        "Your accepted offer is ready for our team to arrange payment and supply.",
                        "عرضك المقبول جاهز ليقوم فريقنا بترتيب الدفع والتوريد.",
                      )}
                  </p>
                  {data.attachments
                    .filter((a: any) => a.request_id === r.id)
                    .map((a: any) => (
                      <p key={a.id}>
                        <a
                          href={appPath(
                            "/api/v1/storefront/attachments/" + a.id,
                          )}
                        >
                          {a.name}
                        </a>
                      </p>
                    ))}
                </article>
              ))}
            </>
          )}
          {tab === "orders" && (
            <>
              {data.orders.map((o: any) => (
                <article className="card" key={o.id}>
                  <h3>{o.number}</h3>
                  <p>
                    {o.status} · {o.fulfillment_status} · SAR {o.totals.total}
                  </p>
                  <p>
                    {o.fulfillment_data.carrier} {o.fulfillment_data.tracking}
                  </p>
                  {o.lines.map((l: any, i: number) => (
                    <p key={i}>
                      {l.quantity} × {l.partNumber} · SAR {l.lineTotal}
                    </p>
                  ))}
                  {o.sales_order_id && (
                    <form
                      className="sf-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        action(async () => {
                          await api("storefront/returns", "POST", {
                            orderId: o.id,
                            reason: String(f.get("reason")),
                            lines: [
                              {
                                productId: String(f.get("productId")),
                                quantity: String(f.get("quantity")),
                              },
                            ],
                          });
                          setNotice(
                            t(
                              "Return submitted for review.",
                              "تم إرسال طلب الإرجاع للمراجعة.",
                            ),
                          );
                        });
                      }}
                    >
                      <label>
                        {t("Return a delivered item", "إرجاع منتج تم تسليمه")}
                        <select name="productId">
                          {o.lines.map((l: any) => (
                            <option key={l.productId} value={l.productId}>
                              {l.partNumber}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t("Quantity", "الكمية")}
                        <input
                          name="quantity"
                          type="number"
                          min="0.000001"
                          step="any"
                          required
                        />
                      </label>
                      <label>
                        {t("Reason", "السبب")}
                        <input name="reason" required minLength={3} />
                      </label>
                      <button disabled={busy}>
                        {t("Request return", "طلب إرجاع")}
                      </button>
                    </form>
                  )}
                </article>
              ))}
              <h3>{t("Status history", "سجل الحالة")}</h3>
              {data.events.map((e: any) => (
                <p key={e.id}>
                  {new Date(e.created_at).toLocaleString()} · {e.message}
                </p>
              ))}
            </>
          )}
          {tab === "team" && (
            <>
              {data.company.company_role === "OWNER" ? (
                <>
                  <form
                    className="sf-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      action(async () => {
                        const r = await api("storefront/invitations", "POST", {
                          email: String(f.get("email")),
                        });
                        setNotice(
                          t(
                            "Share this invitation with your buyer: ",
                            "شارك هذه الدعوة مع المشتري: ",
                          ) + new URL(r.link, location.origin).toString(),
                        );
                      });
                    }}
                  >
                    <label>
                      {t("Buyer email", "بريد المشتري")}
                      <input type="email" name="email" required />
                    </label>
                    <button disabled={busy}>
                      {t("Create invitation link", "إنشاء رابط دعوة")}
                    </button>
                  </form>
                  {data.members.map((m: any) => (
                    <div className="card" key={m.id}>
                      {m.email} · {m.company_role} · {m.status}
                      {m.company_role === "BUYER" && m.status !== "BLOCKED" && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            action(() =>
                              api("storefront/members/" + m.id, "DELETE"),
                            )
                          }
                        >
                          {t("Remove access", "إزالة الوصول")}
                        </button>
                      )}
                    </div>
                  ))}
                  <label>
                    {t("Company supporting document", "مستند الشركة الداعم")}
                    <input
                      type="file"
                      accept=".pdf,.xlsx,.xls,.csv"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) action(() => attach(null, f));
                      }}
                    />
                  </label>
                  {data.attachments
                    .filter((a: any) => !a.request_id)
                    .map((a: any) => (
                      <p key={a.id}>
                        <a
                          href={appPath(
                            "/api/v1/storefront/attachments/" + a.id,
                          )}
                        >
                          {a.name}
                        </a>
                      </p>
                    ))}
                </>
              ) : (
                <p>
                  {t(
                    "Your company owner manages team access and company documents.",
                    "يدير مالك حساب الشركة أعضاء الفريق ومستندات الشركة.",
                  )}
                </p>
              )}
            </>
          )}
        </>
      )}
    </StoreDialog>
  );
}
