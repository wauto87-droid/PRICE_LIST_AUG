"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";

export default function Storefront() {
  const [lang, setLang] = useState<"en" | "ar">("en"),
    [config, setConfig] = useState<any>(),
    [catalog, setCatalog] = useState<any>(),
    [q, setQ] = useState(""),
    [cart, setCart] = useState<Record<string, any>>({}),
    [checkout, setCheckout] = useState(false),
    [otp, setOtp] = useState<any>(),
    [verified, setVerified] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  async function load() {
    try {
      setConfig(await api("storefront/configuration"));
      setCatalog(await api(`storefront/catalog?q=${encodeURIComponent(q)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const lines = Object.values(cart) as any[],
    total = useMemo(
      () => lines.reduce((s, l) => s + Number(l.priceIncl) * l.quantity, 0),
      [lines],
    );
  function add(item: any) {
    setCart({
      ...cart,
      [item.id]: { ...item, quantity: (cart[item.id]?.quantity ?? 0) + 1 },
    });
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget),
      method = String(f.get("paymentMethod"));
    try {
      let token: string | undefined;
      if (method === "MOYASAR") {
        const key = config.moyasarPublishableKey;
        const tokenRes = await fetch("https://api.moyasar.com/v1/tokens", {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${key}:`)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: f.get("cardName"),
            number: String(f.get("cardNumber")).replace(/\s/g, ""),
            month: Number(f.get("month")),
            year: Number(f.get("year")),
            cvc: f.get("cvc"),
            save_only: true,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok)
          throw new Error(
            tokenData.message ||
              t("Payment details were rejected", "تم رفض بيانات الدفع"),
          );
        token = tokenData.id;
      }
      const result = await api("storefront/checkout", "POST", {
        verificationId: otp.id,
        verificationToken: verified,
        contact: {
          name: f.get("name"),
          mobile: f.get("mobile"),
          ...(f.get("email") ? { email: f.get("email") } : {}),
        },
        lines: lines.map((l) => ({
          productId: l.id,
          quantity: String(l.quantity),
        })),
        fulfillmentMethod: f.get("fulfillmentMethod"),
        ...(f.get("warehouseId") ? { warehouseId: f.get("warehouseId") } : {}),
        ...(f.get("zoneId") ? { zoneId: f.get("zoneId") } : {}),
        address: { text: f.get("address") },
        paymentMethod: method,
        moyasarToken: token,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.redirectUrl) location.href = result.redirectUrl;
      else {
        setMessage(
          `${t("Order received", "تم استلام الطلب")}: ${result.orderNumber}`,
        );
        setCart({});
        setCheckout(false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!config && !error)
    return (
      <main className="store-page">
        <div className="store-loading">AMT Electric</div>
      </main>
    );
  return (
    <main className="store-page">
      <header className="store-header">
        <div>
          <strong>{config?.companyName || "AMT Electric"}</strong>
          <small>{t("Online catalog", "الكتالوج الإلكتروني")}</small>
        </div>
        <nav>
          <button onClick={() => setLang(lang === "en" ? "ar" : "en")}>
            {lang === "en" ? "العربية" : "English"}
          </button>
          <button
            className="store-cart-button"
            onClick={() => setCheckout(true)}
          >
            {t("Cart", "السلة")} <b>{lines.length}</b>
          </button>
        </nav>
      </header>
      <section className="store-hero">
        <div>
          <span>AMT ELECTRIC</span>
          <h1>
            {t(
              config?.hero || "Electrical products, priced clearly.",
              config?.heroAr || "منتجات كهربائية بأسعار واضحة.",
            )}
          </h1>
          <p>
            {t(
              "Search by part number or description and order online.",
              "ابحث برقم الصنف أو الوصف واطلب عبر الإنترنت.",
            )}
          </p>
        </div>
        <div className="store-search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder={t("Part number or description", "رقم الصنف أو الوصف")}
          />
          <button className="primary" onClick={load}>
            {t("Search", "بحث")}
          </button>
        </div>
      </section>
      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}
      <section className="store-products">
        {catalog?.items?.map((item: any) => (
          <article key={item.id} className="store-product">
            <div className="store-product-copy">
              <small>{item.part_number}</small>
              <h2>{item.description}</h2>
              <span
                className={`availability ${item.availability.toLowerCase()}`}
              >
                {item.availability === "IN_STOCK"
                  ? t("In stock", "متوفر")
                  : item.availability === "LIMITED"
                    ? t("Limited stock", "كمية محدودة")
                    : t("Available on backorder", "متاح بالطلب")}
              </span>
            </div>
            <div className="store-product-buy">
              <strong>SAR {item.priceIncl}</strong>
              <small>{t("Including VAT", "شامل الضريبة")}</small>
              <button className="primary" onClick={() => add(item)}>
                {t("Add to cart", "أضف للسلة")}
              </button>
            </div>
          </article>
        ))}
      </section>
      {checkout && (
        <div className="modal-backdrop">
          <section className="modal-card store-checkout">
            <button className="modal-close" onClick={() => setCheckout(false)}>
              ×
            </button>
            <h2>{t("Checkout", "إتمام الطلب")}</h2>
            <div className="store-cart-lines">
              {lines.map((l) => (
                <div key={l.id}>
                  <span>
                    {l.part_number}
                    <small>{l.description}</small>
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={l.quantity}
                    onChange={(e) =>
                      setCart({
                        ...cart,
                        [l.id]: { ...l, quantity: Number(e.target.value) },
                      })
                    }
                  />
                  <strong>
                    SAR {(Number(l.priceIncl) * l.quantity).toFixed(2)}
                  </strong>
                </div>
              ))}
            </div>
            <div className="store-total">
              <span>{t("Total including VAT", "الإجمالي شامل الضريبة")}</span>
              <strong>SAR {total.toFixed(2)}</strong>
            </div>
            {!verified ? (
              <div className="otp-panel">
                <label>
                  {t("Mobile number", "رقم الجوال")}
                  <input id="otp-mobile" />
                </label>
                {!otp ? (
                  <button
                    className="primary"
                    onClick={async () => {
                      const destination = (
                        document.getElementById(
                          "otp-mobile",
                        ) as HTMLInputElement
                      ).value;
                      try {
                        setOtp(
                          await api("storefront/otp/request", "POST", {
                            destination,
                            channel: "SMS",
                          }),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {t("Send verification code", "إرسال رمز التحقق")}
                  </button>
                ) : (
                  <>
                    <label>
                      {t("Verification code", "رمز التحقق")}
                      <input id="otp-code" inputMode="numeric" />
                    </label>
                    <button
                      className="primary"
                      onClick={async () => {
                        try {
                          const r = await api("storefront/otp/verify", "POST", {
                            id: otp.id,
                            code: (
                              document.getElementById(
                                "otp-code",
                              ) as HTMLInputElement
                            ).value,
                          });
                          setVerified(r.verificationToken);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      {t("Verify", "تحقق")}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <form onSubmit={submit} className="store-checkout-form">
                <div className="form-grid">
                  <label>
                    {t("Customer name", "اسم العميل")}
                    <input name="name" required />
                  </label>
                  <label>
                    {t("Mobile", "الجوال")}
                    <input name="mobile" required />
                  </label>
                </div>
                <label>
                  {t("Email (optional)", "البريد الإلكتروني (اختياري)")}
                  <input name="email" type="email" />
                </label>
                <div className="form-grid">
                  <label>
                    {t("Fulfillment", "طريقة الاستلام")}
                    <select name="fulfillmentMethod">
                      <option value="DELIVERY">{t("Delivery", "توصيل")}</option>
                      <option value="PICKUP">
                        {t("Branch pickup", "استلام من الفرع")}
                      </option>
                    </select>
                  </label>
                  <label>
                    {t("Payment", "الدفع")}
                    <select name="paymentMethod">
                      <option value="BANK_TRANSFER">
                        {t("Bank transfer", "تحويل بنكي")}
                      </option>
                      <option value="CASH">
                        {t("Cash on confirmation", "نقداً عند التأكيد")}
                      </option>
                      {config.onlinePaymentEnabled && (
                        <option value="MOYASAR">
                          {t("Card / mada", "بطاقة / مدى")}
                        </option>
                      )}
                    </select>
                  </label>
                </div>
                {config.pickupLocations?.length > 0 && (
                  <label>
                    {t(
                      "Pickup branch (required for pickup)",
                      "فرع الاستلام (مطلوب للاستلام من الفرع)",
                    )}
                    <select name="warehouseId">
                      <option value="">—</option>
                      {config.pickupLocations.map((w: any) => (
                        <option key={w.id} value={w.id}>
                          {lang === "ar" && w.name_ar ? w.name_ar : w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {config.deliveryZones?.length > 0 && (
                  <label>
                    {t("Delivery zone", "منطقة التوصيل")}
                    <select name="zoneId">
                      <option value="">—</option>
                      {config.deliveryZones.map((z: any) => (
                        <option key={z.id} value={z.id}>
                          {z.name} · SAR {z.fee}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {t(
                    "Delivery address or pickup instructions",
                    "عنوان التوصيل أو تعليمات الاستلام",
                  )}
                  <textarea name="address" />
                </label>
                {config.onlinePaymentEnabled && (
                  <details className="payment-card-fields">
                    <summary>
                      {t(
                        "Card details (only for Card / mada)",
                        "بيانات البطاقة (للدفع الإلكتروني فقط)",
                      )}
                    </summary>
                    <label>
                      {t("Name on card", "الاسم على البطاقة")}
                      <input name="cardName" />
                    </label>
                    <label>
                      {t("Card number", "رقم البطاقة")}
                      <input
                        name="cardNumber"
                        inputMode="numeric"
                        autoComplete="cc-number"
                      />
                    </label>
                    <div className="form-grid">
                      <input
                        name="month"
                        placeholder="MM"
                        inputMode="numeric"
                      />
                      <input name="year" placeholder="YY" inputMode="numeric" />
                      <input
                        name="cvc"
                        placeholder="CVC"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                      />
                    </div>
                  </details>
                )}
                <button className="primary store-place-order">
                  {t("Place order", "تأكيد الطلب")}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
