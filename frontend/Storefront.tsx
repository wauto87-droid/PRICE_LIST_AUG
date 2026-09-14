"use client";
import StoreProductEditLink from "./StoreProductEditLink";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { appPath } from "../shared/paths";
import StorefrontCheckout, {
  StoreDialog,
  StoreAccount,
} from "./StorefrontCheckout";
import "./storefront.css";
import BusinessPortal from "./BusinessPortal";
import StoreMerchandising from "./StoreMerchandising";
import StoreReceipts from "./StoreReceipts";
export type StoreProduct = {
  id: string;
  part_number: string;
  description: string;
  unit: string;
  quantityPrecision: number;
  purchasable?: boolean;
  priceIncl: string|null;
  priceExcl: string|null;
  brand: string;
  category: string;
  availability: string;
  images: { id: string; caption: string; url: string }[];
  content?: Record<string, unknown>;
};
export type StoreCart = Record<string, StoreProduct & { quantity: string }>;
const storageKey = "amt-store-cart-v1";
function StoreIcon({ kind }: { kind: "search" | "user" | "cart" }) {
  return (
    <svg
      width="23"
      height="23"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "search" ? (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </>
      ) : kind === "user" ? (
        <>
          <circle cx="12" cy="7" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      ) : (
        <>
          <path d="M2 3h3l3 12h11l3-9H6" />
          <circle cx="9" cy="20" r="1" />
          <circle cx="18" cy="20" r="1" />
        </>
      )}
    </svg>
  );
}
export default function Storefront() {
  const [lang, setLang] = useState<"en" | "ar">("en"),
    [config, setConfig] = useState<any>(),
    [catalog, setCatalog] = useState<any>(),
    [cart, setCart] = useState<StoreCart>({}),
    [ready, setReady] = useState(false),
    [account, setAccount] = useState<any>(null),
    [panel, setPanel] = useState(""),
    [detail, setDetail] = useState<StoreProduct>(),
    [photo, setPhoto] = useState(0),
    [q, setQ] = useState(""),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [brand, setBrand] = useState(""),
    [availability, setAvailability] = useState(""),
    [sort, setSort] = useState("relevance"),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0),
    [payment, setPayment] = useState<any>();
  const [customBanner, setCustomBanner] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (q.trim().length >= 2)
        api("storefront/suggestions?q=" + encodeURIComponent(q))
          .then((r) => {
            if (active) setSuggestions(r.items);
          })
          .catch(() => {});
      else setSuggestions([]);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q]);
  const search = useRef<HTMLInputElement>(null),
    request = useRef(0);
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  async function initialize() {
    setError("");
    try {
      const c = await api("storefront/configuration");
      setConfig(c);
      const a = await api("storefront/account/me");
      setAccount(a.account);
      const requestId = new URLSearchParams(location.search).get("request");
      if (requestId && a.account) {
        const quoted = await api("storefront/quote-cart/" + requestId);
        setCart(Object.fromEntries(quoted.items.map((p: any) => [p.id, p])));
        setPanel("cart");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        const clean: StoreCart = {};
        for (const [id, item] of Object.entries(stored)) {
          const p = item as any;
          if (
            p?.id === id &&
            /^[0-9a-f-]{36}$/i.test(id) &&
            typeof p.part_number === "string" &&
            Number(p.quantity) > 0 &&
            Number(p.quantity) <= 1000000
          )
            clean[id] = { ...p, quantity: String(p.quantity) };
        }
        setCart(clean);
      }
      setLang(
        localStorage.getItem("amt-store-language") === "ar" ? "ar" : "en",
      );
    } catch {}
    setReady(true);
    const params = new URLSearchParams(location.search);
    setCategory(params.get("category") || "");
    setBrand(params.get("brand") || "");
    setQ(params.get("q") || "");
    setQuery(params.get("q") || "");
    if (params.has("invitation")) setPanel("account");
    initialize();
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(cart));
        localStorage.setItem("amt-store-language", lang);
      } catch {}
    }
  }, [cart, ready, lang]);
  useEffect(() => {
    const oldDir = document.documentElement.dir,
      oldLang = document.documentElement.lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.dir = oldDir;
      document.documentElement.lang = oldLang;
    };
  }, [lang]);
  useEffect(() => {
    if (!config?.enabled) return;
    let active = true;
    const id = ++request.current;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      q: query,
      category,
      brand,
      availability,
      sort,
      page: String(page),
    });
    api(`storefront/catalog?${params}`)
      .then((c) => {
        if (active && id === request.current) setCatalog(c);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    config?.enabled,
    query,
    category,
    brand,
    availability,
    sort,
    page,
    account,
    revision,
  ]);
  async function checkPayment() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) return;
    try {
      const r = await api(
        `storefront/payment-return?id=${encodeURIComponent(id)}`,
      );
      setPayment(r);
      if (r.status === "CONFIRMED") {
        try {
          const saved = JSON.parse(
            sessionStorage.getItem("amt-store-checkout") || "null",
          );
          if (saved) {
            const check = await api(`storefront/orders/${r.orderId}`, "POST", {
              verificationToken: saved.verificationToken,
            });
            if (check.orderId === r.orderId) {
              setCart((c) => {
                const next = { ...c };
                for (const l of saved.lines) {
                  if (next[l.productId]?.quantity === l.quantity)
                    delete next[l.productId];
                }
                return next;
              });
              sessionStorage.removeItem("amt-store-checkout");
            }
          }
        } catch {}
      }
    } catch (e) {
      setPayment({ error: (e as Error).message });
    }
  }
  useEffect(() => {
    if (new URLSearchParams(location.search).get("payment") === "return") {
      setPanel("payment");
      checkPayment();
    }
  }, []);
  function add(item: StoreProduct) {
    if (item.purchasable === false) {
      setCart((c) => ({
        ...c,
        [item.id]: { ...item, quantity: c[item.id]?.quantity || "1" },
      }));
      setPanel(account ? "business" : "account");
      return;
    }
    setCart((c) => ({
      ...c,
      [item.id]: {
        ...item,
        quantity: String(Number(c[item.id]?.quantity || 0) + 1),
      },
    }));
    setNotice(t("Added to your cart", "تمت الإضافة إلى السلة"));
  }
  function filter(fn: () => void) {
    fn();
    setPage(1);
  }
  async function openProduct(item: StoreProduct) {
    setPhoto(0);
    setDetail(item);
    setPanel("product");
    try {
      setDetail(await api(`storefront/products/${item.id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const count = Object.values(cart).reduce(
    (n, p) => n + Number(p.quantity || 0),
    0,
  );
  const availabilityText = (value: string) =>
    value === "IN_STOCK"
      ? t("In stock", "متوفر")
      : value === "LIMITED"
        ? t("Limited stock", "كمية محدودة")
        : t("Available on backorder", "متاح بالطلب المسبق");
  return (
    <main className="sf" dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="sf-top">
        <span>
          {t(
            "AMT ELECTRIC · Electrical supplies for every project",
            "AMT ELECTRIC · مستلزمات كهربائية لكل مشروع",
          )}
        </span>
        <span>{t("Retail & business customers", "للأفراد والشركات")}</span>
      </div>
      <header className="sf-header">
        <a
          className="sf-logo"
          href={appPath("/store")}
          aria-label="AMT Electric"
        >
          <img src={appPath("/logo.svg")} alt="AMT Electric" />
          <span>
            AMT <b>ELECTRIC</b>
            <small>
              {t("Your electrical supply store", "متجرك للمستلزمات الكهربائية")}
            </small>
          </span>
        </a>
        <form
          className="sf-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            filter(() => setQuery(q));
          }}
        >
          <input
            list="store-search-suggestions"
            ref={search}
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("Search products", "بحث المنتجات")}
            placeholder={t(
              "Search products, part numbers and more…",
              "ابحث عن المنتجات وأرقام الأصناف…",
            )}
          />
          <button type="submit" aria-label={t("Search", "بحث")}>
            <StoreIcon kind="search" />
          </button>
        </form>
        <nav className="sf-header-actions">
          <button onClick={() => setLang((l) => (l === "en" ? "ar" : "en"))}>
            {lang === "en" ? "العربية" : "English"}
          </button>
          <button onClick={() => setPanel("account")}>
            <StoreIcon kind="user" />
            <span>
              {account
                ? t("My account", "حسابي")
                : t("Sign in", "تسجيل الدخول")}
            </span>
          </button>
          <button onClick={() => setPanel("cart")}>
            <StoreIcon kind="cart" />
            {t("Cart", "السلة")}
            <b className="sf-count">{count}</b>
          </button>
        </nav>
      </header>

      <datalist id="store-search-suggestions">
        {suggestions.map((p) => (
          <option key={p.id} value={p.part_number}>
            {p.description}
          </option>
        ))}
      </datalist>
      <nav className="sf-categories" aria-label={t("Categories", "الفئات")}>
        <button
          className={!category ? "selected" : ""}
          onClick={() => filter(() => setCategory(""))}
        >
          {t("All products", "كل المنتجات")}
        </button>
        {catalog?.categories?.map((c: string) => (
          <button
            key={c}
            className={category === c ? "selected" : ""}
            onClick={() => filter(() => setCategory(c))}
          >
            {c}
          </button>
        ))}
        <span className="sf-business-note">
          {t(
            "Business pricing available with approved accounts",
            "أسعار الشركات للحسابات المعتمدة",
          )}
        </span>
      </nav>
      {error && (
        <div className="sf-alert" role="alert">
          {error}
          <button
            onClick={() => {
              initialize();
              setRevision((r) => r + 1);
            }}
          >
            {t("Retry", "إعادة المحاولة")}
          </button>
        </div>
      )}
      {!config ? (
        <div className="sf-state" aria-busy={!error}>
          <img src={appPath("/logo.svg")} alt="AMT Electric" />
          <h1>{t("Welcome to AMT Electric", "مرحباً بك في AMT Electric")}</h1>
          <p>
            {error
              ? t(
                  "The store could not load. Please retry.",
                  "تعذر تحميل المتجر. حاول مرة أخرى.",
                )
              : t("Loading your store…", "جارٍ تحميل المتجر…")}
          </p>
        </div>
      ) : !config.enabled ? (
        <div className="sf-state">
          <img src={appPath("/logo.svg")} alt="AMT Electric" />
          <h1>
            {t(
              "Our online store is currently closed",
              "متجرنا الإلكتروني مغلق حالياً",
            )}
          </h1>
          <p>
            {t(
              "Please check back soon or contact our team for assistance.",
              "يرجى العودة لاحقاً أو التواصل مع فريقنا للمساعدة.",
            )}
          </p>
          {config.supportMobile && (
            <a href={`tel:${config.supportMobile}`}>{config.supportMobile}</a>
          )}
        </div>
      ) : (
        <>
          <StoreMerchandising
            account={account}
            t={t}
            onBanners={setCustomBanner}
          />
          <section className="sf-hero" hidden={customBanner}>
            <div>
              <span className="sf-eyebrow">
                {t("BUILT FOR YOUR NEXT PROJECT", "لمشروعك القادم")}
              </span>
              <h1>
                {t(
                  config.hero || "Power your projects.\nFind the right parts.",
                  config.heroAr || "جهّز مشاريعك.\nواعثر على القطع المناسبة.",
                )}
              </h1>
              <p>
                {t(
                  "Explore electrical products with clear prices, detailed part numbers and convenient ordering.",
                  "تسوّق المنتجات الكهربائية بأسعار واضحة وأرقام أصناف دقيقة وطلب سهل.",
                )}
              </p>
              <button
                onClick={() => {
                  search.current?.focus();
                  document
                    .getElementById("sf-catalog")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                {t("Explore the catalog", "تصفح المنتجات")}{" "}
                <span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="sf-hero-brand">
              <img src={appPath("/logo.svg")} alt="" />
              <span>{t("ELECTRICAL SUPPLIES", "مستلزمات كهربائية")}</span>
              <p>
                {t(
                  "From a single part to your next big project.",
                  "من قطعة واحدة إلى مشروعك الكبير القادم.",
                )}
              </p>
            </div>
          </section>
          <section className="sf-benefits">
            <div>
              <b>01</b>
              <span>
                <strong>{t("Clear pricing", "أسعار واضحة")}</strong>
                <small>
                  {t(
                    "SAR prices including VAT",
                    "الأسعار بالريال شاملة الضريبة",
                  )}
                </small>
              </span>
            </div>
            <div>
              <b>02</b>
              <span>
                <strong>{t("Order your way", "اطلب بطريقتك")}</strong>
                <small>
                  {t(
                    "Available delivery & pickup options",
                    "خيارات التوصيل والاستلام المتاحة",
                  )}
                </small>
              </span>
            </div>
            <div>
              <b>03</b>
              <span>
                <strong>{t("Built for business", "مصمم للشركات")}</strong>
                <small>
                  {t("Approved account pricing", "أسعار الحسابات المعتمدة")}
                </small>
              </span>
            </div>
          </section>
          <section id="sf-catalog" className="sf-catalog">
            <div className="sf-catalog-heading">
              <div>
                <span className="sf-eyebrow">
                  {t("THE AMT CATALOG", "كتالوج AMT")}
                </span>
                <h2>
                  {category ||
                    t(
                      "Shop electrical essentials",
                      "تسوّق المستلزمات الكهربائية",
                    )}
                </h2>
                <p>
                  {loading
                    ? t("Updating products…", "جارٍ تحديث المنتجات…")
                    : `${catalog?.total || 0} ${t("products", "منتج")}${query ? ` · “${query}”` : ""}`}
                </p>
              </div>
              <label className="sf-sort">
                {t("Sort by", "ترتيب حسب")}
                <select
                  value={sort}
                  onChange={(e) => filter(() => setSort(e.target.value))}
                >
                  <option value="relevance">
                    {t("Relevance", "الأكثر صلة")}
                  </option>
                  <option value="part">{t("Part number", "رقم الصنف")}</option>
                  <option value="price-asc">
                    {t("Price: low to high", "السعر: من الأقل للأعلى")}
                  </option>
                  <option value="price-desc">
                    {t("Price: high to low", "السعر: من الأعلى للأقل")}
                  </option>
                </select>
              </label>
            </div>
            <div className="sf-shop-layout">
              <aside className="sf-filters">
                <h3>{t("Filter products", "تصفية المنتجات")}</h3>
                <label>
                  {t("Category", "الفئة")}
                  <select
                    value={category}
                    onChange={(e) => filter(() => setCategory(e.target.value))}
                  >
                    <option value="">{t("All categories", "كل الفئات")}</option>
                    {catalog?.categories?.map((c: string) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Brand", "العلامة التجارية")}
                  <select
                    value={brand}
                    onChange={(e) => filter(() => setBrand(e.target.value))}
                  >
                    <option value="">{t("All brands", "كل العلامات")}</option>
                    {catalog?.brands?.map((b: string) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Availability", "التوفر")}
                  <select
                    value={availability}
                    onChange={(e) =>
                      filter(() => setAvailability(e.target.value))
                    }
                  >
                    <option value="">
                      {t("All availability", "كل الحالات")}
                    </option>
                    {["IN_STOCK", "LIMITED", "BACKORDER"].map((v) => (
                      <option key={v} value={v}>
                        {availabilityText(v)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="sf-text-button"
                  onClick={() => {
                    setCategory("");
                    setBrand("");
                    setAvailability("");
                    setQ("");
                    setQuery("");
                    setPage(1);
                  }}
                >
                  {t("Clear filters", "مسح التصفية")}
                </button>
                <div className="sf-help">
                  <strong>
                    {t("Ordering for a business?", "تطلب لشركة؟")}
                  </strong>
                  <p>
                    {t(
                      "Apply for an account to access your approved prices and terms.",
                      "اطلب حساباً للوصول لأسعارك وشروطك المعتمدة.",
                    )}
                  </p>
                  <button onClick={() => setPanel("account")}>
                    {t("Business accounts", "حسابات الشركات")} →
                  </button>
                </div>
              </aside>
              <div>
                <div className="sf-grid" aria-busy={loading}>
                  {loading && !catalog
                    ? Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="sf-skeleton" />
                      ))
                    : catalog?.items?.map((item: StoreProduct) => (
                        <article className="sf-product" key={item.id}>
                          <button
                            className="sf-product-image"
                            onClick={() => openProduct(item)}
                            aria-label={item.description}
                          >
                            {item.images[0] ? (
                              <img
                                src={item.images[0].url}
                                alt={item.description}
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.visibility = "hidden";
                                }}
                              />
                            ) : (
                              <span className="sf-no-image">
                                <span aria-hidden="true">◇</span>
                                <small>
                                  {t("Image unavailable", "الصورة غير متوفرة")}
                                </small>
                              </span>
                            )}
                            <span
                              className={`sf-stock ${item.availability.toLowerCase()}`}
                            >
                              {availabilityText(item.availability)}
                            </span>
                          </button>
                          <div className="sf-product-body">
                            <small>{item.brand || "AMT ELECTRIC"}</small>
                            <button
                              className="sf-product-title"
                              onClick={() => openProduct(item)}
                            >
                              {item.description}
                            </button>
                            <code>{item.part_number}</code>
                            <div className="sf-price">
                              <small>SAR</small>{" "}
                              <strong>
                                {item.priceIncl === null
                                  ? t("Price on request", "السعر عند الطلب")
                                  : item.priceIncl}
                              </strong>
                              <span>/ {item.unit}</span>
                            </div>
                            <p className="sf-vat">
                              {t("Including VAT", "شامل الضريبة")}
                            </p>
                            <button
                              className="sf-add"
                              onClick={() => add(item)}
                            >
                              {item.purchasable === false
                                ? t("Request a quote", "طلب عرض سعر")
                                : "+ " + t("Add to cart", "أضف للسلة")}
                            </button>
                          </div>
                        </article>
                      ))}
                </div>
                {!loading && catalog?.total === 0 && (
                  <div className="sf-state">
                    <h3>
                      {t("No products found", "لم يتم العثور على منتجات")}
                    </h3>
                    <p>
                      {t(
                        "Try another part number or clear your filters.",
                        "جرّب رقم صنف آخر أو امسح التصفية.",
                      )}
                    </p>
                  </div>
                )}
                <nav
                  className="sf-pagination"
                  aria-label={t("Product pages", "صفحات المنتجات")}
                >
                  <button
                    disabled={loading || (catalog?.page || 1) <= 1}
                    onClick={() => setPage((catalog?.page || 1) - 1)}
                  >
                    {t("Previous", "السابق")}
                  </button>
                  <span>
                    {catalog?.page || 1} / {catalog?.totalPages || 1}
                  </span>
                  <button
                    disabled={
                      loading ||
                      (catalog?.page || 1) >= (catalog?.totalPages || 1)
                    }
                    onClick={() => setPage((catalog?.page || 1) + 1)}
                  >
                    {t("Next", "التالي")}
                  </button>
                </nav>
              </div>
            </div>
          </section>
        </>
      )}
      <footer className="sf-footer">
        <div>
          <strong>AMT ELECTRIC</strong>
          <p>
            {t(
              "Electrical supplies. Clear prices. Easy ordering.",
              "مستلزمات كهربائية. أسعار واضحة. طلب سهل.",
            )}
          </p>
        </div>
        <div>
          <strong>{t("Customer support", "خدمة العملاء")}</strong>
          {config?.supportMobile ? (
            <a href={`tel:${config.supportMobile}`}>{config.supportMobile}</a>
          ) : (
            <p>
              {t(
                "Contact your AMT sales representative",
                "تواصل مع مندوب مبيعات AMT",
              )}
            </p>
          )}
        </div>
        <div>
          <strong>{t("Shop with AMT", "تسوّق مع AMT")}</strong>
          <button onClick={() => setPanel("account")}>
            {t("Business account", "حساب شركات")}
          </button>
          <small>
            {t(
              "All prices in SAR, including VAT.",
              "جميع الأسعار بالريال شاملة الضريبة.",
            )}
          </small>
        </div>
      </footer>
      {notice && (
        <div className="sf-toast" role="status">
          {notice}
          <button
            onClick={() => {
              setPanel("cart");
              setNotice("");
            }}
          >
            {t("View cart", "عرض السلة")}
          </button>
          <button
            onClick={() => setNotice("")}
            aria-label={t("Dismiss", "إغلاق")}
          >
            ×
          </button>
        </div>
      )}
      {panel === "product" && detail && (
        <StoreDialog title={detail.part_number} close={() => setPanel("")}>
          <div className="sf-detail">
            <div className="sf-gallery">
              {detail.images[photo] ? (
                <img
                  src={detail.images[photo].url}
                  alt={detail.images[photo].caption || detail.description}
                />
              ) : (
                <div className="sf-no-image">
                  ◇
                  <small>
                    {t("No product image available", "لا توجد صورة للمنتج")}
                  </small>
                </div>
              )}
              <div className="sf-thumbs">
                {detail.images.map((im, i) => (
                  <button
                    key={im.id}
                    aria-label={`${t("Image", "صورة")} ${i + 1}`}
                    onClick={() => setPhoto(i)}
                  >
                    <img src={im.url} alt="" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <small>
                {detail.brand} · {detail.category}
              </small>
              <h2>{detail.description}</h2>
              <p>{availabilityText(detail.availability)}</p>
              <div className="sf-price">
                {detail.priceIncl===null?t('Price on request','السعر عند الطلب'):<>SAR <strong>{detail.priceIncl}</strong> / {detail.unit}</>}
              </div>
              <p>{t("Including VAT", "شامل الضريبة")}</p>
              <StoreProductEditLink productId={detail.id}/>
              <button className="sf-primary" onClick={() => add(detail)}>
                {detail.purchasable===false?t('Request a quote','طلب عرض سعر'):t("Add to cart", "أضف للسلة")}
              </button>
              {typeof detail.content?.description === "string" && (
                <p>{detail.content.description}</p>
              )}
              <dl>
                <dt>{t("Part number", "رقم الصنف")}</dt>
                <dd>{detail.part_number}</dd>
                <dt>{t("Unit", "الوحدة")}</dt>
                <dd>{detail.unit}</dd>
                {["manufacturer", "productName", "productType", "series"].map(
                  (k) =>
                    typeof detail.content?.[k] === "string" &&
                    detail.content[k] ? (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{String(detail.content[k])}</dd>
                      </div>
                    ) : null,
                )}
                {Array.isArray(detail.content?.specifications) &&
                  detail.content.specifications.map((s: any, i: number) => (
                    <div key={i}>
                      <dt>{s.label}</dt>
                      <dd>{s.value}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          </div>
        </StoreDialog>
      )}
      {panel === "business" && account && (
        <BusinessPortal t={t} cart={cart} close={() => setPanel("")} />
      )}
      {panel === "receipts" && (
        <StoreReceipts t={t} close={() => setPanel("")} />
      )}
      {panel === "cart" && (
        <StorefrontCheckout
          requestQuote={()=>setPanel(account?'business':'account')}
          cart={cart}
          setCart={setCart}
          account={account}
          config={config}
          t={t}
          close={() => setPanel("")}
        />
      )}
      {panel === "account" && (
        <StoreAccount
          account={account}
          changed={(a) => {
            setAccount(a);
            setRevision((r) => r + 1);
          }}
          t={t}
          close={() => setPanel("")}
          navigate={(p) => setPanel(p)}
          config={config}
        />
      )}
      {panel === "payment" && (
        <StoreDialog
          title={t("Payment status", "حالة الدفع")}
          close={() => {
            setPanel("");
            history.replaceState({}, "", appPath("/store"));
          }}
        >
          <div className="sf-state">
            <h2>
              {payment?.status === "CONFIRMED"
                ? t("Payment confirmed", "تم تأكيد الدفع")
                : payment?.status === "FAILED"
                  ? t("Payment was not completed", "لم تكتمل عملية الدفع")
                  : t("Checking your payment", "التحقق من الدفع")}
            </h2>
            <p>{payment?.orderNumber}</p>
            {payment?.error && <p role="alert">{payment.error}</p>}
            <p>
              {t(
                "Your order status is checked securely with the payment provider.",
                "يتم التحقق من حالة الطلب لدى مزود الدفع.",
              )}
            </p>
            <button onClick={checkPayment}>
              {t("Refresh status", "تحديث الحالة")}
            </button>
            {payment?.status === "PENDING_PAYMENT" && payment.redirectUrl && (
              <a href={payment.redirectUrl}>
                {t("Continue payment", "متابعة الدفع")}
              </a>
            )}
          </div>
        </StoreDialog>
      )}
    </main>
  );
}
