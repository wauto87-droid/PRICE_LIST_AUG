"use client";

import { useEffect, useState } from "react";
import { api, type Translate } from "./api";

export type AdItem = {
  id: string;
  enabled: boolean;
  title: string;
  titleAr?: string;
  description?: string;
  descriptionAr?: string;
  mediaUrl: string;
  target: "ALL" | "STOREFRONT" | "WORKSPACE";
  type: "POPUP" | "INTERVAL" | "BANNER";
  intervalSeconds: number;
  ctaText?: string;
  ctaTextAr?: string;
  ctaLink?: string;
  dismissible: boolean;
  createdAt?: string;
};

const emptyAd = (): AdItem => ({
  id: crypto.randomUUID(),
  enabled: true,
  title: "",
  titleAr: "",
  description: "",
  descriptionAr: "",
  mediaUrl: "",
  target: "ALL",
  type: "POPUP",
  intervalSeconds: 60,
  ctaText: "",
  ctaTextAr: "",
  ctaLink: "",
  dismissible: true,
  createdAt: new Date().toISOString(),
});

export default function StoreAdsAdmin({
  t,
  user,
}: {
  t: Translate;
  user: any;
}) {
  const [ads, setAds] = useState<AdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<AdItem | null>(null);
  const [previewAd, setPreviewAd] = useState<AdItem | null>(null);

  const isVideo = (url?: string | null) => {
    if (!url) return false;
    return url.startsWith("data:video/") || /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
  };

  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const allowed = [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "video/mp4",
        "video/webm",
        "video/ogg",
        "video/quicktime",
      ];
      if (!allowed.includes(file.type) && !file.name.match(/\.(png|jpe?g|webp|gif|mp4|webm|ogg|mov)$/i)) {
        reject(
          new Error(
            t(
              "Unsupported format. Use PNG, JPEG, WebP, GIF, or MP4/WebM video under 15 MB",
              "نوع الملف غير مدعوم. يرجى استخدام PNG أو JPEG أو WebP أو GIF أو فيديو MP4/WebM أقل من 15 ميجابايت",
            ),
          ),
        );
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        reject(
          new Error(
            t(
              "File size exceeds 15 MB limit",
              "حجم الملف يتجاوز الحد الأقصى (15 ميغابايت)",
            ),
          ),
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t("Failed to read file", "تعذر قراءة الملف")));
      reader.readAsDataURL(file);
    });
  };

  async function loadAds() {
    setLoading(true);
    setError("");
    try {
      const res = await api("storefront-admin/ads");
      setAds(Array.isArray(res.ads) ? res.ads : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAds();
  }, []);

  async function saveAdsList(nextAds: AdItem[]) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api("storefront-admin/ads", "PUT", { ads: nextAds });
      setAds(res.ads);
      setNotice(t("Ads updated successfully", "تم تحديث الإعلانات بنجاح"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleSaveAd(ad: AdItem) {
    if (!ad.title.trim() && !ad.titleAr?.trim()) {
      alert(t("Please provide at least one title", "يرجى كتابة عنوان للإعلان"));
      return;
    }
    if (!ad.mediaUrl.trim()) {
      alert(t("Please upload an image/video or enter a media URL", "يرجى رفع صورة/فيديو أو إدخال رابط وسائط"));
      return;
    }

    const existingIndex = ads.findIndex((x) => x.id === ad.id);
    let next: AdItem[];
    if (existingIndex >= 0) {
      next = [...ads];
      next[existingIndex] = ad;
    } else {
      next = [ad, ...ads];
    }
    setEditing(null);
    saveAdsList(next);
  }

  function handleDeleteAd(id: string) {
    if (!confirm(t("Are you sure you want to delete this ad?", "هل أنت متأكد من رغبتك في حذف هذا الإعلان؟"))) {
      return;
    }
    const next = ads.filter((x) => x.id !== id);
    saveAdsList(next);
  }

  function handleToggleEnabled(id: string, current: boolean) {
    const next = ads.map((x) => (x.id === id ? { ...x, enabled: !current } : x));
    saveAdsList(next);
  }

  return (
    <div className="store-ads-admin" style={{ padding: "16px 0" }}>
      {/* HEADER BAR */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
          background: "linear-gradient(135deg, #1e293b, #0f172a)",
          padding: "20px 24px",
          borderRadius: 14,
          color: "#fff",
          boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: "flex", alignItems: "center", gap: 10 }}>
            <span>📢</span>
            <span>{t("Promotional Ads & Popups", "الإعلانات والنوافذ الترويجية")}</span>
          </h3>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#94a3b8" }}>
            {t(
              "Broadcast photo, GIF, or video ads with customizable triggers (pop-up on enter or recurring interval) across Workspace and Online Store.",
              "بث إعلانات بالصور أو الـ GIF أو الفيديو مع خيارات ظهور متقدمة (نافذة منبثقة عند الدخول أو إعلان متكرر بفواصل زمنية) في مساحة العمل والمتجر.",
            )}
          </p>
        </div>

        <button
          type="button"
          className="primary"
          onClick={() => setEditing(emptyAd())}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 18px",
            fontWeight: 700,
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          <span>➕</span>
          <span>{t("Create New Ad", "إضافة إعلان جديد")}</span>
        </button>
      </div>

      {/* NOTICES */}
      {error && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" style={{ marginBottom: 16 }}>
          {notice}
        </div>
      )}

      {/* QUICK STATS CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{t("Total Ads", "إجمالي الإعلانات")}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{ads.length}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>{t("Active Running", "الإعلانات النشطة")}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#16a34a", marginTop: 4 }}>
            {ads.filter((a) => a.enabled).length}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, color: "#3b82f6", fontWeight: 600 }}>{t("Online Store Ads", "إعلانات المتجر")}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#2563eb", marginTop: 4 }}>
            {ads.filter((a) => a.target === "STOREFRONT" || a.target === "ALL").length}
          </div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, color: "#8b5cf6", fontWeight: 600 }}>{t("Workspace Ads", "إعلانات مساحة العمل")}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#7c3aed", marginTop: 4 }}>
            {ads.filter((a) => a.target === "WORKSPACE" || a.target === "ALL").length}
          </div>
        </div>
      </div>

      {/* ADS LIST */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
          {t("Loading advertisements…", "جار تحميل الإعلانات…")}
        </div>
      ) : ads.length === 0 ? (
        <div
          style={{
            background: "#f8fafc",
            border: "2px dashed #cbd5e1",
            borderRadius: 14,
            padding: 48,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 12 }}>📢</div>
          <h4 style={{ margin: "0 0 6px", fontSize: 17, color: "#334155" }}>
            {t("No Advertisements Configured Yet", "لا توجد إعلانات منشأة حتى الآن")}
          </h4>
          <p style={{ margin: "0 0 18px", color: "#64748b", fontSize: 14 }}>
            {t(
              "Create your first promotional popup or interval ad for special deals, announcements, or fun videos!",
              "أنشئ إعلانك الترويجي الأول للإعلان عن العروض والتنبيهات أو مقاطع ترفيهية!",
            )}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => setEditing(emptyAd())}
            style={{ padding: "8px 18px", borderRadius: 8 }}
          >
            {t("Create Your First Ad", "إنشاء أول إعلان")}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {ads.map((ad) => {
            const hasVid = isVideo(ad.mediaUrl);
            return (
              <div
                key={ad.id}
                style={{
                  background: "#fff",
                  border: `1.5px solid ${ad.enabled ? "#cbd5e1" : "#e2e8f0"}`,
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
                  display: "flex",
                  flexDirection: "column",
                  opacity: ad.enabled ? 1 : 0.68,
                  transition: "all 0.2s ease",
                }}
              >
                {/* AD MEDIA THUMBNAIL */}
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: 170,
                    background: "#0f172a",
                    overflow: "hidden",
                  }}
                >
                  {hasVid ? (
                    <video
                      src={ad.mediaUrl}
                      autoPlay
                      loop
                      muted
                      playsInline
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <img
                      src={ad.mediaUrl}
                      alt={ad.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}

                  {/* MEDIA TYPE BADGE */}
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      left: 10,
                      background: "rgba(15, 23, 42, 0.75)",
                      backdropFilter: "blur(6px)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 6,
                    }}
                  >
                    {hasVid ? "🎬 " + t("Video", "فيديو") : "🖼️ " + t("Image/GIF", "صورة / متحرك")}
                  </span>

                  {/* TARGET BADGE */}
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      background:
                        ad.target === "ALL"
                          ? "rgba(37, 99, 235, 0.88)"
                          : ad.target === "STOREFRONT"
                            ? "rgba(22, 163, 74, 0.88)"
                            : "rgba(124, 58, 237, 0.88)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 6,
                    }}
                  >
                    {ad.target === "ALL"
                      ? "🌐 " + t("All", "الكل")
                      : ad.target === "STOREFRONT"
                        ? "🛍️ " + t("Store", "المتجر")
                        : "💻 " + t("Workspace", "مساحة العمل")}
                  </span>

                  {/* TYPE BADGE */}
                  <span
                    style={{
                      position: "absolute",
                      bottom: 10,
                      left: 10,
                      background: "rgba(234, 88, 12, 0.9)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 6,
                    }}
                  >
                    {ad.type === "POPUP"
                      ? "🪟 " + t("Pop-up", "نافذة منبثقة")
                      : ad.type === "INTERVAL"
                        ? `⏱️ ${t("Interval", "دوري")} (${ad.intervalSeconds || 60}s)`
                        : "📌 " + t("Banner", "شريط عائم")}
                  </span>
                </div>

                {/* AD DETAILS */}
                <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a", marginBottom: 4 }}>
                    {ad.title || ad.titleAr}
                  </div>
                  {ad.titleAr && ad.title && ad.titleAr !== ad.title && (
                    <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>{ad.titleAr}</div>
                  )}

                  {(ad.description || ad.descriptionAr) && (
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: 12.5,
                        color: "#475569",
                        lineHeight: 1.4,
                        maxHeight: 40,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {ad.description || ad.descriptionAr}
                    </p>
                  )}

                  {ad.ctaText && (
                    <div style={{ fontSize: 12, color: "#0284c7", fontWeight: 600, marginTop: "auto", marginBottom: 10 }}>
                      🔗 {ad.ctaText} {ad.ctaLink ? `(${ad.ctaLink})` : ""}
                    </div>
                  )}

                  {/* CARD ACTIONS */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingTop: 10,
                      borderTop: "1px solid #f1f5f9",
                      marginTop: "auto",
                      gap: 8,
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={ad.enabled}
                        onChange={() => handleToggleEnabled(ad.id, ad.enabled)}
                        disabled={busy}
                      />
                      <span>{ad.enabled ? t("Active", "نشط") : t("Disabled", "معطل")}</span>
                    </label>

                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => setPreviewAd(ad)}
                        title={t("Preview Ad", "معاينة الإعلان")}
                        style={{
                          padding: "5px 10px",
                          fontSize: 12,
                          background: "#f1f5f9",
                          border: "1px solid #cbd5e1",
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        👁️
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ ...ad })}
                        style={{
                          padding: "5px 12px",
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        ✏️ {t("Edit", "تعديل")}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleDeleteAd(ad.id)}
                        style={{
                          padding: "5px 10px",
                          fontSize: 12,
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* EDIT / CREATE MODAL */}
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 620,
              maxHeight: "92vh",
              overflowY: "auto",
              padding: 24,
              boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                {editing.id && ads.some((x) => x.id === editing.id)
                  ? t("Edit Advertisement", "تعديل الإعلان")
                  : t("Create New Advertisement", "إنشاء إعلان جديد")}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 22,
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveAd(editing);
              }}
              className="form-grid"
            >
              {/* STATUS TOGGLE */}
              <label className="check full-width" style={{ marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                <strong>{t("Enable this advertisement", "تفعيل هذا الإعلان")}</strong>
              </label>

              {/* TARGET & AD TYPE */}
              <div>
                <label>
                  {t("Target Platform", "منصة العرض")}
                  <select
                    value={editing.target}
                    onChange={(e) => setEditing({ ...editing, target: e.target.value as any })}
                  >
                    <option value="ALL">🌐 {t("Both Storefront & Workspace", "المتجر ومساحة العمل معاً")}</option>
                    <option value="STOREFRONT">🛍️ {t("Online Store Only", "المتجر الإلكتروني فقط")}</option>
                    <option value="WORKSPACE">💻 {t("Workspace Staff Portal Only", "بوابة الموظفين فقط")}</option>
                  </select>
                </label>
              </div>

              <div>
                <label>
                  {t("Ad Display Type", "طريقة العرض")}
                  <select
                    value={editing.type}
                    onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                  >
                    <option value="POPUP">🪟 {t("Pop-up Modal (on load)", "نافذة منبثقة (عند الفتح)")}</option>
                    <option value="INTERVAL">⏱️ {t("Interval Popup (periodic)", "إعلان دوري متكرر")}</option>
                    <option value="BANNER">📌 {t("Floating Banner", "شريط عائم ثابت")}</option>
                  </select>
                </label>
              </div>

              {editing.type === "INTERVAL" && (
                <div className="full-width">
                  <label>
                    {t("Interval Frequency (Seconds between triggers)", "الفاصل الزمني بالثواني")}
                    <input
                      type="number"
                      min={10}
                      max={3600}
                      step={5}
                      value={editing.intervalSeconds || 60}
                      onChange={(e) => setEditing({ ...editing, intervalSeconds: Number(e.target.value) || 60 })}
                    />
                    <small style={{ color: "#64748b" }}>
                      {t("Example: 60 = every 1 minute, 120 = every 2 minutes.", "مثال: 60 = كل دقيقة، 120 = كل دقيقتين.")}
                    </small>
                  </label>
                </div>
              )}

              {/* TITLE & ARABIC TITLE */}
              <div>
                <label>
                  {t("Title (English)", "العنوان (بالإنجليزية)")}
                  <input
                    type="text"
                    required
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    placeholder={t("Special Seasonal Discount!", "خصم موسمي خاص!")}
                  />
                </label>
              </div>

              <div>
                <label>
                  {t("Title (Arabic)", "العنوان (بالعربية)")}
                  <input
                    type="text"
                    value={editing.titleAr || ""}
                    onChange={(e) => setEditing({ ...editing, titleAr: e.target.value })}
                    placeholder={t("عرض خاص لفترة محدودة!", "عرض خاص لفترة محدودة!")}
                  />
                </label>
              </div>

              {/* DESCRIPTION & ARABIC */}
              <div>
                <label>
                  {t("Description (English)", "الوصف (بالإنجليزية)")}
                  <textarea
                    rows={2}
                    value={editing.description || ""}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder={t("Check out our newly stocked circuit breakers...", "اطلع على التشكيلة الجديدة...")}
                  />
                </label>
              </div>

              <div>
                <label>
                  {t("Description (Arabic)", "الوصف (بالعربية)")}
                  <textarea
                    rows={2}
                    value={editing.descriptionAr || ""}
                    onChange={(e) => setEditing({ ...editing, descriptionAr: e.target.value })}
                    placeholder={t("تشكيلة واسعة من القواطع الكهربائية بأسعار مخفضة...", "تشكيلة واسعة...")}
                  />
                </label>
              </div>

              {/* MEDIA FILE & URL */}
              <div className="full-width" style={{ background: "#f8fafc", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <label style={{ fontWeight: 700, marginBottom: 6, display: "block" }}>
                  {t("Ad Media (Photo, Animated GIF, or MP4/WebM Video, < 15MB)", "وسائط الإعلان (صورة، GIF متحرك، أو فيديو MP4/WebM، أقل من 15 ميجابايت)")}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/ogg,video/quicktime"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        try {
                          const b64 = await toBase64(file);
                          setEditing({ ...editing, mediaUrl: b64 });
                        } catch (err: any) {
                          alert(err.message);
                        }
                      }
                    }}
                  />
                </label>

                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
                    {t("Or paste direct URL:", "أو رابط مباشر:")}
                  </span>
                  <input
                    type="url"
                    placeholder="https://.../promo_video.mp4 or .gif"
                    value={editing.mediaUrl}
                    onChange={(e) => setEditing({ ...editing, mediaUrl: e.target.value.trim() })}
                    style={{ flex: 1, fontSize: 12, padding: "5px 8px" }}
                  />
                </div>

                {editing.mediaUrl && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: "#334155" }}>
                      {t("Live Media Preview:", "معاينة الوسائط:")}
                    </div>
                    {isVideo(editing.mediaUrl) ? (
                      <video
                        src={editing.mediaUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        controls
                        style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 8, display: "block", background: "#000" }}
                      />
                    ) : (
                      <img
                        src={editing.mediaUrl}
                        alt="Preview"
                        style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 8, display: "block", objectFit: "contain" }}
                      />
                    )}
                    <button
                      type="button"
                      className="danger"
                      onClick={() => setEditing({ ...editing, mediaUrl: "" })}
                      style={{ marginTop: 6, padding: "3px 8px", fontSize: 11 }}
                    >
                      {t("Remove Media", "إزالة الوسائط")}
                    </button>
                  </div>
                )}
              </div>

              {/* CALL TO ACTION BUTTON */}
              <div>
                <label>
                  {t("Button Text (CTA)", "نص الزر")}
                  <input
                    type="text"
                    value={editing.ctaText || ""}
                    onChange={(e) => setEditing({ ...editing, ctaText: e.target.value })}
                    placeholder={t("Shop Now / تسوق الآن", "تسوق الآن")}
                  />
                </label>
              </div>

              <div>
                <label>
                  {t("Button Link (Destination URL)", "رابط الزر (الوجهة)")}
                  <input
                    type="text"
                    value={editing.ctaLink || ""}
                    onChange={(e) => setEditing({ ...editing, ctaLink: e.target.value })}
                    placeholder="/store or https://..."
                  />
                </label>
              </div>

              <div className="full-width" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button type="button" onClick={() => setEditing(null)}>
                  {t("Cancel", "إلغاء")}
                </button>
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? t("Saving…", "جارٍ الحفظ…") : t("Save Advertisement", "حفظ الإعلان")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AD PREVIEW POPUP MODAL */}
      {previewAd && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(8px)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewAd(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 18,
              width: "100%",
              maxWidth: 460,
              overflow: "hidden",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)",
              position: "relative",
            }}
          >
            <button
              type="button"
              onClick={() => setPreviewAd(null)}
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                zIndex: 10,
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "rgba(15, 23, 42, 0.6)",
                color: "#fff",
                border: "none",
                fontSize: 16,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ✕
            </button>

            {/* MEDIA */}
            <div style={{ width: "100%", height: 230, background: "#0f172a", overflow: "hidden" }}>
              {isVideo(previewAd.mediaUrl) ? (
                <video
                  src={previewAd.mediaUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <img
                  src={previewAd.mediaUrl}
                  alt={previewAd.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
            </div>

            {/* CONTENT */}
            <div style={{ padding: "20px 22px", textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#c90016", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                {t("SPECIAL PROMOTION", "عرض خاص")}
              </div>
              <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
                {previewAd.title || previewAd.titleAr}
              </h3>
              {(previewAd.description || previewAd.descriptionAr) && (
                <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "#475569", lineHeight: 1.5 }}>
                  {previewAd.description || previewAd.descriptionAr}
                </p>
              )}

              {previewAd.ctaText ? (
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    alert(t("CTA Clicked! Link: ", "تم الضغط على الزر! الرابط: ") + (previewAd.ctaLink || "#"));
                    setPreviewAd(null);
                  }}
                  style={{
                    width: "100%",
                    padding: "11px 20px",
                    fontSize: 15,
                    fontWeight: 700,
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  {previewAd.ctaText}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPreviewAd(null)}
                  style={{
                    width: "100%",
                    padding: "10px 20px",
                    fontSize: 14,
                    borderRadius: 10,
                    cursor: "pointer",
                  }}
                >
                  {t("Close", "إغلاق")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
