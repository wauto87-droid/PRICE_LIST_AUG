"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";
export default function WhatsAppAdmin({ t }: { t: Translate }) {
  const [state, setState] = useState<any>(),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    actionPending = useRef(false),
    mounted = useRef(false);
  const unavailable = (message: string) => ({
    status: /authentication/i.test(message)
      ? "AUTH_FAILED"
      : /not configured/i.test(message)
        ? "NOT_CONFIGURED"
        : "UNREACHABLE",
    qr: null,
  });
  async function refresh() {
    if (actionPending.current) return;
    const current = ++generation.current;
    try {
      const result = await api("storefront-admin/whatsapp/status");
      if (!mounted.current || current !== generation.current) return;
      setState(result);
      setError("");
    } catch (e) {
      if (!mounted.current || current !== generation.current) return;
      setError((e as Error).message);
      setState(unavailable((e as Error).message));
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      ++generation.current;
      clearInterval(timer);
      clearInterval(clock);
    };
  }, []);
  async function action(name: string) {
    if (actionPending.current) return;
    actionPending.current = true;
    const current = ++generation.current;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await api(
        `storefront-admin/whatsapp/${name}`,
        "POST",
        name === "test" ? { mobile } : {},
      );
      if (!mounted.current || current !== generation.current) return;
      if (name !== "test") setState(result);
      if (name === "test")
        setNotice(t("Test message sent", "تم إرسال رسالة الاختبار"));
    } catch (e) {
      if (mounted.current && current === generation.current)
        setError((e as Error).message);
    } finally {
      actionPending.current = false;
      if (mounted.current) {
        setBusy(false);
        void refresh();
      }
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
        {state?.status || t("Loading…", "جارٍ التحميل…")}{" "}
        {state?.number ? `(+${state.number})` : ""}
      </p>
      {state?.diagnostic && <p role="status">{state.diagnostic}</p>}
      {state?.status === "STARTING" && (
        <p>
          {t(
            "Starting WhatsApp. A QR code will appear when the browser is ready.",
            "جارٍ تشغيل واتساب. سيظهر رمز الاتصال عندما يصبح المتصفح جاهزاً.",
          )}
        </p>
      )}
      {state?.qrExpiresAt &&
        state.qrExpiresAt <= now &&
        state.status !== "READY" && (
          <p role="status">
            {t(
              "QR expired. Reconnect to request a new code.",
              "انتهت صلاحية الرمز. أعد الاتصال لطلب رمز جديد.",
            )}
          </p>
        )}
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
      {state?.qr && state.qrExpiresAt > now && (
        <p>
          {t("QR expires in", "تنتهي صلاحية الرمز خلال")}{" "}
          {Math.ceil((state.qrExpiresAt - now) / 1000)} {t("seconds", "ثانية")}
        </p>
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
