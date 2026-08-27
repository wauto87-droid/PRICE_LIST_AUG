"use client";
import { useEffect, useState } from "react";
import type { Translate } from "./api";
import { installState } from "./pwa-state";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
const isInstalled = () =>
  matchMedia("(display-mode: standalone)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function PwaInstaller({ t }: { t: Translate }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null),
    [installed, setInstalled] = useState(false),
    [ios, setIos] = useState(false),
    [secure, setSecure] = useState(true),
    [open, setOpen] = useState(false),
    [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setInstalled(isInstalled());
    setIos(isIos());
    setSecure(window.isSecureContext);
    const offered = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
      setDismissed(false);
    };
    const completed = () => {
      setInstalled(true);
      setPrompt(null);
      setOpen(false);
    };
    window.addEventListener("beforeinstallprompt", offered);
    window.addEventListener("appinstalled", completed);
    const media = matchMedia("(display-mode: standalone)");
    const displayChanged = () => setInstalled(isInstalled());
    media.addEventListener?.("change", displayChanged);
    return () => {
      window.removeEventListener("beforeinstallprompt", offered);
      window.removeEventListener("appinstalled", completed);
      media.removeEventListener?.("change", displayChanged);
    };
  }, []);
  const state = installState({
    development: process.env.NODE_ENV !== "production",
    installed,
    ios,
    secure,
    promptAvailable: Boolean(prompt),
  });
  async function install() {
    if (state !== "ready" || !prompt) {
      setOpen(true);
      return;
    }
    await prompt.prompt();
    const result = await prompt.userChoice;
    setPrompt(null);
    if (result.outcome === "accepted") setInstalled(true);
    else {
      setDismissed(true);
      setOpen(true);
    }
  }
  const guidance =
    state === "installed"
      ? t(
          "AMT Electric is installed on this device. Open it from your apps or Home Screen.",
          "تطبيق AMT Electric مثبت على هذا الجهاز. افتحه من التطبيقات أو الشاشة الرئيسية.",
        )
      : state === "development"
        ? t(
            "Installation is disabled in the development preview to prevent stale cached files. Test it using a production build on localhost, or install it from the final HTTPS domain.",
            "التثبيت معطل في نسخة التطوير لمنع الملفات القديمة المخزنة. اختبره بإصدار الإنتاج على localhost أو ثبته من نطاق HTTPS النهائي.",
          )
        : state === "insecure"
          ? t(
              "Installation requires the final HTTPS domain. This temporary HTTP connection cannot install the app.",
              "يتطلب التثبيت نطاق HTTPS النهائي. لا يمكن تثبيت التطبيق من اتصال HTTP المؤقت.",
            )
          : state === "ios"
            ? t(
                "On iPhone or iPad: open this page in Safari, tap Share, then choose Add to Home Screen.",
                "على iPhone أو iPad: افتح الصفحة في Safari، اضغط مشاركة، ثم اختر إضافة إلى الشاشة الرئيسية.",
              )
            : dismissed
              ? t(
                  "Installation was cancelled. You can try again from your browser menu when Install App becomes available.",
                  "تم إلغاء التثبيت. يمكنك المحاولة مرة أخرى من قائمة المتصفح عند ظهور تثبيت التطبيق.",
                )
              : t(
                  "Your browser has not offered installation yet. Use its menu and choose Install app or Add to Home screen. Chrome or Edge on Android/desktop is recommended.",
                  "لم يعرض المتصفح التثبيت بعد. افتح قائمة المتصفح واختر تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية. يوصى باستخدام Chrome أو Edge.",
                );
  return (
    <>
      <button
        type="button"
        className={"install-button " + (state === "ready" ? "primary" : "")}
        onClick={install}
        aria-haspopup="dialog"
        title={t(
          "Install AMT Electric on this device",
          "تثبيت AMT Electric على هذا الجهاز",
        )}
      >
        <span aria-hidden>{state === "installed" ? "✓" : "⇩"}</span>{" "}
        {state === "installed"
          ? t("App Installed", "التطبيق مثبت")
          : t("Install App", "تثبيت التطبيق")}
      </button>
      {open && (
        <div className="modal-backdrop install-backdrop" role="presentation">
          <section
            className="install-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
          >
            <div className="install-icon" aria-hidden>
              AMT
            </div>
            <h2 id="install-title">
              {state === "installed"
                ? t("App Installed", "التطبيق مثبت")
                : t("Install AMT Electric", "تثبيت AMT Electric")}
            </h2>
            <p>{guidance}</p>
            {state === "ios" && (
              <ol>
                <li>{t("Open in Safari", "افتح في Safari")}</li>
                <li>{t("Tap Share", "اضغط مشاركة")}</li>
                <li>
                  {t(
                    "Choose Add to Home Screen",
                    "اختر إضافة إلى الشاشة الرئيسية",
                  )}
                </li>
              </ol>
            )}
            <button
              className="primary"
              type="button"
              onClick={() => setOpen(false)}
              autoFocus
            >
              {t("Close", "إغلاق")}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
