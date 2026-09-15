"use client";

import { useState } from "react";
import { appPath } from "../shared/paths";

export default function MaintenanceBanner({
  text,
  image,
  title,
  whatsappNumber,
  supportMobile,
}: {
  text?: string;
  image?: string | null;
  title?: string;
  whatsappNumber?: string | null;
  supportMobile?: string | null;
}) {
  const [lang, setLang] = useState<"en" | "ar">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("amt-language");
      if (saved === "ar" || saved === "en") return saved;
      return document.documentElement.lang === "ar" ? "ar" : "en";
    }
    return "en";
  });

  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const isAr = lang === "ar";

  const toggleLang = () => {
    const next = lang === "en" ? "ar" : "en";
    setLang(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("amt-language", next);
      document.documentElement.lang = next;
      document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    }
  };

  const defaultTitle = t(
    "Scheduled Maintenance",
    "أعمال صيانة وتحديث مجدولة",
  );
  const defaultText = t(
    "We are currently performing essential system updates and performance enhancements to serve you better. All services and features will automatically resume as soon as the maintenance window concludes.",
    "نقوم حالياً بإجراء تحديثات وتحسينات أساسية على النظام لخدمتكم بأعلى كفاءة وأمان. ستعود كافة الخدمات للعمل تلقائياً فور انتهاء فترة الصيانة.",
  );

  const displayTitle = title || defaultTitle;
  const customText = (text || "").trim();

  // Validate contact numbers - strictly avoid placeholder / random numbers
  const rawWa = (whatsappNumber || "").trim();
  const cleanWa = rawWa.replace(/\D/g, "");
  const hasWhatsApp = cleanWa.length >= 7;

  const rawPhone = (supportMobile || "").trim();
  const cleanPhone = rawPhone.replace(/[^\d+]/g, "");
  const hasPhone = cleanPhone.replace(/\D/g, "").length >= 7;

  return (
    <div className="maintenance-screen" dir={isAr ? "rtl" : "ltr"}>
      <div className="maintenance-backdrop-glow" aria-hidden="true" />
      <div className="maintenance-backdrop-grid" aria-hidden="true" />

      <header className="maintenance-nav">
        <div className="maintenance-brand">
          <img 
            src={appPath("/logo.svg")} 
            alt="AMT Electric" 
            className="maintenance-brand-logo"
            onError={(e) => {
              (e.target as HTMLElement).style.display = "none";
            }}
          />
          <div className="maintenance-brand-text">
            <span className="maintenance-brand-name">
              AMT <em>ELECTRIC</em>
            </span>
            <span className="maintenance-brand-sub">
              {t("Electrical Supplies & Solutions", "للمواد والحلول الكهربائية")}
            </span>
          </div>
        </div>

        <button 
          type="button" 
          onClick={toggleLang}
          className="maintenance-lang-btn"
          aria-label="Change language"
        >
          <span className="maintenance-lang-globe">🌐</span>
          <span>{lang === "en" ? "العربية" : "English"}</span>
        </button>
      </header>

      <main className="maintenance-content">
        <div className="maintenance-card">
          <div className="maintenance-card-accent" aria-hidden="true" />

          <div className="maintenance-status-badge">
            <span className="maintenance-pulse-dot" aria-hidden="true" />
            <span>{t("System Maintenance Active", "وضع الصيانة قيد التشغيل")}</span>
          </div>

          {image ? (
            <div className="maintenance-image-wrapper">
              <img
                src={image}
                alt="System Maintenance"
                className="maintenance-custom-image"
              />
            </div>
          ) : (
            <div className="maintenance-hero-icon">
              <div className="maintenance-icon-halo" aria-hidden="true" />
              <div className="maintenance-icon-core">
                <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
            </div>
          )}

          <h1 className="maintenance-title">{displayTitle}</h1>

          {customText ? (
            <div className="maintenance-highlight-card">
              <div className="maintenance-highlight-header">
                <span className="maintenance-highlight-badge">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <span>{t("Important Notice", "تنبيه هام")}</span>
                </span>
              </div>
              <div className="maintenance-highlight-text">
                {customText}
              </div>
            </div>
          ) : null}

          <p className={customText ? "maintenance-sub-description" : "maintenance-description"}>
            {defaultText}
          </p>

          <div className="maintenance-autorecovery-box">
            <div className="maintenance-radar" aria-hidden="true">
              <span className="radar-beam" />
              <span className="radar-center" />
            </div>
            <div className="maintenance-autorecovery-text">
              <strong>{t("Automatic Live Reconnect Active", "استئناف الخدمة التلقائي نشط")}</strong>
              <span>{t("This page monitors the server in real time and will automatically unlock as soon as maintenance finishes — no refresh needed.", "تراقب هذه الصفحة الخادم بشكل مباشر وتستأنف الخدمة تلقائياً فور انتهاء أعمال الصيانة دون الحاجة لتحديث الصفحة.")}</span>
            </div>
          </div>

          {(hasWhatsApp || hasPhone) && (
            <div className="maintenance-footer-actions">
              {hasWhatsApp && (
                <a 
                  href={`https://wa.me/${cleanWa}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="maintenance-action-btn whatsapp"
                >
                  <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                  </svg>
                  <span>{t("WhatsApp Support", "تواصل عبر واتساب")}</span>
                </a>
              )}

              {hasPhone && (
                <a href={`tel:${cleanPhone}`} className="maintenance-action-btn phone">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <span>{rawPhone}</span>
                </a>
              )}
            </div>
          )}
        </div>

        <footer className="maintenance-footer-note">
          <p>&copy; {new Date().getFullYear()} AMT Electric · {t("All rights reserved.", "جميع الحقوق محفوظة.")}</p>
        </footer>
      </main>
    </div>
  );
}
