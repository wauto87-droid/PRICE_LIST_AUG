"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Translate } from "./api";
import type { StoreCart } from "./Storefront";
export function StoreDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!,
      previous = document.activeElement as HTMLElement;
    el.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sf-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="sf-dialog-heading">
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label="Close / إغلاق">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Otp({
  purpose = "CHECKOUT",
  destination,
  verified,
  t,
}: {
  purpose?: "CHECKOUT" | "SIGNUP" | "LOGIN";
  destination: string;
  verified: (id: string, token: string) => void;
  t: Translate;
}) {
  const [challenge, setChallenge] = useState<any>(),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    setChallenge(undefined);
    setCode("");
  }, [destination]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function request() {
    setBusy(true);
    setError("");
    try {
      setChallenge(
        await api("storefront/otp/request", "POST", {
          destination,
          channel: purpose !== "CHECKOUT" ? "WHATSAPP" : destination.includes("@") ? "EMAIL" : "SMS",
          purpose,
        }),
      );
      setCooldown(60);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      const r = await api("storefront/otp/verify", "POST", {
        id: challenge.id,
        code,
      });
      verified(challenge.id, r.verificationToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sf-otp">
      {error && (
        <p className="sf-alert" role="alert">
          {error}
        </p>
      )}
      {challenge && (
        <>
          <label>
            {t("Verification code", "رمز التحقق")}
            <input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </label>
          <button
            type="button"
            disabled={busy || code.length !== 6}
            onClick={verify}
          >
            {t("Verify code", "تحقق من الرمز")}
          </button>
          <small>
            {t(
              "Your code expires after 10 minutes.",
              "تنتهي صلاحية الرمز بعد 10 دقائق.",
            )}
          </small>
        </>
      )}
      <button
        type="button"
        disabled={busy || destination.trim().length < 5 || cooldown > 0}
        onClick={request}
      >
        {cooldown
          ? `${t("Resend in", "إعادة الإرسال خلال")} ${cooldown}s`
          : challenge
            ? t("Resend code", "إعادة إرسال الرمز")
            : t("Send verification code", "إرسال رمز التحقق")}
      </button>
    </div>
  );
}
export function StoreAccount({
  account,
  changed,
  close,
  t,
  navigate,
  config,
}: {
  account: any;
  changed: (a: any) => void;
  close: () => void;
  t: Translate;
  navigate?: (panel: string) => void;
  config?: any;
}) {
  const [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [mobile, setMobile] = useState(""),
    [accountType, setAccountType] = useState("RETAIL"),
    [loginMethod, setLoginMethod] = useState("OTP"),
    [verification, setVerification] = useState<any>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [accountTab, setAccountTab] = useState("overview"),
    [orders, setOrders] = useState<any[]>([]),
    [ordersLoaded, setOrdersLoaded] = useState(false),
    [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });

  useEffect(() => {
    if (accountTab === "orders" && !ordersLoaded) {
      api("storefront/account/orders", "GET")
        .then((res) => {
          setOrders(res || []);
          setOrdersLoaded(true);
        })
        .catch((e) => setError(e.message));
    }
  }, [accountTab, ordersLoaded]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      if (mode === "login") {
        await api(loginMethod === "OTP" ? "storefront/account/login-otp" : "storefront/account/login", "POST", loginMethod === "OTP" ? {mobile,...verification} : {login:f.get("login"),password:f.get("password")});
        changed((await api("storefront/account/me")).account);
        close();
      } else {
        const file = f.get("supportingDocument");
        let supportingDocument;
        if (file instanceof File && file.size) {
          if (file.size > 1024 * 1024)
            throw new Error(
              t("Use a PDF up to 1 MB", "استخدم PDF بحجم أقصى 1 ميغابايت"),
            );
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          supportingDocument = { name: file.name, base64 };
        }
        await api("storefront/account/register", "POST", {
          supportingDocument,
          accountType,
          name: f.get("name"),
          email,
          mobile,
          customerCode: f.get("customerCode"),
          registrationNumber: f.get("registrationNumber") || "",
          taxNumber: f.get("taxNumber") || "",
          contactPerson: f.get("contactPerson") || "",
          address: f.get("companyAddress") || "",
          invitationToken:
            new URLSearchParams(location.search).get("invitation") || undefined,
          password: f.get("password"),
          ...verification,
        });
        setMessage(
          t(
            "Account created. Company purchasing, if requested, requires AMT approval.",
            "تم استلام الطلب. سيتاح الحساب بعد موافقة AMT.",
          ),
        );
        setMode("login");
        setVerification(undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <StoreDialog title={t("Your AMT account", "حسابك في AMT")} close={close}>
      {error && (
        <p className="sf-alert" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {account ? (
        <div className="sf-account">
          <div className="sf-tabs" style={{ marginBottom: "1rem" }}>
            <button onClick={() => setAccountTab("overview")} className={accountTab === "overview" ? "active" : ""}>{t("Overview", "نظرة عامة")}</button>
            <button onClick={() => setAccountTab("orders")} className={accountTab === "orders" ? "active" : ""}>{t("Orders", "الطلبات")}</button>
          </div>
          
          {accountTab === "overview" && (
            <div>
              <h3>{account.name || account.email}</h3>
              <p>{account.email}</p>
              <p>
                {t("Price level", "مستوى السعر")}: {account.price_level || "RETAIL"}
              </p>
              <p>
                {account.credit_enabled
                  ? t("Credit terms enabled", "شروط الائتمان مفعّلة")
                  : t("Pay per order", "الدفع لكل طلب")}
              </p>
              <div style={{ margin: "2rem 0", display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-start" }}>
                <button className="sf-text-button" onClick={() => { close(); navigate?.("receipts"); }}>
                  {t("Track your orders (Receipts)", "تتبع طلباتك (الإيصالات)")}
                </button>
                {config?.businessEnabled && (
                  <button className="sf-text-button" onClick={() => { close(); navigate?.("business"); }}>
                    {t(
                      "Company portal · Request our best price",
                      "بوابة الشركات · اطلب أفضل أسعارنا",
                    )}
                  </button>
                )}
              </div>
              <button
                onClick={async () => {
                  try {
                    await api("storefront/account/logout", "POST", {});
                    changed(null);
                    close();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {t("Sign out", "تسجيل الخروج")}
              </button>
            </div>
          )}

          {accountTab === "orders" && (
            <div>
              <h3>{t("Recent Orders", "أحدث الطلبات")}</h3>
              {orders.length === 0 ? (
                <p>{ordersLoaded ? t("No orders found.", "لا توجد طلبات.") : t("Loading...", "جاري التحميل...")}</p>
              ) : (
                <table className="sf-table">
                  <thead>
                    <tr>
                      <th>{t("Order #", "رقم الطلب")}</th>
                      <th>{t("Date", "التاريخ")}</th>
                      <th>{t("Status", "الحالة")}</th>
                      <th>{t("Total", "الإجمالي")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.number}</td>
                        <td>{new Date(o.created_at).toLocaleDateString()}</td>
                        <td>{o.status}</td>
                        <td>{o.totals?.total} {o.totals?.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              
              <hr style={{ margin: "2rem 0", borderColor: "var(--border)" }} />
              <h3>{t("Change Password", "تغيير كلمة المرور")}</h3>
              <form className="sf-form" onSubmit={async (e) => {
                e.preventDefault();
                setError(""); setMessage(""); setBusy(true);
                try {
                  await api("storefront/account/password", "POST", passwordForm);
                  setMessage(t("Password changed successfully.", "تم تغيير كلمة المرور بنجاح."));
                  setPasswordForm({ currentPassword: "", newPassword: "" });
                } catch (err: any) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}>
                <label>
                  {t("Current Password", "كلمة المرور الحالية")}
                  <input type="password" required value={passwordForm.currentPassword} onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))} />
                </label>
                <label>
                  {t("New Password", "كلمة المرور الجديدة")}
                  <input type="password" required minLength={8} value={passwordForm.newPassword} onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))} />
                </label>
                <button type="submit" disabled={busy}>{t("Change Password", "تغيير كلمة المرور")}</button>
              </form>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="sf-tabs">
            <button
              onClick={() => {setMode("login");setVerification(undefined)}}
              className={mode === "login" ? "active" : ""}
            >
              {t("Sign in", "تسجيل الدخول")}
            </button>
            <button
              onClick={() => {setMode("register");setVerification(undefined)}}
              className={mode === "register" ? "active" : ""}
            >
              {t("Sign up", "إنشاء حساب")}
            </button>
          </div>
          <form className="sf-form" onSubmit={submit}>
            {mode === "login" && <label>{t("Sign-in method", "طريقة الدخول")}<select aria-label={t("Sign-in method", "طريقة الدخول")} value={loginMethod} onChange={e=>{setLoginMethod(e.target.value);setVerification(undefined)}}><option value="OTP">WhatsApp OTP</option><option value="PASSWORD">{t("Password", "كلمة المرور")}</option></select></label>}
            {mode === "login" ? loginMethod === "OTP" ? <>
              <label>{t("WhatsApp mobile", "رقم واتساب")}<input type="tel" required value={mobile} onChange={e=>{setMobile(e.target.value);setVerification(undefined)}} /></label>
              {verification ? <p>{t("Mobile verified", "تم التحقق من الجوال")}</p> : <Otp key="login" purpose="LOGIN" destination={mobile} verified={(id,token)=>setVerification({verificationId:id,verificationToken:token})} t={t}/>}
            </> : (
              <label>
                {t("Email or mobile", "البريد أو الجوال")}
                <input name="login" required autoComplete="username" />
              </label>
            ) : (
              <>
                <label>{t("Account type", "نوع الحساب")}<select value={accountType} onChange={e=>setAccountType(e.target.value)}><option value="RETAIL">{t("Personal", "شخصي")}</option><option value="COMPANY">{t("Company", "شركة")}</option></select></label>
                <label>
                  {t("Business / customer name", "اسم الشركة / العميل")}
                  <input
                    name="name"
                    required
                    minLength={2}
                    autoComplete="organization"
                  />
                </label>
                {accountType === "COMPANY" && <div className="sf-form">
                  {[
                    [
                      "registrationNumber",
                      "Company registration number",
                      "رقم السجل التجاري",
                    ],
                    ["taxNumber", "Tax number", "الرقم الضريبي"],
                    ["contactPerson", "Contact person", "الشخص المسؤول"],
                    ["companyAddress", "Company address", "عنوان الشركة"],
                  ].map(([name, en, ar]) => (
                    <label key={name}>
                      {t(en, ar)}
                      <input
                        name={name}
                        required={
                          !new URLSearchParams(location.search).has(
                            "invitation",
                          ) && name !== "taxNumber"
                        }
                      />
                    </label>
                  ))}
                  <label>
                    {t(
                      "Registration document (PDF, up to 1 MB)",
                      "مستند التسجيل (PDF حتى 1 ميغابايت)",
                    )}
                    <input
                      name="supportingDocument"
                      type="file"
                      accept="application/pdf"
                    />
                  </label>
                </div>}
                <label>
                  {t("Customer code (optional)", "رمز العميل (اختياري)")}
                  <input name="customerCode" />
                </label>
                <label>
                  {t("Mobile", "الجوال")}
                  <input name="mobile" required type="tel" autoComplete="tel" value={mobile} onChange={e=>{setMobile(e.target.value);setVerification(undefined)}} />
                </label>
                <label>
                  {t("Email", "البريد الإلكتروني")}
                  <input
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setVerification(undefined);
                    }}
                    type="email"
                    required
                    autoComplete="email"
                  />
                </label>
                {verification ? (
                  <p>{t("WhatsApp mobile verified", "تم التحقق من رقم واتساب")}</p>
                ) : (
                  <Otp
                    purpose="SIGNUP"
                    key="signup"
                    destination={mobile}
                    verified={(id, token) =>
                      setVerification({
                        verificationId: id,
                        verificationToken: token,
                      })
                    }
                    t={t}
                  />
                )}
              </>
            )}
            {(mode === "register" || loginMethod === "PASSWORD") && <label>
              {t("Password", "كلمة المرور")}
              <input
                name="password"
                type="password"
                minLength={mode === "register" ? 8 : undefined}
                required
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
              />
            </label>}
            <button
              className="sf-primary"
              disabled={busy || ((mode === "register" || loginMethod === "OTP") && !verification)}
            >
              {mode === "login"
                ? t("Sign in", "تسجيل الدخول")
                : t("Submit application", "إرسال الطلب")}
            </button>
          </form>
        </>
      )}
    </StoreDialog>
  );
}
export default function StorefrontCheckout({
  cart,
  setCart,
  account,
  config,
  t,
  close,
  requestQuote,
}: {
  cart: StoreCart;
  setCart: React.Dispatch<React.SetStateAction<StoreCart>>;
  account: any;
  config: any;
  t: Translate;
  close: () => void;
  requestQuote?:()=>void;
}) {
  const [step, setStep] = useState(0),
    [contact, setContact] = useState({ name: "", mobile: "", email: "" }),
    [verification, setVerification] = useState<any>(),
    [fulfillment, setFulfillment] = useState(
      config?.deliveryEnabled && config?.deliveryZones?.length
        ? "DELIVERY"
        : "PICKUP",
    ),
    [zone, setZone] = useState(""),
    [warehouse, setWarehouse] = useState(""),
    [address, setAddress] = useState(""),
    [method, setMethod] = useState(config?.bankTransferEnabled!==false?'BANK_TRANSFER':config?.onlinePaymentEnabled?'MOYASAR':account?.credit_enabled?'CREDIT_TERMS':''),
    [quote, setQuote] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(),
    [attempt, setAttempt] = useState<any>();
  const lines = Object.values(cart),
    keyRef = useRef("");
  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("amt-store-checkout") || "null",
      );
      if (saved) {
        setAttempt(saved);
        setStep(3);
      }
    } catch {}
  }, []);
  const [coupon, setCoupon] = useState("");
  const payload = () => ({
    requestId: new URLSearchParams(location.search).get("request") || undefined,
    coupon: coupon || undefined,
    lines: lines.map((l) => ({
      productId: l.id,
      quantity: String(l.quantity),
    })),
    fulfillmentMethod: fulfillment,
    ...(fulfillment === "DELIVERY"
      ? { zoneId: zone, address: { text: address } }
      : { warehouseId: warehouse }),
    paymentMethod: method,
    ...(!account
      ? {
          contact: {
            name: contact.name,
            mobile: contact.mobile,
            ...(contact.email ? { email: contact.email } : {}),
          },
          ...verification,
        }
      : {}),
  });
  async function review() {
    setBusy(true);
    setError("");
    try {
      const r = await api("storefront/preview", "POST", payload());
      setQuote(r);
      keyRef.current = crypto.randomUUID();
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function place(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let body = attempt || {
        ...payload(),
        quoteHash: quote.quoteHash,
        idempotencyKey: keyRef.current,
      };
      if (body.paymentMethod === "MOYASAR" && !body.moyasarToken) {
        const f = new FormData(e.currentTarget);
        const tokenRes = await fetch("https://api.moyasar.com/v1/tokens", {
          method: "POST",
          headers: {
            authorization: `Basic ${btoa(`${config.moyasarPublishableKey}:`)}`,
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
        const token = await tokenRes.json();
        if (!tokenRes.ok)
          throw new Error(
            t(
              "Card details were rejected. Check the fields and try again.",
              "تم رفض بيانات البطاقة. راجع الحقول وحاول مرة أخرى.",
            ),
          );
        body = { ...body, moyasarToken: token.id };
      }
      setAttempt(body);
      sessionStorage.setItem("amt-store-checkout", JSON.stringify(body));
      const r = await api("storefront/checkout", "POST", body);
      setResult(r);
      if (!account && body.verificationToken) {
        try {
          const saved = JSON.parse(
            localStorage.getItem("amt-store-receipts") || "[]",
          );
          localStorage.setItem(
            "amt-store-receipts",
            JSON.stringify(
              [
                {
                  orderId: r.orderId,
                  orderNumber: r.orderNumber,
                  verificationToken: body.verificationToken,
                },
                ...saved.filter((o: any) => o.orderId !== r.orderId),
              ].slice(0, 30),
            ),
          );
        } catch {}
      }
      if (r.status === "PENDING_REVIEW" || r.status === "CONFIRMED")
        complete(body);
      if (r.redirectUrl) {
        window.location.assign(r.redirectUrl);
        return;
      }
    } catch (e) {
      setError((e as Error).message);
      if ((e as Error).message.includes("Prices changed")) {
        sessionStorage.removeItem("amt-store-checkout");
        setAttempt(undefined);
        setStep(2);
      } else if ([400, 403, 404].includes((e as any).status)) {
        sessionStorage.removeItem("amt-store-checkout");
        setAttempt(undefined);
        setStep(2);
      }
    } finally {
      setBusy(false);
    }
  }
  function complete(body: any) {
    setCart((c) => {
      const next = { ...c };
      for (const l of body.lines) {
        if (next[l.productId]?.quantity === l.quantity)
          delete next[l.productId];
      }
      return next;
    });
    sessionStorage.removeItem("amt-store-checkout");
    setAttempt(undefined);
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const r = result.paymentReference
        ? await api(
            `storefront/payment-return?id=${encodeURIComponent(result.paymentReference)}`,
          )
        : await api(`storefront/orders/${result.orderId}`, "POST", {
            verificationToken: attempt?.verificationToken,
          });
      setResult(r);
      if (["CONFIRMED", "PENDING_REVIEW"].includes(r.status) && attempt)
        complete(attempt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const validQuantities = lines.every(
    (l) =>
      /^\d+(?:\.\d+)?$/.test(l.quantity) &&
      Number(l.quantity) > 0 &&
      Number(l.quantity) <= 1000000 &&
      (l.quantity.split(".")[1]?.length || 0) <= (l.quantityPrecision ?? 3),
  );
  return (
    <StoreDialog
      title={t("Your cart & checkout", "السلة وإتمام الطلب")}
      close={close}
    >
      {config?.businessEnabled&&requestQuote&&!result&&<button className="sf-primary" onClick={requestQuote}>{t('Request best price / quote for this cart','اطلب أفضل سعر / عرض لهذه السلة')}</button>}
      {error && (
        <p className="sf-alert" role="alert">
          {error}
        </p>
      )}
      {result ? (
        <div className="sf-state">
          <h2>
            {result.status === "CONFIRMED"
              ? t("Order confirmed", "تم تأكيد الطلب")
              : result.status === "PENDING_REVIEW"
                ? t("Order received", "تم استلام الطلب")
                : result.status === "FAILED"
                  ? t("Payment failed", "فشل الدفع")
                  : t("Payment pending", "الدفع قيد الانتظار")}
          </h2>
          <strong>{result.orderNumber}</strong>
          <p>SAR {result.totals?.total}</p>
          <p>
            {result.status === "PENDING_REVIEW"
              ? t(
                  "AMT will review and confirm your order and payment arrangements.",
                  "ستراجع AMT طلبك وتؤكد ترتيبات الدفع.",
                )
              : t(
                  "Keep this order number for your records.",
                  "احتفظ برقم الطلب للرجوع إليه.",
                )}
          </p>
          {method==='BANK_TRANSFER'&&<div className="card"><h3>{t('Bank transfer instructions','تعليمات التحويل البنكي')}</h3><p style={{whiteSpace:'pre-line'}}>{config.bankInstructions||t('Contact our sales team with your order number for bank details.','تواصل مع فريق المبيعات برقم طلبك للحصول على تفاصيل البنك.')}</p>{config.supportMobile&&<a href={'tel:'+config.supportMobile}>{config.supportMobile}</a>}</div>}
          {result.status === "PENDING_PAYMENT" && (
            <button disabled={busy} onClick={refresh}>
              {t("Check payment status", "التحقق من حالة الدفع")}
            </button>
          )}
          {result.status === "FAILED" && (
            <button
              onClick={() => {
                sessionStorage.removeItem("amt-store-checkout");
                setAttempt(undefined);
                setResult(undefined);
                setVerification(undefined);
                setStep(0);
              }}
            >
              {t("Start a new checkout", "بدء طلب جديد")}
            </button>
          )}
          <button onClick={close}>
            {t("Continue shopping", "متابعة التسوق")}
          </button>
        </div>
      ) : (
        <>
          <ol className="sf-steps">
            {[
              t("Cart", "السلة"),
              t("Contact", "التواصل"),
              t("Delivery", "التوصيل"),
              t("Review & pay", "المراجعة والدفع"),
            ].map((label, i) => (
              <li className={step === i ? "active" : ""} key={i}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>
          {step === 0 && (
            <>
              {!lines.length ? (
                <div className="sf-state">
                  <h3>{t("Your cart is empty", "سلتك فارغة")}</h3>
                  <button onClick={close}>
                    {t("Explore products", "تصفح المنتجات")}
                  </button>
                </div>
              ) : (
                <>
                  <div className="sf-cart-lines">
                    {lines.map((l) => (
                      <div className="sf-cart-line" key={l.id}>
                        <div>
                          <strong>{l.part_number}</strong>
                          <p>{l.description}</p>
                          <small>
                            SAR {l.priceIncl} / {l.unit}
                          </small>
                        </div>
                        <label>
                          {t("Quantity", "الكمية")}
                          <input
                            type="number"
                            min={10 ** -(l.quantityPrecision ?? 0)}
                            step={10 ** -(l.quantityPrecision ?? 0)}
                            max="1000000"
                            value={l.quantity}
                            onChange={(e) =>
                              setCart((c) => ({
                                ...c,
                                [l.id]: {
                                  ...c[l.id],
                                  quantity: e.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <button
                          onClick={() =>
                            setCart((c) => {
                              const next = { ...c };
                              delete next[l.id];
                              return next;
                            })
                          }
                        >
                          {t("Remove", "حذف")}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p>
                    {t(
                      "Prices and delivery charges are confirmed at review. Backorders are subject to AMT confirmation.",
                      "يتم تأكيد الأسعار ورسوم التوصيل عند المراجعة. الطلب المسبق يخضع لتأكيد AMT.",
                    )}
                  </p>
                  <button
                    className="sf-primary"
                    disabled={!validQuantities || !config?.enabled}
                    onClick={() => setStep(account ? 2 : 1)}
                  >
                    {t("Continue to checkout", "متابعة إتمام الطلب")}
                  </button>
                </>
              )}
            </>
          )}
          {step === 1 && (
            <div className="sf-form">
              <label>
                {t("Full name", "الاسم الكامل")}
                <input
                  value={contact.name}
                  onChange={(e) =>
                    setContact((c) => ({ ...c, name: e.target.value }))
                  }
                  autoComplete="name"
                />
              </label>
              <label>
                {t("Mobile number", "رقم الجوال")}
                <input
                  value={contact.mobile}
                  onChange={(e) => {
                    setContact((c) => ({ ...c, mobile: e.target.value }));
                    setVerification(undefined);
                  }}
                  type="tel"
                  autoComplete="tel"
                />
              </label>
              <label>
                {t("Email (optional)", "البريد (اختياري)")}
                <input
                  value={contact.email}
                  type="email"
                  onChange={(e) =>
                    setContact((c) => ({ ...c, email: e.target.value }))
                  }
                  autoComplete="email"
                />
              </label>
              {verification ? (
                <p>{t("Mobile verified", "تم التحقق من الجوال")}</p>
              ) : (
                <Otp
                  destination={contact.mobile}
                  t={t}
                  verified={(id, token) =>
                    setVerification({
                      verificationId: id,
                      verificationToken: token,
                    })
                  }
                />
              )}
              <button
                className="sf-primary"
                disabled={!verification || !contact.name.trim()}
                onClick={() => setStep(2)}
              >
                {t("Continue", "متابعة")}
              </button>
              <button onClick={() => setStep(0)}>
                {t("Back to cart", "العودة للسلة")}
              </button>
            </div>
          )}
          {step === 2 && (
            <form
              className="sf-form"
              onSubmit={(e) => {
                e.preventDefault();
                review();
              }}
            >
              <label>
                {t(
                  "How would you like to receive your order?",
                  "كيف ترغب في استلام طلبك؟",
                )}
                <select
                  value={fulfillment}
                  onChange={(e) => setFulfillment(e.target.value)}
                >
                  {config?.deliveryEnabled && (
                    <option value="DELIVERY">{t("Delivery", "التوصيل")}</option>
                  )}
                  {config?.pickupEnabled && (
                    <option value="PICKUP">
                      {t("Branch pickup", "الاستلام من الفرع")}
                    </option>
                  )}
                </select>
              </label>
              {fulfillment === "DELIVERY" ? (
                <>
                  <label>
                    {t("Delivery zone", "منطقة التوصيل")}
                    <select
                      required
                      value={zone}
                      onChange={(e) => setZone(e.target.value)}
                    >
                      <option value="">
                        {t("Choose a delivery zone", "اختر منطقة التوصيل")}
                      </option>
                      {config?.deliveryZones?.map((z: any) => (
                        <option key={z.id} value={z.id}>
                          {z.name} · SAR {z.fee}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("Full delivery address", "عنوان التوصيل الكامل")}
                    <textarea
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      autoComplete="street-address"
                    />
                  </label>
                </>
              ) : (
                <label>
                  {t("Pickup branch", "فرع الاستلام")}
                  <select
                    value={warehouse}
                    required
                    onChange={(e) => setWarehouse(e.target.value)}
                  >
                    <option value="">
                      {t("Choose a branch", "اختر الفرع")}
                    </option>
                    {config?.pickupLocations?.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.name} {w.name_ar}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {t("Payment method", "طريقة الدفع")}
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {config?.bankTransferEnabled!==false&&<option value="BANK_TRANSFER">
                    {t(
                      "Bank transfer — details on confirmation",
                      "تحويل بنكي — التفاصيل عند التأكيد",
                    )}
                  </option>}
                  {config?.onlinePaymentEnabled && (
                    <option value="MOYASAR">
                      {t("Card / mada", "بطاقة / مدى")}
                    </option>
                  )}
                  {account?.credit_enabled && (
                    <option value="CREDIT_TERMS">
                      {t("Approved credit terms", "شروط الائتمان المعتمدة")}
                    </option>
                  )}
                </select>
              </label>
              <label>
                {t("Coupon (optional)", "قسيمة (اختياري)")}
                <input
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value)}
                />
              </label>
              <button className="sf-primary" disabled={busy}>
                {t("Review order & total", "مراجعة الطلب والإجمالي")}
              </button>
              <button type="button" onClick={() => setStep(account ? 0 : 1)}>
                {t("Back", "رجوع")}
              </button>
            </form>
          )}
          {step === 3 && (
            <form className="sf-form" onSubmit={place}>
              {attempt && !quote ? (
                <p>
                  {t(
                    "You have an unfinished checkout. Resume it safely using the same order reference.",
                    "لديك طلب غير مكتمل. استأنفه بأمان باستخدام نفس المرجع.",
                  )}
                </p>
              ) : (
                <>
                  <div className="sf-review-lines">
                    {quote?.lines.map((l: any) => (
                      <p key={l.productId}>
                        <span>
                          {l.partNumber} × {l.quantity}
                        </span>
                        <strong>SAR {l.lineTotal}</strong>
                      </p>
                    ))}
                  </div>
                  <dl className="sf-totals">
                    {[
                      ["subtotal", t("Subtotal", "المجموع الفرعي")],
                      ["vat", t("VAT", "الضريبة")],
                      ["deliveryFee", t("Delivery", "التوصيل")],
                      ["total", t("Total to pay", "الإجمالي للدفع")],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd>SAR {quote?.totals[key]}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    {t(
                      "Review the prices above before placing your order.",
                      "راجع الأسعار أعلاه قبل تأكيد الطلب.",
                    )}
                  </p>
                </>
              )}
              {(attempt?.paymentMethod || method) === "MOYASAR" &&
                !attempt?.moyasarToken && (
                  <fieldset>
                    <legend>{t("Card details", "بيانات البطاقة")}</legend>
                    <label>
                      {t("Name on card", "الاسم على البطاقة")}
                      <input name="cardName" required autoComplete="cc-name" />
                    </label>
                    <label>
                      {t("Card number", "رقم البطاقة")}
                      <input
                        name="cardNumber"
                        required
                        inputMode="numeric"
                        autoComplete="cc-number"
                      />
                    </label>
                    <div className="sf-form-row">
                      <label>
                        {t("Month", "الشهر")}
                        <input
                          name="month"
                          type="number"
                          min="1"
                          max="12"
                          required
                          autoComplete="cc-exp-month"
                        />
                      </label>
                      <label>
                        {t("Year (YYYY)", "السنة")}
                        <input
                          name="year"
                          type="number"
                          min={new Date().getFullYear()}
                          required
                          autoComplete="cc-exp-year"
                        />
                      </label>
                      <label>
                        CVC
                        <input
                          name="cvc"
                          required
                          inputMode="numeric"
                          autoComplete="cc-csc"
                          minLength={3}
                          maxLength={4}
                        />
                      </label>
                    </div>
                  </fieldset>
                )}
              <button className="sf-primary" disabled={busy}>
                {busy
                  ? t("Processing…", "جارٍ التنفيذ…")
                  : attempt
                    ? t("Resume checkout", "استئناف الطلب")
                    : t("Place order", "تأكيد الطلب")}
              </button>
              {!attempt && (
                <button type="button" onClick={() => setStep(2)}>
                  {t("Edit delivery or payment", "تعديل التوصيل أو الدفع")}
                </button>
              )}
            </form>
          )}
        </>
      )}
    </StoreDialog>
  );
}
