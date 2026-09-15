"use client";
import { useEffect, useRef, useState } from "react";
import { api, setCsrf } from "@/frontend/api";
import Lookup from "@/frontend/Lookup";
import Cart from "@/frontend/Cart";
import Quotations from "@/frontend/Quotations";
import DeliveryQuoteImport from "@/frontend/DeliveryQuoteImport";
import Admin from "@/frontend/Admin";
import PwaInstaller from "@/frontend/PwaInstaller";
import ConfirmModal from "@/frontend/ConfirmModal";
import Commercial from "@/frontend/Commercial";
import MaintenanceBanner from "@/frontend/MaintenanceBanner";
import { showConfirm } from "@/frontend/confirm";
import { appPath } from "@/shared/paths";
const emptyCart = () => ({
  customer: { name: "", number: "", mobile: "", reference: "", notes: "" },
  lines: [] as any[],
});
export default function App() {
  const [lang, setLang] = useState("en"),
    [session, setSession] = useState<any>(null),
    [setup, setSetup] = useState(false),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("workspace"),
    [online, setOnline] = useState(true),
    [cart, setCart] = useState<any>(emptyCart),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [updateReady, setUpdateReady] = useState(false),
    [maintenance, setMaintenance] = useState<any>(null);
  const releaseRef = useRef("");
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  useEffect(() => {
    setLang(localStorage.getItem("amt-language") || "en");
    if(new URLSearchParams(location.search).get('commerce')==='imports')setTab('admin');
    if(new URLSearchParams(location.search).get('commerce')==='storefront')setTab('commercial');
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
      api("health/maintenance").then(setMaintenance).catch(() => {});
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
    const onMaintenanceActive = (e: any) => {
      if (e.detail) {
        setMaintenance((prev: any) => ({
          ...prev,
          workspace: e.detail,
        }));
      }
    };
    window.addEventListener("amt-maintenance-active", onMaintenanceActive);
    const timer = setInterval(async () => {
      try {
        const r = await fetch(appPath("/api/v1/health"), {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        setOnline(r.ok && navigator.onLine);
        const data = await r.json().catch(() => null);
        if (data?.maintenance) {
          setMaintenance(data.maintenance);
        }
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
    }, 2500);
    return () => {
      window.removeEventListener("amt-connection-lost", lost);
      window.removeEventListener("amt-maintenance-active", onMaintenanceActive);
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
    setTab("draft");
  }
  const compactWorkspace = !!session && tab === "workspace";

  const isMaintenanceAdmin =
    session?.user?.permissions?.includes("ADMIN_VIEW") ||
    session?.user?.permissions?.includes("SETTINGS_MANAGE");

  if (session && maintenance?.workspace?.enabled && !isMaintenanceAdmin) {
    return (
      <MaintenanceBanner
        title={t("System Maintenance", "صيانة النظام")}
        text={maintenance.workspace.text}
        image={maintenance.workspace.image}
        whatsappNumber={maintenance.workspace.whatsappNumber}
        supportMobile={maintenance.workspace.supportMobile || session?.settings?.supportMobile}
      />
    );
  }

  return (
    <>
      <header
        className={
          "app-header" + (compactWorkspace ? " workspace-compact-header" : "")
        }
      >
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
            {maintenance?.workspace?.enabled && (
              <div className="notice" role="alert" style={{ marginBottom: 16 }}>
                <strong>
                  {t(
                    "System Maintenance Active",
                    "وضع صيانة النظام قيد التشغيل",
                  )}
                </strong>
                <p style={{ margin: "4px 0 0 0", fontSize: 13 }}>
                  {maintenance?.workspace?.text ||
                    t(
                      "Staff catalog and quotation operations are temporarily suspended. Only system administrators can sign in to manage settings.",
                      "عمليات الكتالوج وعروض الأسعار معلقة مؤقتاً. تسجيل الدخول متاح للمسؤولين فقط لإدارة النظام.",
                    )}
                </p>
              </div>
            )}
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
            className={
              "main-nav" + (compactWorkspace ? " workspace-compact-nav" : "")
            }
            aria-label={t("Main navigation", "التنقل الرئيسي")}
          >
            {[
              ["workspace", "Workspace", "مساحة العمل"],
              ["draft", "Quotation", "عرض السعر"],
              ["delivery", "Delivery note to quotation", "إذن التسليم إلى عرض سعر"],
              ["quotations", "Quotations", "العروض"],
              ...(session.user.permissions.includes("COMMERCIAL_VIEW")
                ? [["commercial", "Commercial", "التجاري"]]
                : []),
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
                {key === "draft" && !!cart.lines.length && (
                  <span className="count">{cart.lines.length}</span>
                )}
              </button>
            ))}
            <div className="nav-end">
              {t("PRICE ACCURACY. EVERY TIME.", "دقة الأسعار في كل مرة.")}
            </div>
          </nav>
          <main className={compactWorkspace ? "workspace-compact-main" : ""}>
            <div
              className={
                "page-heading" +
                (compactWorkspace ? " workspace-compact-heading" : "")
              }
            >
              <div>
                <p className="eyebrow">
                  {t("YOUR COUNTER, CONNECTED", "مكتب مبيعاتك المتصل")}
                </p>
                <h1>
                  {tab === "workspace"
                    ? t("Catalog workspace", "مساحة الكتالوج")
                    : tab === "draft"
                      ? t("Current quotation", "عرض السعر الحالي")
                      : tab === "delivery"
                        ? t(
                            "Delivery note to quotation",
                            "إذن التسليم إلى عرض سعر",
                          )
                      : tab === "commercial"
                        ? t("Commercial operations", "العمليات التجارية")
                      : tab === "admin"
                        ? t("Administration", "الإدارة")
                        : t("Your quotations", "عروض أسعارك")}
                </h1>
              </div>
              <span className="currency-tag">
                SAR <span>·</span> {t("Saudi Riyal", "ريال سعودي")}
              </span>
            </div>
            {tab === "workspace" && (
              <div className="workspace-search-only">
                <Lookup
                  t={t}
                  user={session.user}
                  settings={session.settings}
                  online={online}
                  onAdd={(line) => {
                    setCart({ ...cart, lines: [...cart.lines, line] });
                    setMessage(
                      t("Added to quotation", "تمت الإضافة إلى عرض السعر"),
                    );
                  }}
                />
              </div>
            )}
            {tab === "draft" && (
              <div className="workspace-side">
                <Cart
                  t={t}
                  user={session.user}
                  cart={cart}
                  setCart={setCart}
                  settings={session.settings}
                  online={online}
                  onSaved={(q) =>
                    setMessage(
                      t(
                        "Saved quotation " + q.number,
                        "تم حفظ عرض السعر " + q.number,
                      ),
                    )
                  }
                  onTemplates={() => setTab("quotations")}
                />
                <div className="actions footer-actions">
                  <button
                    onClick={async () => {
                      if (
                        await showConfirm(
                          t(
                            "Start a new quotation? Unsaved items will be cleared.",
                            "بدء عرض سعر جديد؟ ستحذف الأصناف غير المحفوظة.",
                          ),
                        )
                      )
                        setCart(emptyCart());
                    }}
                  >
                    {t("New quotation", "عرض سعر جديد")}
                  </button>
                  <button onClick={() => setTab("quotations")}>
                    {t("Open saved quotations", "فتح العروض المحفوظة")}
                  </button>
                </div>
              </div>
            )}
            {tab === "delivery" &&
              (online ? (
                <DeliveryQuoteImport
                  t={t}
                  user={session.user}
                  online={online}
                  onImported={(q) => {
                    setCart({
                      id: q.id,
                      version: q.version,
                      number: q.number,
                      customer: q.customer,
                      lines: q.lines,
                    });
                    setTab("draft");
                    setMessage(
                      t(
                        "Delivery note imported into the current quotation.",
                        "تم استيراد إذن التسليم إلى عرض السعر الحالي.",
                      ),
                    );
                  }}
                />
              ) : (
                <div className="card notice">
                  {t(
                    "Reconnect to upload or review delivery-note quotation files.",
                    "أعد الاتصال لرفع أو مراجعة ملفات عروض أسعار أذونات التسليم.",
                  )}
                </div>
              ))}
            {tab === "quotations" &&
              (online ? (
                <Quotations
                  t={t}
                  user={session.user}
                  onOpen={openQuote}
                  cart={cart}
                  onUseTemplate={(next, warning) => {
                    setCart(next);
                    setTab("draft");
                    setMessage(
                      warning ||
                        t(
                          "Template loaded into a new quotation.",
                          "تم تحميل القالب في عرض سعر جديد.",
                        ),
                    );
                  }}
                />
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
            {tab === "commercial" &&
              (online ? (
                <Commercial t={t} user={session.user} />
              ) : (
                <div className="card notice">
                  {t("Commercial operations require an active connection.", "العمليات التجارية تتطلب اتصالاً نشطاً.")}
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
      <ConfirmModal t={t} />
      <footer
        className={
          "app-footer" +
          (compactWorkspace ? " workspace-compact-footer" : "")
        }
      >
        <span>AMT ELECTRIC</span>
        <span>
          {t("Price List & Quotations", "قائمة الأسعار وعروض الأسعار")} ·{" "}
          {t("Built for your business", "مصمم لأعمالك")}
        </span>
      </footer>
    </>
  );
}
