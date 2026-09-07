"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
export default function WhatsAppAdmin({ t }: { t: Translate }) {
  const [state, setState] = useState<any>(),
    [now, setNow] = useState(Date.now()),
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
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); clearInterval(clock); };
  }, []);
  async function action(name: string) {
    setBusy(true);
    setNotice("");
    setError("");
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
      {state?.diagnostic && <p role="status">{state.diagnostic}</p>}
      {state?.status === "STARTING" && <p>{t("Starting WhatsApp. A QR code will appear when the browser is ready.", "جارٍ تشغيل واتساب. سيظهر رمز الاتصال عندما يصبح المتصفح جاهزاً.")}</p>}
      {state?.qrExpiresAt && state.qrExpiresAt <= now && state.status !== "READY" && <p role="status">{t("QR expired. Reconnect to request a new code.", "انتهت صلاحية الرمز. أعد الاتصال لطلب رمز جديد.")}</p>}
      {state?.qr && (!state.qrExpiresAt || state.qrExpiresAt > now) && (
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
      {state?.qr && state.qrExpiresAt > now && <p>{t("QR expires in", "تنتهي صلاحية الرمز خلال")} {Math.ceil((state.qrExpiresAt-now)/1000)} {t("seconds", "ثانية")}</p>}
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
