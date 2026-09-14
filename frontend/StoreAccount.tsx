"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Translate } from "./api";
import { Otp, StoreDialog } from "./StorefrontCheckout";

function AccountIcon({
  name,
  className = "",
}: {
  name:
    | "user"
    | "orders"
    | "shield"
    | "lock"
    | "copy"
    | "check"
    | "chevron-down"
    | "chevron-up"
    | "eye"
    | "eye-off"
    | "external"
    | "tag"
    | "credit"
    | "building"
    | "logout"
    | "package"
    | "truck"
    | "store";
  className?: string;
}) {
  switch (name) {
    case "user":
      return (
        <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "orders":
      return (
        <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      );
    case "shield":
      return (
        <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "lock":
      return (
        <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case "copy":
      return (
        <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      );
    case "check":
      return (
        <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case "chevron-up":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      );
    case "eye":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "eye-off":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </svg>
      );
    case "external":
      return (
        <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" x2="21" y1="14" y2="3" />
        </svg>
      );
    case "tag":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z" />
          <path d="M7 7h.01" />
        </svg>
      );
    case "credit":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="20" height="14" x="2" y="5" rx="2" />
          <line x1="2" x2="22" y1="10" y2="10" />
        </svg>
      );
    case "building":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
          <path d="M9 22v-4h6v4" />
          <path d="M8 6h.01" />
          <path d="M16 6h.01" />
          <path d="M8 10h.01" />
          <path d="M16 10h.01" />
          <path d="M8 14h.01" />
          <path d="M16 14h.01" />
        </svg>
      );
    case "logout":
      return (
        <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" x2="9" y1="12" y2="12" />
        </svg>
      );
    case "package":
      return (
        <svg className={className} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7.5 4.27 9 5.15" />
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      );
    case "truck":
      return (
        <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
          <path d="M15 18H9" />
          <path d="M19 18h2a1 1 0 0 0 1-1v-5l-3-4h-5v10h1" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </svg>
      );
    case "store":
      return (
        <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
          <path d="M2 7h20" />
        </svg>
      );
  }
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
  const [activeTab, setActiveTab] = useState<"overview" | "orders" | "security">("overview");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginMethod, setLoginMethod] = useState<"OTP" | "PASSWORD">("OTP");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [accountType, setAccountType] = useState("RETAIL");
  const [verification, setVerification] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Orders State
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderFilter, setOrderFilter] = useState<"ALL" | "CONFIRMED" | "PENDING" | "CANCELLED">("ALL");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Security / Password State
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  // Copy Feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (account && !ordersLoaded && !ordersLoading) {
      setOrdersLoading(true);
      api("storefront/account/orders", "GET")
        .then((res) => {
          setOrders(res || []);
          setOrdersLoaded(true);
        })
        .catch((e) => setError(e.message))
        .finally(() => setOrdersLoading(false));
    }
  }, [account, ordersLoaded, ordersLoading]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const initials = useMemo(() => {
    const name = account?.name || account?.company_name || account?.email || "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }, [account]);

  const filteredOrders = useMemo(() => {
    if (orderFilter === "ALL") return orders;
    if (orderFilter === "CONFIRMED")
      return orders.filter((o) => o.status === "CONFIRMED" || o.status === "DELIVERED");
    if (orderFilter === "PENDING")
      return orders.filter((o) => o.status?.startsWith("PENDING"));
    if (orderFilter === "CANCELLED")
      return orders.filter((o) => o.status === "CANCELLED" || o.status === "FAILED");
    return orders;
  }, [orders, orderFilter]);

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (passwordForm.newPassword.length < 8) {
      setPasswordError(
        t("New password must be at least 8 characters.", "يجب أن تكون كلمة المرور الجديدة 8 أحرف على الأقل."),
      );
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError(
        t("New passwords do not match.", "كلمتا المرور الجديدتان غير متطابقتين."),
      );
      return;
    }

    setBusy(true);
    try {
      await api("storefront/account/password", "POST", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordSuccess(
        t("Your password has been changed successfully.", "تم تحديث كلمة المرور بنجاح."),
      );
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err: any) {
      setPasswordError(err.message || t("Failed to change password.", "فشل تغيير كلمة المرور."));
    } finally {
      setBusy(false);
    }
  }

  async function handleAuthSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const f = new FormData(e.currentTarget);
      if (mode === "login") {
        await api(
          loginMethod === "OTP" ? "storefront/account/login-otp" : "storefront/account/login",
          "POST",
          loginMethod === "OTP"
            ? { mobile, ...verification }
            : { login: f.get("login"), password: f.get("password") },
        );
        const me = await api("storefront/account/me");
        changed(me.account);
        close();
      } else {
        const file = f.get("supportingDocument");
        let supportingDocument;
        if (file instanceof File && file.size) {
          if (file.size > 1024 * 1024)
            throw new Error(t("Use a PDF up to 1 MB", "استخدم PDF بحجم أقصى 1 ميغابايت"));
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
          invitationToken: new URLSearchParams(location.search).get("invitation") || undefined,
          password: f.get("password"),
          ...verification,
        });
        setMessage(
          t(
            "Account created successfully. Company purchasing, if requested, requires AMT approval.",
            "تم إنشاء الحساب بنجاح. تفعيل مشتريات الشركات يتطلب اعتماد AMT.",
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
    <StoreDialog
      title={account ? t("Customer Account", "إدارة الحساب") : t("Sign In or Register", "تسجيل الدخول أو فتح حساب")}
      close={close}
      className="sf-dialog-wide"
    >
      {error && (
        <div className="sf-acc-alert sf-acc-alert-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss">×</button>
        </div>
      )}
      {message && (
        <div className="sf-acc-alert sf-acc-alert-success" role="status">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage("")} aria-label="Dismiss">×</button>
        </div>
      )}

      {account ? (
        <div className="sf-acc-shell">
          {/* Header Profile Hero (Codex-inspired) */}
          <div className="sf-acc-header">
            <div className="sf-acc-identity">
              <div className="sf-acc-avatar" aria-hidden="true">
                {initials}
              </div>
              <div className="sf-acc-meta">
                <div className="sf-acc-name-row">
                  <h3 className="sf-acc-name">
                    {account.name || account.company_name || account.email}
                  </h3>
                  <span className="sf-acc-chip sf-acc-chip-success">
                    <span className="sf-acc-dot" />
                    {t("Active Customer", "حساب نشط")}
                  </span>
                  {account.company_id && (
                    <span className="sf-acc-chip sf-acc-chip-neutral">
                      <AccountIcon name="building" />
                      {account.company_role || t("Company", "شركة")}
                    </span>
                  )}
                </div>

                <div className="sf-acc-badges-row">
                  <span className="sf-acc-subtext">{account.email}</span>
                  {account.mobile && (
                    <>
                      <span className="sf-acc-divider">•</span>
                      <span className="sf-acc-subtext">{account.mobile}</span>
                    </>
                  )}
                  {account.number && (
                    <>
                      <span className="sf-acc-divider">•</span>
                      <button
                        type="button"
                        className="sf-acc-code-badge"
                        onClick={() => copyToClipboard(account.number, "code")}
                        title={t("Copy Customer Code", "نسخ رمز العميل")}
                      >
                        <code>#{account.number}</code>
                        <AccountIcon name={copiedKey === "code" ? "check" : "copy"} />
                        {copiedKey === "code" && (
                          <span className="sf-acc-copied-hint">{t("Copied", "تم النسخ")}</span>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="sf-acc-logout-btn"
              disabled={busy}
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
              <AccountIcon name="logout" />
              <span>{t("Sign out", "تسجيل الخروج")}</span>
            </button>
          </div>

          {/* Segmented Codex-Grade Tabs Navigation */}
          <nav className="sf-acc-nav" aria-label="Account Tabs">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`sf-acc-nav-tab ${activeTab === "overview" ? "active" : ""}`}
            >
              <AccountIcon name="user" />
              <span>{t("Overview & Profile", "نظرة عامة والملف")}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              className={`sf-acc-nav-tab ${activeTab === "orders" ? "active" : ""}`}
            >
              <AccountIcon name="orders" />
              <span>{t("Orders & Purchases", "سجل الطلبات")}</span>
              {orders.length > 0 && <span className="sf-acc-count-pill">{orders.length}</span>}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("security")}
              className={`sf-acc-nav-tab ${activeTab === "security" ? "active" : ""}`}
            >
              <AccountIcon name="shield" />
              <span>{t("Security & Credentials", "الأمان وتغيير كلمة المرور")}</span>
            </button>
          </nav>

          {/* TAB 1: OVERVIEW & PROFILE */}
          {activeTab === "overview" && (
            <div className="sf-acc-tab-content">
              {/* Stat Metric Grid */}
              <div className="sf-acc-grid-stats">
                <div className="sf-acc-stat-card">
                  <div className="sf-acc-stat-icon">
                    <AccountIcon name="tag" />
                  </div>
                  <div className="sf-acc-stat-content">
                    <span className="sf-acc-stat-label">{t("Price Level", "مستوى السعر")}</span>
                    <strong className="sf-acc-stat-value">
                      {account.price_level === "WHOLESALE"
                        ? t("Wholesale", "سعر الجملة")
                        : account.price_level === "END_CUSTOMER"
                          ? t("End Customer", "سعر العميل النهائي")
                          : t("Standard Retail", "سعر التجزئة")}
                    </strong>
                    <small className="sf-acc-stat-desc">
                      {t("Applied to eligible catalog items", "يطبق على المنتجات المؤهلة")}
                    </small>
                  </div>
                </div>

                <div className="sf-acc-stat-card">
                  <div className="sf-acc-stat-icon">
                    <AccountIcon name="credit" />
                  </div>
                  <div className="sf-acc-stat-content">
                    <span className="sf-acc-stat-label">{t("Payment Terms", "شروط الدفع")}</span>
                    <strong className="sf-acc-stat-value">
                      {account.credit_enabled
                        ? t("Credit Terms Enabled", "تسهيلات ائتمانية مفعلة")
                        : t("Pay Per Order", "الدفع عند الطلب")}
                    </strong>
                    <small className="sf-acc-stat-desc">
                      {account.credit_enabled && account.credit_limit
                        ? `${t("Limit", "الحد")}: ${account.credit_limit} SAR`
                        : t("Cards & Electronic transfers", "بطاقات ومدفوعات فورية")}
                    </small>
                  </div>
                </div>

                <div className="sf-acc-stat-card">
                  <div className="sf-acc-stat-icon">
                    <AccountIcon name="orders" />
                  </div>
                  <div className="sf-acc-stat-content">
                    <span className="sf-acc-stat-label">{t("Order History", "إجمالي الطلبات")}</span>
                    <strong className="sf-acc-stat-value">
                      {orders.length} {orders.length === 1 ? t("Order", "طلب") : t("Orders", "طلبات")}
                    </strong>
                    <button
                      type="button"
                      className="sf-acc-stat-link"
                      onClick={() => setActiveTab("orders")}
                    >
                      {t("View all orders →", "استعراض كافة الطلبات ←")}
                    </button>
                  </div>
                </div>

                <div className="sf-acc-stat-card">
                  <div className="sf-acc-stat-icon">
                    <AccountIcon name="shield" />
                  </div>
                  <div className="sf-acc-stat-content">
                    <span className="sf-acc-stat-label">{t("Account Security", "حالة الأمان")}</span>
                    <strong className="sf-acc-stat-value">{t("Protected", "محمي وموثق")}</strong>
                    <button
                      type="button"
                      className="sf-acc-stat-link"
                      onClick={() => setActiveTab("security")}
                    >
                      {t("Manage password →", "إدارة كلمة المرور ←")}
                    </button>
                  </div>
                </div>
              </div>

              {/* Profile Details & Company Info Cards */}
              <div className="sf-acc-sections-grid">
                <div className="sf-acc-card">
                  <div className="sf-acc-card-header">
                    <h4 className="sf-acc-card-title">{t("Personal & Account Details", "بيانات الحساب الشخصية")}</h4>
                  </div>
                  <div className="sf-acc-kv-list">
                    <div className="sf-acc-kv-row">
                      <span className="sf-acc-k">{t("Full Name", "الاسم الكامل")}</span>
                      <span className="sf-acc-v">{account.name || t("Not specified", "غير محدد")}</span>
                    </div>
                    <div className="sf-acc-kv-row">
                      <span className="sf-acc-k">{t("Email Address", "البريد الإلكتروني")}</span>
                      <span className="sf-acc-v">{account.email}</span>
                    </div>
                    <div className="sf-acc-kv-row">
                      <span className="sf-acc-k">{t("Mobile Number", "رقم الجوال")}</span>
                      <span className="sf-acc-v">{account.mobile || t("Not specified", "غير محدد")}</span>
                    </div>
                    <div className="sf-acc-kv-row">
                      <span className="sf-acc-k">{t("Customer Reference", "الرقم المرجعي للعميل")}</span>
                      <span className="sf-acc-v font-mono">{account.number || account.id?.slice(0, 8)}</span>
                    </div>
                    {account.created_at && (
                      <div className="sf-acc-kv-row">
                        <span className="sf-acc-k">{t("Member Since", "عضو منذ")}</span>
                        <span className="sf-acc-v">{new Date(account.created_at).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                </div>

                {account.company_id ? (
                  <div className="sf-acc-card">
                    <div className="sf-acc-card-header">
                      <h4 className="sf-acc-card-title">{t("Company Profile", "بيانات المنشأة / الشركة")}</h4>
                    </div>
                    <div className="sf-acc-kv-list">
                      <div className="sf-acc-kv-row">
                        <span className="sf-acc-k">{t("Company Name", "اسم الشركة")}</span>
                        <span className="sf-acc-v">{account.company_name || account.name}</span>
                      </div>
                      {account.company_profile?.registrationNumber && (
                        <div className="sf-acc-kv-row">
                          <span className="sf-acc-k">{t("Commercial Registration (CR)", "السجل التجاري")}</span>
                          <span className="sf-acc-v font-mono">{account.company_profile.registrationNumber}</span>
                        </div>
                      )}
                      {account.company_profile?.taxNumber && (
                        <div className="sf-acc-kv-row">
                          <span className="sf-acc-k">{t("Tax / VAT Number", "الرقم الضريبي")}</span>
                          <span className="sf-acc-v font-mono">{account.company_profile.taxNumber}</span>
                        </div>
                      )}
                      {account.company_profile?.contactPerson && (
                        <div className="sf-acc-kv-row">
                          <span className="sf-acc-k">{t("Contact Person", "الشخص المسؤول")}</span>
                          <span className="sf-acc-v">{account.company_profile.contactPerson}</span>
                        </div>
                      )}
                      {account.company_profile?.address && (
                        <div className="sf-acc-kv-row">
                          <span className="sf-acc-k">{t("Registered Address", "العنوان المسجل")}</span>
                          <span className="sf-acc-v">{account.company_profile.address}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="sf-acc-card sf-acc-card-cta">
                    <div className="sf-acc-card-header">
                      <h4 className="sf-acc-card-title">{t("Quick Actions & Portals", "روابط وإجراءات سريعة")}</h4>
                    </div>
                    <p className="sf-acc-card-subtext">
                      {t(
                        "Manage your order tracking receipts and access quotation tools.",
                        "تتبع إيصالات الطلبات والوصول لأدوات الأسعار والشركات.",
                      )}
                    </p>
                    <div className="sf-acc-action-buttons">
                      <button
                        type="button"
                        className="sf-acc-btn sf-acc-btn-secondary"
                        onClick={() => {
                          close();
                          navigate?.("receipts");
                        }}
                      >
                        <AccountIcon name="external" />
                        <span>{t("Track Orders (Receipts)", "تتبع طلباتك (الإيصالات)")}</span>
                      </button>
                      {config?.businessEnabled && (
                        <button
                          type="button"
                          className="sf-acc-btn sf-acc-btn-secondary"
                          onClick={() => {
                            close();
                            navigate?.("business");
                          }}
                        >
                          <AccountIcon name="building" />
                          <span>{t("Company Portal · Request Best Price", "بوابة الشركات · طلب تسعيرة")}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: ORDERS & PURCHASES */}
          {activeTab === "orders" && (
            <div className="sf-acc-tab-content">
              <div className="sf-acc-orders-toolbar">
                <div className="sf-acc-filter-chips">
                  <button
                    type="button"
                    className={`sf-acc-filter-chip ${orderFilter === "ALL" ? "active" : ""}`}
                    onClick={() => setOrderFilter("ALL")}
                  >
                    {t("All Orders", "كافة الطلبات")} ({orders.length})
                  </button>
                  <button
                    type="button"
                    className={`sf-acc-filter-chip ${orderFilter === "CONFIRMED" ? "active" : ""}`}
                    onClick={() => setOrderFilter("CONFIRMED")}
                  >
                    {t("Confirmed", "مؤكدة")}
                  </button>
                  <button
                    type="button"
                    className={`sf-acc-filter-chip ${orderFilter === "PENDING" ? "active" : ""}`}
                    onClick={() => setOrderFilter("PENDING")}
                  >
                    {t("Pending", "قيد المعالجة")}
                  </button>
                  <button
                    type="button"
                    className={`sf-acc-filter-chip ${orderFilter === "CANCELLED" ? "active" : ""}`}
                    onClick={() => setOrderFilter("CANCELLED")}
                  >
                    {t("Cancelled", "ملغاة")}
                  </button>
                </div>

                <button
                  type="button"
                  className="sf-acc-btn sf-acc-btn-ghost sf-acc-btn-sm"
                  onClick={() => {
                    close();
                    navigate?.("receipts");
                  }}
                >
                  <AccountIcon name="external" />
                  <span>{t("Receipts Tracker", "أرشيف الإيصالات")}</span>
                </button>
              </div>

              {ordersLoading ? (
                <div className="sf-acc-loading-state">
                  <div className="sf-acc-spinner" />
                  <p>{t("Loading your order history...", "جاري تحميل سجل طلباتك...")}</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="sf-acc-empty-state">
                  <div className="sf-acc-empty-icon">
                    <AccountIcon name="package" />
                  </div>
                  <h4>{t("No orders found", "لم يتم العثور على طلبات")}</h4>
                  <p>
                    {orderFilter === "ALL"
                      ? t(
                          "You haven't placed any orders yet. Browse our catalog and check out with ease.",
                          "لم تقم بإنشاء أي طلبات حتى الآن. استعرض الكتالوج وأتمم طلباتك بكل سهولة.",
                        )
                      : t("No orders match the selected filter.", "لا توجد طلبات تطابق التصنيف المختار.")}
                  </p>
                  <button type="button" className="sf-acc-btn sf-acc-btn-primary" onClick={close}>
                    {t("Browse Catalog", "تصفح المنتجات")}
                  </button>
                </div>
              ) : (
                <div className="sf-acc-orders-list">
                  {filteredOrders.map((order) => {
                    const isExpanded = expandedOrder === order.id;
                    const orderTotal = order.totals?.total
                      ? `${Number(order.totals.total).toFixed(2)} ${order.totals.currency || "SAR"}`
                      : "-";
                    const isConfirmed = order.status === "CONFIRMED" || order.status === "DELIVERED";
                    const isPending = order.status?.startsWith("PENDING");
                    const isCancelled = order.status === "CANCELLED" || order.status === "FAILED";

                    return (
                      <div key={order.id} className={`sf-acc-order-item ${isExpanded ? "expanded" : ""}`}>
                        <div
                          className="sf-acc-order-header-row"
                          onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setExpandedOrder(isExpanded ? null : order.id);
                            }
                          }}
                        >
                          <div className="sf-acc-order-main-col">
                            <div className="sf-acc-order-num-row">
                              <span className="sf-acc-order-num">#{order.number}</span>
                              <button
                                type="button"
                                className="sf-acc-icon-btn"
                                title={t("Copy order number", "نسخ رقم الطلب")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(order.number, order.id);
                                }}
                              >
                                <AccountIcon name={copiedKey === order.id ? "check" : "copy"} />
                              </button>
                              {copiedKey === order.id && (
                                <span className="sf-acc-copied-hint">{t("Copied", "تم النسخ")}</span>
                              )}
                            </div>
                            <span className="sf-acc-order-date">
                              {new Date(order.created_at).toLocaleDateString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>

                          <div className="sf-acc-order-meta-col">
                            {order.fulfillment_method && (
                              <span className="sf-acc-badge sf-acc-badge-neutral">
                                <AccountIcon
                                  name={order.fulfillment_method === "DELIVERY" ? "truck" : "store"}
                                />
                                {order.fulfillment_method === "DELIVERY"
                                  ? t("Delivery", "توصيل")
                                  : t("Store Pickup", "استلام من الفرع")}
                              </span>
                            )}
                            <span
                              className={`sf-acc-badge ${
                                isConfirmed
                                  ? "sf-acc-badge-success"
                                  : isPending
                                    ? "sf-acc-badge-warning"
                                    : isCancelled
                                      ? "sf-acc-badge-danger"
                                      : "sf-acc-badge-neutral"
                              }`}
                            >
                              {order.status}
                            </span>
                          </div>

                          <div className="sf-acc-order-total-col">
                            <span className="sf-acc-order-price">{orderTotal}</span>
                            <span className="sf-acc-chevron">
                              <AccountIcon name={isExpanded ? "chevron-up" : "chevron-down"} />
                            </span>
                          </div>
                        </div>

                        {/* Expandable Order Detail Accordion */}
                        {isExpanded && (
                          <div className="sf-acc-order-drawer">
                            {order.lines && order.lines.length > 0 ? (
                              <div className="sf-acc-order-lines-table-wrap">
                                <table className="sf-acc-order-lines-table">
                                  <thead>
                                    <tr>
                                      <th>{t("Item", "المنتج")}</th>
                                      <th>{t("Qty", "الكمية")}</th>
                                      <th>{t("Unit Price", "سعر الوحدة")}</th>
                                      <th>{t("Total", "الإجمالي")}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {order.lines.map((line: any, idx: number) => (
                                      <tr key={idx}>
                                        <td>
                                          <div className="sf-acc-line-title">
                                            <strong>{line.part_number || line.productId}</strong>
                                            {line.description && <small>{line.description}</small>}
                                          </div>
                                        </td>
                                        <td>{line.quantity}</td>
                                        <td>
                                          {Number(line.price?.unitPrice || 0).toFixed(2)}{" "}
                                          {order.totals?.currency || "SAR"}
                                        </td>
                                        <td>
                                          <strong>
                                            {Number(line.price?.total || (line.price?.unitPrice || 0) * (line.quantity || 1)).toFixed(2)}{" "}
                                            {order.totals?.currency || "SAR"}
                                          </strong>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="sf-acc-empty-lines">
                                {t(
                                  "Detailed item list can be tracked via your digital receipt.",
                                  "يمكن الاطلاع على تفاصيل الأصناف عبر الإيصال الرقمي.",
                                )}
                              </p>
                            )}

                            {order.totals && (
                              <div className="sf-acc-order-summary-box">
                                {order.totals.subtotal && (
                                  <div className="sf-acc-summary-row">
                                    <span>{t("Subtotal", "المجموع الفرعي")}</span>
                                    <span>
                                      {Number(order.totals.subtotal).toFixed(2)} {order.totals.currency || "SAR"}
                                    </span>
                                  </div>
                                )}
                                {order.totals.tax && (
                                  <div className="sf-acc-summary-row">
                                    <span>{t("VAT (15%)", "ضريبة القيمة المضافة (15%)")}</span>
                                    <span>
                                      {Number(order.totals.tax).toFixed(2)} {order.totals.currency || "SAR"}
                                    </span>
                                  </div>
                                )}
                                {order.totals.deliveryFee && (
                                  <div className="sf-acc-summary-row">
                                    <span>{t("Delivery Fee", "رسوم التوصيل")}</span>
                                    <span>
                                      {Number(order.totals.deliveryFee).toFixed(2)} {order.totals.currency || "SAR"}
                                    </span>
                                  </div>
                                )}
                                <div className="sf-acc-summary-row sf-acc-summary-total">
                                  <strong>{t("Grand Total", "الإجمالي الكلي")}</strong>
                                  <strong>
                                    {Number(order.totals.total).toFixed(2)} {order.totals.currency || "SAR"}
                                  </strong>
                                </div>
                              </div>
                            )}

                            <div className="sf-acc-drawer-actions">
                              <button
                                type="button"
                                className="sf-acc-btn sf-acc-btn-secondary sf-acc-btn-sm"
                                onClick={() => {
                                  close();
                                  navigate?.("receipts");
                                }}
                              >
                                <AccountIcon name="external" />
                                <span>{t("Open in Receipts Tracker", "عرض في شاشة الإيصالات")}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SECURITY & PASSWORD (Dedicated section, NOT under orders!) */}
          {activeTab === "security" && (
            <div className="sf-acc-tab-content">
              <div className="sf-acc-security-shell">
                <div className="sf-acc-card sf-acc-security-card">
                  <div className="sf-acc-security-intro">
                    <div className="sf-acc-security-shield-icon">
                      <AccountIcon name="lock" />
                    </div>
                    <div>
                      <h4 className="sf-acc-card-title">{t("Change Account Password", "تغيير كلمة المرور")}</h4>
                      <p className="sf-acc-card-subtext">
                        {t(
                          "Ensure your account is protected with a strong password of at least 8 characters.",
                          "احرص على حماية حسابك بكلمة مرور قوية لا تقل عن 8 أحرف.",
                        )}
                      </p>
                    </div>
                  </div>

                  {passwordSuccess && (
                    <div className="sf-acc-alert sf-acc-alert-success" role="status">
                      <AccountIcon name="check" />
                      <span>{passwordSuccess}</span>
                    </div>
                  )}
                  {passwordError && (
                    <div className="sf-acc-alert sf-acc-alert-error" role="alert">
                      <span>{passwordError}</span>
                    </div>
                  )}

                  <form className="sf-acc-form" onSubmit={handlePasswordSubmit}>
                    <div className="sf-acc-field">
                      <label htmlFor="sf-current-password">
                        {t("Current Password", "كلمة المرور الحالية")}
                      </label>
                      <div className="sf-acc-input-wrap">
                        <input
                          id="sf-current-password"
                          type={showCurrentPassword ? "text" : "password"}
                          required
                          value={passwordForm.currentPassword}
                          onChange={(e) =>
                            setPasswordForm((prev) => ({ ...prev, currentPassword: e.target.value }))
                          }
                          autoComplete="current-password"
                          placeholder={t("Enter your current password", "أدخل كلمة المرور الحالية")}
                        />
                        <button
                          type="button"
                          className="sf-acc-pw-toggle"
                          onClick={() => setShowCurrentPassword((s) => !s)}
                          aria-label={showCurrentPassword ? "Hide password" : "Show password"}
                        >
                          <AccountIcon name={showCurrentPassword ? "eye-off" : "eye"} />
                        </button>
                      </div>
                    </div>

                    <div className="sf-acc-field">
                      <label htmlFor="sf-new-password">
                        {t("New Password", "كلمة المرور الجديدة")}
                      </label>
                      <div className="sf-acc-input-wrap">
                        <input
                          id="sf-new-password"
                          type={showNewPassword ? "text" : "password"}
                          required
                          minLength={8}
                          value={passwordForm.newPassword}
                          onChange={(e) =>
                            setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))
                          }
                          autoComplete="new-password"
                          placeholder={t("At least 8 characters", "8 أحرف على الأقل")}
                        />
                        <button
                          type="button"
                          className="sf-acc-pw-toggle"
                          onClick={() => setShowNewPassword((s) => !s)}
                          aria-label={showNewPassword ? "Hide password" : "Show password"}
                        >
                          <AccountIcon name={showNewPassword ? "eye-off" : "eye"} />
                        </button>
                      </div>
                      <div className="sf-acc-pw-reqs">
                        <span
                          className={`sf-acc-req-item ${
                            passwordForm.newPassword.length >= 8 ? "met" : ""
                          }`}
                        >
                          <AccountIcon name="check" />
                          {t("Minimum 8 characters", "8 أحرف كحد أدنى")}
                        </span>
                      </div>
                    </div>

                    <div className="sf-acc-field">
                      <label htmlFor="sf-confirm-password">
                        {t("Confirm New Password", "تأكيد كلمة المرور الجديدة")}
                      </label>
                      <div className="sf-acc-input-wrap">
                        <input
                          id="sf-confirm-password"
                          type={showConfirmPassword ? "text" : "password"}
                          required
                          minLength={8}
                          value={passwordForm.confirmPassword}
                          onChange={(e) =>
                            setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                          }
                          autoComplete="new-password"
                          placeholder={t("Re-type your new password", "أعد كتابة كلمة المرور")}
                        />
                        <button
                          type="button"
                          className="sf-acc-pw-toggle"
                          onClick={() => setShowConfirmPassword((s) => !s)}
                          aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                        >
                          <AccountIcon name={showConfirmPassword ? "eye-off" : "eye"} />
                        </button>
                      </div>
                      {passwordForm.confirmPassword.length > 0 && (
                        <div className="sf-acc-pw-reqs">
                          <span
                            className={`sf-acc-req-item ${
                              passwordForm.newPassword === passwordForm.confirmPassword ? "met" : "unmet"
                            }`}
                          >
                            <AccountIcon name="check" />
                            {passwordForm.newPassword === passwordForm.confirmPassword
                              ? t("Passwords match", "كلمتا المرور متطابقتان")
                              : t("Passwords do not match", "كلمتا المرور غير متطابقتين")}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="sf-acc-form-actions">
                      <button
                        type="submit"
                        className="sf-acc-btn sf-acc-btn-primary"
                        disabled={
                          busy ||
                          passwordForm.newPassword.length < 8 ||
                          passwordForm.newPassword !== passwordForm.confirmPassword ||
                          !passwordForm.currentPassword
                        }
                      >
                        {busy ? (
                          <>
                            <span className="sf-acc-spinner-sm" />
                            <span>{t("Updating...", "جاري التحديث...")}</span>
                          </>
                        ) : (
                          <>
                            <AccountIcon name="lock" />
                            <span>{t("Update Password", "حفظ كلمة المرور")}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* LOGGED OUT: High-End Auth Portal */
        <div className="sf-acc-auth-shell">
          <div className="sf-acc-auth-nav">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setVerification(undefined);
              }}
              className={`sf-acc-auth-tab ${mode === "login" ? "active" : ""}`}
            >
              {t("Sign in", "تسجيل الدخول")}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setVerification(undefined);
              }}
              className={`sf-acc-auth-tab ${mode === "register" ? "active" : ""}`}
            >
              {t("Create account", "إنشاء حساب جديد")}
            </button>
          </div>

          <form className="sf-acc-form sf-acc-auth-form" onSubmit={handleAuthSubmit}>
            {mode === "login" && (
              <div className="sf-acc-field">
                <label>{t("Sign-in method", "طريقة الدخول")}</label>
                <div className="sf-acc-segmented-control">
                  <button
                    type="button"
                    className={loginMethod === "OTP" ? "active" : ""}
                    onClick={() => {
                      setLoginMethod("OTP");
                      setVerification(undefined);
                    }}
                  >
                    WhatsApp OTP
                  </button>
                  <button
                    type="button"
                    className={loginMethod === "PASSWORD" ? "active" : ""}
                    onClick={() => {
                      setLoginMethod("PASSWORD");
                      setVerification(undefined);
                    }}
                  >
                    {t("Password", "كلمة المرور")}
                  </button>
                </div>
              </div>
            )}

            {mode === "login" ? (
              loginMethod === "OTP" ? (
                <>
                  <div className="sf-acc-field">
                    <label>{t("WhatsApp mobile number", "رقم جوال الواتساب")}</label>
                    <input
                      type="tel"
                      required
                      value={mobile}
                      onChange={(e) => {
                        setMobile(e.target.value);
                        setVerification(undefined);
                      }}
                      placeholder="05xxxxxxxx"
                    />
                  </div>
                  {verification ? (
                    <div className="sf-acc-alert sf-acc-alert-success">
                      <AccountIcon name="check" />
                      <span>{t("Mobile verified successfully", "تم التحقق من الجوال بنجاح")}</span>
                    </div>
                  ) : (
                    <Otp
                      key="login"
                      purpose="LOGIN"
                      destination={mobile}
                      verified={(id, token) => setVerification({ verificationId: id, verificationToken: token })}
                      t={t}
                    />
                  )}
                </>
              ) : (
                <div className="sf-acc-field">
                  <label>{t("Email or mobile", "البريد الإلكتروني أو رقم الجوال")}</label>
                  <input name="login" required autoComplete="username" placeholder="user@company.com" />
                </div>
              )
            ) : (
              <>
                <div className="sf-acc-field">
                  <label>{t("Account Type", "نوع الحساب")}</label>
                  <div className="sf-acc-segmented-control">
                    <button
                      type="button"
                      className={accountType === "RETAIL" ? "active" : ""}
                      onClick={() => setAccountType("RETAIL")}
                    >
                      {t("Personal / Retail", "أفراد / تجزئة")}
                    </button>
                    <button
                      type="button"
                      className={accountType === "COMPANY" ? "active" : ""}
                      onClick={() => setAccountType("COMPANY")}
                    >
                      {t("Company / B2B", "شركة / أعمال")}
                    </button>
                  </div>
                </div>

                <div className="sf-acc-field">
                  <label>{t("Customer or Business Name", "اسم العميل أو المؤسسة")}</label>
                  <input name="name" required minLength={2} autoComplete="organization" />
                </div>

                {accountType === "COMPANY" && (
                  <div className="sf-acc-company-card">
                    <h5 className="sf-acc-subheading">{t("Company Registration", "بيانات السجل التجاري والضريبة")}</h5>
                    {[
                      ["registrationNumber", "Company registration number (CR)", "رقم السجل التجاري"],
                      ["taxNumber", "Tax number (VAT)", "الرقم الضريبي"],
                      ["contactPerson", "Contact person", "الشخص المسؤول"],
                      ["companyAddress", "Company address", "عنوان الشركة"],
                    ].map(([name, en, ar]) => (
                      <div key={name} className="sf-acc-field">
                        <label>{t(en, ar)}</label>
                        <input
                          name={name}
                          required={!new URLSearchParams(location.search).has("invitation") && name !== "taxNumber"}
                        />
                      </div>
                    ))}
                    <div className="sf-acc-field">
                      <label>{t("Registration document (PDF, up to 1 MB)", "مستند السجل (PDF حتى 1 ميغابايت)")}</label>
                      <input name="supportingDocument" type="file" accept="application/pdf" />
                    </div>
                  </div>
                )}

                <div className="sf-acc-field">
                  <label>{t("Customer code (optional)", "رمز العميل (اختياري)")}</label>
                  <input name="customerCode" />
                </div>

                <div className="sf-acc-field">
                  <label>{t("Mobile number", "رقم الجوال")}</label>
                  <input
                    name="mobile"
                    required
                    type="tel"
                    autoComplete="tel"
                    value={mobile}
                    onChange={(e) => {
                      setMobile(e.target.value);
                      setVerification(undefined);
                    }}
                    placeholder="05xxxxxxxx"
                  />
                </div>

                <div className="sf-acc-field">
                  <label>{t("Email address", "البريد الإلكتروني")}</label>
                  <input
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setVerification(undefined);
                    }}
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="name@domain.com"
                  />
                </div>

                {verification ? (
                  <div className="sf-acc-alert sf-acc-alert-success">
                    <AccountIcon name="check" />
                    <span>{t("Mobile verified", "تم التحقق من الجوال")}</span>
                  </div>
                ) : (
                  <Otp
                    purpose="SIGNUP"
                    key="signup"
                    destination={mobile}
                    verified={(id, token) => setVerification({ verificationId: id, verificationToken: token })}
                    t={t}
                  />
                )}
              </>
            )}

            {(mode === "register" || loginMethod === "PASSWORD") && (
              <div className="sf-acc-field">
                <label>{t("Password", "كلمة المرور")}</label>
                <div className="sf-acc-input-wrap">
                  <input
                    name="password"
                    type={showNewPassword ? "text" : "password"}
                    minLength={mode === "register" ? 8 : undefined}
                    required
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                  />
                  <button
                    type="button"
                    className="sf-acc-pw-toggle"
                    onClick={() => setShowNewPassword((s) => !s)}
                    aria-label={showNewPassword ? "Hide password" : "Show password"}
                  >
                    <AccountIcon name={showNewPassword ? "eye-off" : "eye"} />
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="sf-acc-btn sf-acc-btn-primary sf-acc-btn-block"
              disabled={busy || ((mode === "register" || loginMethod === "OTP") && !verification)}
            >
              {busy ? (
                <>
                  <span className="sf-acc-spinner-sm" />
                  <span>{t("Processing...", "جاري المعالجة...")}</span>
                </>
              ) : mode === "login" ? (
                t("Sign in", "تسجيل الدخول")
              ) : (
                t("Submit application", "إرسال طلب التسجيل")
              )}
            </button>
          </form>
        </div>
      )}
    </StoreDialog>
  );
}
