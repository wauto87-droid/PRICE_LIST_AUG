"use client";
import { useEffect, useRef, useState } from "react";
import { api, setCsrf } from "@/frontend/api";
import Lookup from "@/frontend/Lookup";
import Cart from "@/frontend/Cart";
import Quotations from "@/frontend/Quotations";
import Admin from "@/frontend/Admin";
import PwaInstaller from "@/frontend/PwaInstaller";
import { appPath } from "@/shared/paths";
const emptyCart = () => ({
  customer: { name: "", number: "", mobile: "", reference: "" },
  lines: [] as any[],
});
export default function App() {
  const [lang, setLang] = useState("en"),
    [session, setSession] = useState<any>(null),
    [setup, setSetup] = useState(false),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("lookup"),
    [online, setOnline] = useState(true),
    [cart, setCart] = useState<any>(emptyCart),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [updateReady, setUpdateReady] = useState(false);
  const releaseRef = useRef("");
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  useEffect(() => {
    setLang(localStorage.getItem("amt-language") || "en");
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if (
      process.env.NODE_ENV === "production" &&
      window.isSecureContext &&
      "serviceWorker" in navigator
    )
      navigator.serviceWorker
        .register(appPath("/sw.js"), { scope: appPath("/") })
        .catch(() => {});
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("amt-language", lang);
  }, [lang]);
  async function refresh() {
    setLoading(true);
    try {
      const s = await api("auth/me");
      const nextRelease = typeof s.release === "string" ? s.release : "";
      setSession(s);
      releaseRef.current = nextRelease;
      setUpdateReady(false);
      setCsrf(s.user.csrf);
      if (s.settings.allowOfflineCache) {
        localStorage.setItem(
          "amt-offline-session",
          JSON.stringify({
            user: { ...s.user, csrf: "" },
            settings: s.settings,
          }),
        );
        const saved = localStorage.getItem("amt-draft-" + s.user.id);
        if (saved) setCart(JSON.parse(saved));
      } else {
        localStorage.removeItem("amt-offline-session");
        for (const k of Object.keys(localStorage))
          if (k.startsWith("amt-draft-") || k.startsWith("amt-products-"))
            localStorage.removeItem(k);
      }
    } catch (e) {
      if (
        !navigator.onLine ||
        e instanceof TypeError ||
        (e as any).status === 503
      ) {
        setOnline(false);
        const saved = localStorage.getItem("amt-offline-session");
        if (saved) {
          const s = JSON.parse(saved);
          setSession(s);
          const draft = localStorage.getItem("amt-draft-" + s.user.id);
          if (draft) setCart(JSON.parse(draft));
        }
      } else {
        try {
          const s = await api("setup");
          setSetup(s.required);
          if (typeof s.release === "string" && !releaseRef.current) {
            releaseRef.current = s.release;
          }
        } catch (e) {
          setError((e as Error).message);
        }
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    const lost = () => setOnline(false);
    window.addEventListener("amt-connection-lost", lost);
    const timer = setInterval(async () => {
      try {
        const r = await fetch(appPath("/api/v1/health"), {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        setOnline(r.ok && navigator.onLine);
        const data = await r.json().catch(() => null);
        const nextRelease =
          data && typeof data.release === "string" ? data.release : "";
        if (nextRelease && !releaseRef.current) {
          releaseRef.current = nextRelease;
        } else if (nextRelease && releaseRef.current !== nextRelease) {
          setUpdateReady(true);
        }
      } catch {
        setOnline(false);
      }
    }, 10000);
    return () => {
      window.removeEventListener("amt-connection-lost", lost);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const expired = () => {
      for (const k of Object.keys(localStorage))
        if (k.startsWith("amt-") && k !== "amt-language")
          localStorage.removeItem(k);
      setSession(null);
      setCart(emptyCart());
      setError(
        t(
          "Session expired. Sign in again.",
          "انتهت الجلسة. سجل الدخول مجدداً.",
        ),
      );
    };
    window.addEventListener("amt-session-expired", expired);
    return () => window.removeEventListener("amt-session-expired", expired);
  }, [lang]);
  useEffect(() => {
    if (online && session && !session.user.csrf)
      api("auth/me")
        .then((s) => {
          setSession(s);
          setCsrf(s.user.csrf);
        })
        .catch(() => window.dispatchEvent(new Event("amt-session-expired")));
  }, [online, session]);
  useEffect(() => {
    if (session?.settings.allowOfflineCache) {
      const safe = {
        ...cart,
        lines: cart.lines.map((l: any) => {
          if (!l.price) return l;
          const { maxDiscount, ...price } = l.price;
          return { ...l, price };
        }),
      };
      localStorage.setItem(
        "amt-draft-" + session.user.id,
        JSON.stringify(safe),
      );
    }
  }, [cart, session]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  async function signOut() {
    try {
      await api("auth/logout", "POST", {});
    } catch {
      if (online) return;
    }
    for (const k of Object.keys(localStorage))
      if (k.startsWith("amt-") && k !== "amt-language")
        localStorage.removeItem(k);
    setSession(null);
    setCsrf("");
    setCart(emptyCart());
  }
  function openQuote(q: any) {
    setCart({
      id: q.id,
      version: q.version,
      number: q.number,
      customer: q.customer,
      lines: q.lines,
    });
    setTab("cart");
  }
  return (
    <>
      <header className="app-header">
        <a
          className="brand"
          href={appPath("/")}
          aria-label="AMT Electric Price List"
        >
          <img src={appPath("/logo.svg")} alt="AMT Electric" />
          <span>
            <strong>
              AMT <em>ELECTRIC</em>
            </strong>
            <small>
              {t("PRICE LIST & QUOTATIONS", "قائمة الأسعار وعروض الأسعار")}
            </small>
          </span>
        </a>
        <div className="header-actions">
          <span className={"connection " + (!online ? "offline" : "")}>
            <i />
            {online ? t("Connected", "متصل") : t("OFFLINE", "دون اتصال")}
          </span>
          <PwaInstaller t={t} />
          <button
            className="language"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
          >
            {lang === "en" ? "العربية" : "English"}
          </button>
          {session && (
            <>
              <span className="user-name">{session.user.name}</span>
              <button className="link-button" onClick={signOut}>
                {t("Sign out", "خروج")}
              </button>
            </>
          )}
        </div>
      </header>
      {!online && (
        <div className="offline-banner">
          {t(
            "OFFLINE — Cached prices are not confirmed live prices. Final quotations and PDFs require a connection.",
            "دون اتصال — الأسعار المخزنة ليست مؤكدة. إصدار العروض وملفات PDF يتطلب الاتصال.",
          )}
        </div>
      )}
      {updateReady && (
        <div className="notice" role="status">
          {t(
            "A new AMT upgrade is ready. Refresh this page to load the latest version.",
            "يوجد تحديث جديد لـ AMT. قم بتحديث الصفحة لتحميل أحدث إصدار.",
          )}{" "}
          <button
            className="link-button"
            onClick={() => window.location.reload()}
          >
            {t("Refresh now", "تحديث الآن")}
          </button>
        </div>
      )}
      {loading ? (
        <main>
          <section className="card empty-state">
            {t("Opening your price desk…", "جارٍ فتح مكتب الأسعار…")}
          </section>
        </main>
      ) : !session ? (
        <main className="login-layout">
          <section className="login-intro">
            <div className="eyebrow">AMT ELECTRIC</div>
            <h1>
              {t("Your price desk.", "مكتب أسعارك.")}
              <br />
              <span>{t("Ready for business.", "جاهز للعمل.")}</span>
            </h1>
            <p>
              {t(
                "Fast part lookup. Protected pricing. Professional quotations.",
                "بحث سريع عن الأصناف. تسعير محمي. عروض أسعار احترافية.",
              )}
            </p>
            <div className="brand-rule" />
          </section>
          <form
            className="card login-card"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const form = new FormData(e.currentTarget);
              try {
                const data = Object.fromEntries(form.entries());
                await api(setup ? "setup" : "auth/login", "POST", data);
                if (setup) {
                  setSetup(false);
                  setMessage(
                    t(
                      "Setup complete. Sign in with your new account.",
                      "اكتمل الإعداد. سجل الدخول بحسابك الجديد.",
                    ),
                  );
                } else await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="eyebrow">
              {setup
                ? t("SECURE FIRST-RUN SETUP", "الإعداد الأول الآمن")
                : t("WELCOME BACK", "مرحباً بعودتك")}
            </div>
            <h2>
              {setup
                ? t("Set up AMT Electric", "إعداد AMT Electric")
                : t("Sign in to your workspace", "تسجيل الدخول")}
            </h2>
            {setup && (
              <>
                <label>
                  {t("Deployment setup token", "رمز إعداد النشر")}
                  <input
                    name="token"
                    type="password"
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  {t("Your name", "اسمك")}
                  <input name="name" required />
                </label>
                <label>
                  {t("Company name", "اسم الشركة")}
                  <input
                    name="companyName"
                    defaultValue="AMT Electric"
                    required
                  />
                </label>
              </>
            )}
            <label>
              {t("Username", "اسم المستخدم")}
              <input
                name="username"
                autoComplete="username"
                required
                minLength={3}
              />
            </label>
            <label>
              {t("Password", "كلمة المرور")}
              <input
                name="password"
                type="password"
                autoComplete={setup ? "new-password" : "current-password"}
                minLength={setup ? 4 : undefined}
                required
              />
            </label>
            {setup && (
              <p className="muted">
                {t(
                  "Use at least 4 characters. VAT and quotation prefix can be adjusted later in Admin Settings. Setup closes permanently after the administrator is created.",
                  "استخدم ٤ أحرف على الأقل. يمكن تعديل الضريبة وبادئة عرض السعر لاحقاً من إعدادات الإدارة. يغلق الإعداد بعد إنشاء المسؤول.",
                )}
              </p>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy || !online}>
              {busy
                ? t("Please wait…", "يرجى الانتظار…")
                : setup
                  ? t("Create administrator", "إنشاء المسؤول")
                  : t("Sign in →", "دخول ←")}
            </button>
            <p className="muted">
              {t(
                "Authorized AMT Electric staff only.",
                "للموظفين المصرح لهم في AMT Electric فقط.",
              )}
            </p>
          </form>
        </main>
      ) : (
        <>
          <nav
            className="main-nav"
            aria-label={t("Main navigation", "التنقل الرئيسي")}
          >
            {[
              ["lookup", "Lookup", "البحث"],
              ["cart", "Cart", "السلة"],
              ["quotations", "Quotations", "العروض"],
              ...(session.user.permissions.includes("ADMIN_VIEW")
                ? [["admin", "Admin", "الإدارة"]]
                : []),
            ].map(([key, en, ar]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {t(en, ar)}
                {key === "cart" && !!cart.lines.length && (
                  <span className="count">{cart.lines.length}</span>
                )}
              </button>
            ))}
            <div className="nav-end">
              {t("PRICE ACCURACY. EVERY TIME.", "دقة الأسعار في كل مرة.")}
            </div>
          </nav>
          <main>
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  {t("YOUR COUNTER, CONNECTED", "مكتب مبيعاتك المتصل")}
                </p>
                <h1>
                  {tab === "lookup"
                    ? t("Part lookup", "البحث عن صنف")
                    : tab === "cart"
                      ? t("Build your quotation", "إنشاء عرض السعر")
                      : tab === "admin"
                        ? t("Administration", "الإدارة")
                        : t("Your quotations", "عروض أسعارك")}
                </h1>
              </div>
              <span className="currency-tag">
                SAR <span>·</span> {t("Saudi Riyal", "ريال سعودي")}
              </span>
            </div>
            {tab === "lookup" && (
              <Lookup
                t={t}
                user={session.user}
                settings={session.settings}
                online={online}
                onAdd={(line) => {
                  setCart({ ...cart, lines: [...cart.lines, line] });
                  setMessage(t("Added to cart", "تمت الإضافة إلى السلة"));
                }}
              />
            )}
            {tab === "cart" && (
              <>
                <Cart
                  t={t}
                  cart={cart}
                  setCart={setCart}
                  online={online}
                  onSaved={(q) =>
                    setMessage(
                      t(
                        "Saved draft " + q.number,
                        "تم حفظ المسودة " + q.number,
                      ),
                    )
                  }
                />
                <div className="actions footer-actions">
                  <button onClick={() => setTab("lookup")}>
                    {t("＋ Add another item", "＋ إضافة صنف آخر")}
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          t(
                            "Start a new cart? Unsaved items will be cleared.",
                            "بدء سلة جديدة؟ ستحذف الأصناف غير المحفوظة.",
                          ),
                        )
                      )
                        setCart(emptyCart());
                    }}
                  >
                    {t("New cart", "سلة جديدة")}
                  </button>
                  <button onClick={() => setTab("quotations")}>
                    {t("Open quotations", "فتح العروض")}
                  </button>
                </div>
              </>
            )}
            {tab === "quotations" &&
              (online ? (
                <Quotations t={t} user={session.user} onOpen={openQuote} />
              ) : (
                <div className="card notice">
                  {t(
                    "Reconnect to access saved quotations.",
                    "أعد الاتصال للوصول إلى العروض المحفوظة.",
                  )}
                </div>
              ))}
            {tab === "admin" &&
              (online ? (
                <Admin t={t} user={session.user} />
              ) : (
                <div className="card notice">
                  {t(
                    "Administration requires an active connection.",
                    "الإدارة تتطلب اتصالاً نشطاً.",
                  )}
                </div>
              ))}
          </main>
        </>
      )}
      {message && (
        <div className="toast" role="status">
          ✓ {message}
        </div>
      )}
      <footer className="app-footer">
        <span>AMT ELECTRIC</span>
        <span>
          {t("Price List & Quotations", "قائمة الأسعار وعروض الأسعار")} ·{" "}
          {t("Built for your business", "مصمم لأعمالك")}
        </span>
      </footer>
    </>
  );
}
