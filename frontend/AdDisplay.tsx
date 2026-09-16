"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { appPath } from "../shared/paths";
import type { AdItem } from "./StoreAdsAdmin";

export default function AdDisplay({
  target,
  lang: propLang,
}: {
  target: "WORKSPACE" | "STOREFRONT";
  lang?: "en" | "ar";
}) {
  const [ads, setAds] = useState<AdItem[]>([]);
  const [activePopup, setActivePopup] = useState<AdItem | null>(null);
  const [activeBanner, setActiveBanner] = useState<AdItem | null>(null);
  const intervalTimers = useRef<Record<string, any>>({});

  const [lang] = useState<"en" | "ar">(() => {
    if (propLang) return propLang;
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("amt-store-language") || localStorage.getItem("amt-language");
      if (saved === "ar" || saved === "en") return saved;
      return document.documentElement.lang === "ar" ? "ar" : "en";
    }
    return "en";
  });

  const isAr = lang === "ar";
  const t = (en: string, ar: string) => (isAr ? ar : en);

  const isVideo = (url?: string | null) => {
    if (!url) return false;
    return url.startsWith("data:video/") || /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
  };

  useEffect(() => {
    let mounted = true;

    async function fetchAds() {
      try {
        const res = await api("ads");
        if (!mounted) return;
        const list: AdItem[] = Array.isArray(res?.ads) ? res.ads : [];
        const filtered = list.filter(
          (a) => a.enabled && (a.target === "ALL" || a.target === target),
        );
        setAds(filtered);
      } catch (e) {
        // Silently catch ad fetch issues so it never disrupts core app
      }
    }

    fetchAds();
    return () => {
      mounted = false;
      // Clear interval timers
      Object.values(intervalTimers.current).forEach((tId) => clearInterval(tId));
    };
  }, [target]);

  // Handle Ads Setup (Popups, Intervals, Banners)
  useEffect(() => {
    if (ads.length === 0) return;

    // 1. Check for Banner ads
    const bannerAd = ads.find((a) => a.type === "BANNER");
    if (bannerAd) {
      const dismissed = typeof sessionStorage !== "undefined" && sessionStorage.getItem(`amt-ad-banner-${bannerAd.id}`);
      if (!dismissed) {
        setActiveBanner(bannerAd);
      }
    }

    // 2. Check for Initial Popups
    const popupAd = ads.find((a) => a.type === "POPUP");
    if (popupAd) {
      const dismissed = typeof sessionStorage !== "undefined" && sessionStorage.getItem(`amt-ad-popup-${popupAd.id}`);
      if (!dismissed) {
        const timer = setTimeout(() => {
          setActivePopup(popupAd);
        }, 1200);
        return () => clearTimeout(timer);
      }
    }

    // 3. Set up Interval ads
    const intervalAds = ads.filter((a) => a.type === "INTERVAL");
    intervalAds.forEach((ad) => {
      const secs = Math.max(10, ad.intervalSeconds || 60);
      const timerId = setInterval(() => {
        setActivePopup((current) => {
          if (!current) return ad;
          return current;
        });
      }, secs * 1000);
      intervalTimers.current[ad.id] = timerId;
    });

    return () => {
      Object.values(intervalTimers.current).forEach((tId) => clearInterval(tId));
      intervalTimers.current = {};
    };
  }, [ads]);

  const dismissPopup = (ad: AdItem) => {
    setActivePopup(null);
    if (ad.type === "POPUP" && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(`amt-ad-popup-${ad.id}`, "true");
    }
  };

  const dismissBanner = (ad: AdItem) => {
    setActiveBanner(null);
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(`amt-ad-banner-${ad.id}`, "true");
    }
  };

  const adTitle = (ad: AdItem) => (isAr && ad.titleAr ? ad.titleAr : ad.title);
  const adDesc = (ad: AdItem) => (isAr && ad.descriptionAr ? ad.descriptionAr : ad.description || "");
  const adCta = (ad: AdItem) => (isAr && ad.ctaTextAr ? ad.ctaTextAr : ad.ctaText || t("Explore Now", "اكتشف الآن"));

  return (
    <>
      {/* 1. MODAL POPUP / INTERVAL POPUP AD */}
      {activePopup && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.72)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            animation: "adOverlayFade 0.25s ease-out",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && activePopup.dismissible !== false) {
              dismissPopup(activePopup);
            }
          }}
          dir={isAr ? "rtl" : "ltr"}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 20,
              width: "100%",
              maxWidth: 480,
              overflow: "hidden",
              boxShadow: "0 25px 60px -15px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.05)",
              position: "relative",
              animation: "adScaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* CLOSE BUTTON */}
            {activePopup.dismissible !== false && (
              <button
                type="button"
                onClick={() => dismissPopup(activePopup)}
                aria-label={t("Close", "إغلاق")}
                style={{
                  position: "absolute",
                  top: 14,
                  right: isAr ? "auto" : 14,
                  left: isAr ? 14 : "auto",
                  zIndex: 20,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "rgba(15, 23, 42, 0.65)",
                  backdropFilter: "blur(4px)",
                  color: "#ffffff",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  fontSize: 16,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
                  transition: "transform 0.15s ease",
                }}
              >
                ✕
              </button>
            )}

            {/* AD MEDIA */}
            <div
              style={{
                width: "100%",
                height: 250,
                background: "#0f172a",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {isVideo(activePopup.mediaUrl) ? (
                <video
                  src={activePopup.mediaUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <img
                  src={activePopup.mediaUrl}
                  alt={adTitle(activePopup)}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              )}
            </div>

            {/* CONTENT BODY */}
            <div style={{ padding: "22px 24px", textAlign: "center" }}>
              <div
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#c90016",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                  background: "#fee2e2",
                  padding: "3px 10px",
                  borderRadius: 12,
                }}
              >
                {t("SPECIAL PROMOTION", "عرض خاص ومميز")}
              </div>

              <h3
                style={{
                  margin: "8px 0",
                  fontSize: 21,
                  fontWeight: 800,
                  color: "#0f172a",
                  lineHeight: 1.3,
                }}
              >
                {adTitle(activePopup)}
              </h3>

              {adDesc(activePopup) && (
                <p
                  style={{
                    margin: "0 0 20px",
                    fontSize: 14,
                    color: "#475569",
                    lineHeight: 1.55,
                  }}
                >
                  {adDesc(activePopup)}
                </p>
              )}

              {/* ACTION BUTTON */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                {activePopup.ctaText ? (
                  <a
                    href={activePopup.ctaLink || "#"}
                    onClick={() => dismissPopup(activePopup)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "13px 20px",
                      background: "linear-gradient(135deg, #c90016, #990011)",
                      color: "#ffffff",
                      fontSize: 15,
                      fontWeight: 700,
                      borderRadius: 12,
                      textAlign: "center",
                      textDecoration: "none",
                      boxShadow: "0 4px 14px rgba(201, 0, 22, 0.35)",
                      cursor: "pointer",
                      boxSizing: "border-box",
                    }}
                  >
                    {adCta(activePopup)}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => dismissPopup(activePopup)}
                    style={{
                      width: "100%",
                      padding: "11px 20px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      color: "#334155",
                      cursor: "pointer",
                    }}
                  >
                    {t("Continue", "متابعة")}
                  </button>
                )}

                {activePopup.dismissible !== false && (
                  <button
                    type="button"
                    onClick={() => dismissPopup(activePopup)}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: 12.5,
                      color: "#64748b",
                      cursor: "pointer",
                      padding: "6px",
                    }}
                  >
                    {t("Dismiss", "إغلاق والتخطي")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. FLOATING BOTTOM BANNER AD */}
      {activeBanner && (
        <div
          dir={isAr ? "rtl" : "ltr"}
          style={{
            position: "fixed",
            bottom: 18,
            left: isAr ? 18 : "auto",
            right: isAr ? "auto" : 18,
            zIndex: 99990,
            maxWidth: 420,
            width: "calc(100% - 36px)",
            background: "#ffffff",
            borderRadius: 16,
            padding: "12px 14px",
            boxShadow: "0 12px 30px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            animation: "adSlideUp 0.3s ease-out",
          }}
        >
          {/* MEDIA THUMBNAIL */}
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: 10,
              background: "#0f172a",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            {isVideo(activeBanner.mediaUrl) ? (
              <video
                src={activeBanner.mediaUrl}
                autoPlay
                loop
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <img
                src={activeBanner.mediaUrl}
                alt={adTitle(activeBanner)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </div>

          {/* COPY */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 800,
                color: "#0f172a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {adTitle(activeBanner)}
            </div>
            {adDesc(activeBanner) && (
              <div
                style={{
                  fontSize: 12,
                  color: "#64748b",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  marginTop: 2,
                }}
              >
                {adDesc(activeBanner)}
              </div>
            )}
            {activeBanner.ctaText && (
              <a
                href={activeBanner.ctaLink || "#"}
                onClick={() => dismissBanner(activeBanner)}
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#c90016",
                  textDecoration: "none",
                  marginTop: 3,
                }}
              >
                {adCta(activeBanner)} →
              </a>
            )}
          </div>

          {/* DISMISS BUTTON */}
          {activeBanner.dismissible !== false && (
            <button
              type="button"
              onClick={() => dismissBanner(activeBanner)}
              aria-label={t("Close", "إغلاق")}
              style={{
                background: "transparent",
                border: "none",
                fontSize: 16,
                color: "#94a3b8",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </>
  );
}
