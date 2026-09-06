"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
export default function WhatsAppAdmin({ t }: { t: Translate }) {
  const [state, setState] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(""),
    [notice, setNotice] = useState("");
  async function refresh() {
    try {
      setState(await api("storefront-admin/whatsapp/status"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, []);
  async function action(name: string) {
    setBusy(true);
    setNotice("");
    try {
      await api(
        `storefront-admin/whatsapp/${name}`,
        "POST",
        name === "test" ? { mobile } : {},
      );
      if (name === "test")
        setNotice(t("Test message sent", "تم إرسال رسالة الاختبار"));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>{t("WhatsApp verification service", "خدمة التحقق عبر واتساب")}</h2>
      <p>
        {t(
          "Link the company phone to enable mandatory signup verification. Open WhatsApp → Linked devices → Link a device.",
          "اربط هاتف الشركة لتفعيل التحقق الإلزامي عند التسجيل. افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p role="status">
        {state?.status || t("Unavailable", "غير متاح")}{" "}
        {state?.number ? `(+${state.number})` : ""}
      </p>
      {state?.qr && (
        <img
          src={state.qr}
          width={256}
          height={256}
          alt={t(
            "Scan with the company WhatsApp phone",
            "امسح الرمز بهاتف واتساب الشركة",
          )}
        />
      )}
      <div className="actions">
        <button disabled={busy} onClick={() => action("connect")}>
          {t("Connect / reconnect", "اتصال / إعادة الاتصال")}
        </button>
        <button
          disabled={busy || !state || state.status === "DISCONNECTED"}
          onClick={() => action("disconnect")}
        >
          {t("Disconnect", "قطع الاتصال")}
        </button>
      </div>
      <label>
        {t("Test mobile number", "رقم الجوال للاختبار")}
        <input
          type="tel"
          placeholder="+9665…"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
        />
      </label>
      <button
        disabled={busy || state?.status !== "READY" || !mobile}
        onClick={() => action("test")}
      >
        {t("Send test message", "إرسال رسالة اختبار")}
      </button>
    </section>
  );
}
