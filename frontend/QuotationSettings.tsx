"use client";
import { useEffect, useState } from "react";
import { api, type Translate } from "./api";
import { showConfirm } from "./confirm";
import type { AdminActionRunner } from "./admin-actions";
import { wheelSafeNumberInputProps } from "./number-input";
export default function QuotationSettings({
  t,
  actionBusy,
  onAction,
}: {
  t: Translate;
  actionBusy: boolean;
  onAction: AdminActionRunner;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [html, setHtml] = useState(""),
    [busy, setBusy] = useState(false),
    [next, setNext] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    api("admin/quotation-settings")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <p role="alert">{error || t("Loading…", "جار التحميل")}</p>;
  const q = data.quotation,
    w = q.watermark;
  const change = (key: string, value: any) => {
    setHtml("");
    setData({ ...data, quotation: { ...q, [key]: value } });
  };
  const wm = (key: string, value: any) =>
    change("watermark", { ...w, [key]: value });
  const payload = () => ({
    quotation: q,
    version: data.version,
    companyName: data.companyName,
    companyArabic: data.companyArabic,
    pdfUnitPrices: data.pdfUnitPrices,
    ...(next ? { nextSerial: next, reason } : {}),
  });
  const image = async (file: File | undefined, watermark: boolean) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 500000
    )
      throw Error("Use PNG/JPEG/WebP smaller than 500 KB");
    const value = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(Error("Image could not be read"));
      r.readAsDataURL(file);
    });
    watermark ? wm("image", value) : change("logo", value);
  };
  return (
    <div className="quotation-settings">
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <p>
        {t(
          "Issued quotations keep their original company details, artwork and terms. Changes apply only to future issues.",
          "تحتفظ العروض الصادرة ببياناتها الأصلية. تسري التغييرات على الإصدارات الجديدة فقط.",
        )}
      </p>
      <div className="form-grid three">
        {(["companyName", "companyArabic"] as const).map((key) => (
          <label key={key}>
            {key === "companyName"
              ? "Company name / اسم الشركة"
              : "Arabic company name / الاسم العربي"}
            <input
              value={data[key]}
              onChange={(e) => setData({ ...data, [key]: e.target.value })}
            />
          </label>
        ))}
        {Object.entries({
          legalName: "Legal name / الاسم القانوني",
          vatRegistration: "VAT registration / الرقم الضريبي",
          commercialRegistration: "Commercial registration / السجل التجاري",
          address: "Address / العنوان",
          city: "City / المدينة",
          country: "Country / الدولة",
          phone: "Phone / الهاتف",
          email: "Email / البريد",
          website: "Website / الموقع",
          bankName: "Bank / البنك",
          accountName: "Account name / اسم الحساب",
          iban: "IBAN",
          delivery: "Delivery / التسليم",
          payment: "Payment terms / شروط الدفع",
          notes: "Notes / ملاحظات",
          termsEnglish: "English terms",
          termsArabic: "الشروط العربية",
          signatureLabel: "Signature label / التوقيع",
          footer: "Footer / التذييل",
        }).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              rows={key.startsWith("terms") ? 4 : 2}
              value={q[key]}
              onChange={(e) => change(key, e.target.value)}
            />
          </label>
        ))}
        <label>
          Validity days / صلاحية العرض
          <input
            type="number"
            min="0"
            max="365"
            {...wheelSafeNumberInputProps}
            value={q.validityDays}
            onChange={(e) => change("validityDays", Number(e.target.value))}
          />
        </label>
        <label>
          Unit price display / عرض سعر الوحدة
          <select
            value={data.pdfUnitPrices}
            onChange={(e) =>
              setData({ ...data, pdfUnitPrices: e.target.value })
            }
          >
            <option value="BOTH">Before VAT + small inclusive reference</option>
            <option value="EXCL">Before VAT</option>
            <option value="INCL">Including VAT</option>
          </select>
        </label>
        <label>
          Currency / VAT (General Settings)
          <input readOnly value={`${data.currency} / ${data.vat}%`} />
        </label>
        <label>
          Customer-facing logo (blank = AMT)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => run(() => image(e.target.files?.[0], false))}
          />
          <button onClick={() => change("logo", "")}>Use AMT logo</button>
        </label>
      </div>
      <h3>{t("Watermark", "العلامة المائية")}</h3>
      <div className="form-grid three">
        <label className="check">
          <input
            type="checkbox"
            checked={w.enabled}
            onChange={(e) => wm("enabled", e.target.checked)}
          />
          Enabled / تفعيل
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={w.useLogo}
            onChange={(e) => wm("useLogo", e.target.checked)}
          />
          Use company logo / شعار الشركة
        </label>
        <label>
          Image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => run(() => image(e.target.files?.[0], true))}
          />
          <button onClick={() => wm("image", "")}>Clear image</button>
        </label>
        <label>
          Watermark text / نص العلامة
          <input
            value={w.text}
            maxLength={100}
            onChange={(e) => wm("text", e.target.value)}
          />
        </label>
        {(
          [
            ["opacity", 0.02, 0.25, 0.01],
            ["size", 80, 450, 1],
            ["rotation", -90, 90, 1],
          ] as const
        ).map(([key, min, max, step]) => (
          <label key={key}>
            {key}
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              {...wheelSafeNumberInputProps}
              value={w[key]}
              onChange={(e) => wm(key, Number(e.target.value))}
            />
          </label>
        ))}
        <label>
          Position
          <select
            value={w.position}
            onChange={(e) => wm("position", e.target.value)}
          >
            <option>CENTER</option>
            <option>TOP</option>
            <option>BOTTOM</option>
          </select>
        </label>
      </div>
      <h3>{t("Permanent global numbering", "الترقيم العام الدائم")}</h3>
      <p>
        Last allocated: {data.sequence.last ?? "—"} · Next: {data.sequence.next}
        . Gaps are permitted; numbers never reset.
      </p>
      <div className="form-grid three">
        <label>
          Prefix
          <input
            value={q.prefix}
            onChange={(e) => change("prefix", e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Digits
          <input
            type="number"
            min="4"
            max="12"
            {...wheelSafeNumberInputProps}
            value={q.padding}
            onChange={(e) => change("padding", Number(e.target.value))}
          />
        </label>
        <label>
          Raise next serial (optional)
          <input
            inputMode="numeric"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label>
          Mandatory reason for increase
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="actions wrap">
        <button
          disabled={busy || actionBusy}
          onClick={() =>
            run(async () => {
              setHtml(
                (
                  await api("admin/quotation-settings/preview", "POST", {
                    quotation: q,
                    companyName: data.companyName,
                    companyArabic: data.companyArabic,
                    pdfUnitPrices: data.pdfUnitPrices,
                  })
                ).html,
              );
            })
          }
        >
          {t("Preview A4", "معاينة A4")}
        </button>
        <button
          className="primary"
          disabled={busy || actionBusy}
          onClick={() =>
            onAction(
              {
                saving: t(
                  "Saving quotation settings…",
                  "جارٍ حفظ إعدادات عرض السعر…",
                ),
                success: t(
                  "Quotation settings saved",
                  "تم حفظ إعدادات عرض السعر",
                ),
                successDetail: t(
                  "The latest quotation settings are now active.",
                  "أصبحت أحدث إعدادات عرض السعر مفعلة الآن.",
                ),
                error: t(
                  "Quotation settings could not be saved",
                  "تعذر حفظ إعدادات عرض السعر",
                ),
              },
              async () => {
              if (
                next &&
                !(await showConfirm(
                  `Permanently raise the next quotation serial to ${next}? It cannot be reduced.`,
                ))
              )
                return;
                const saved = await api(
                  "admin/quotation-settings",
                  "PUT",
                  payload(),
                );
                setData(saved);
                setNext("");
                setReason("");
                setHtml("");
              },
            )
          }
        >
          {actionBusy
            ? t("Saving…", "جارٍ الحفظ…")
            : t("Save settings", "حفظ الإعدادات")}
        </button>
      </div>
      {html && (
        <iframe
          title="Quotation A4 preview"
          sandbox=""
          srcDoc={html}
          style={{
            width: "100%",
            height: 800,
            border: "1px solid #ddd",
            marginTop: 20,
          }}
        />
      )}
    </div>
  );
}
