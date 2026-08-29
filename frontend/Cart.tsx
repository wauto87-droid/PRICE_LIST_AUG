"use client";
import { useState } from "react";
import { api, type Translate } from "./api";
import { totals } from "@/backend/pricing/engine";
import { levelLabel, visibleLevels } from "./levels";
import { wheelSafeNumberInputProps } from "./number-input";
export default function Cart({
  t,
  cart,
  setCart,
  online,
  onSaved,
}: {
  t: Translate;
  cart: any;
  setCart: (c: any) => void;
  online: boolean;
  onSaved: (q: any) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Record<string, any[]>>({});
  async function loadLevels(productId: string) {
    try {
      const p = await api("products/" + productId);
      setOptions((v) => ({ ...v, [productId]: visibleLevels(p) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const valid = cart.lines.every((l: any) => l.price && !l.pending);
  const sum = valid ? totals(cart.lines.map((l: any) => l.price)) : null;
  function change(index: number, key: string, value: string) {
    const lines = cart.lines.map((l: any, i: number) =>
      i === index
        ? {
            ...l,
            pending: true,
            input: { ...l.input, [key]: value, override: false, reason: "" },
          }
        : l,
    );
    setCart({ ...cart, lines });
  }
  async function reprice() {
    setBusy(true);
    setError("");
    try {
      const lines = [];
      for (const line of cart.lines)
        lines.push({
          ...line,
          price: await api("pricing", "POST", {
            ...line.input,
            sellingLevel:
              line.input.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER",
          }),
          pending: false,
          offline: false,
        });
      setCart({ ...cart, lines });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    const requestId = cart.requestId || crypto.randomUUID();
    if (!cart.id && !cart.requestId) setCart({ ...cart, requestId });
    try {
      const q = await api(
        "quotations" + (cart.id ? "/" + cart.id : ""),
        cart.id ? "PUT" : "POST",
        {
          customer: cart.customer,
          lines: cart.lines.map((l: any) => ({
            ...l.input,
            sellingLevel:
              l.input.sellingLevel ?? l.sellingLevel ?? "END_CUSTOMER",
          })),
          ...(cart.id ? { version: cart.version } : { requestId }),
        },
      );
      setCart({
        ...cart,
        id: q.id,
        version: q.version,
        number: q.number,
        lines: q.lines,
      });
      onSaved(q);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="section-title">
        <div>
          <div className="eyebrow">{t("QUOTATION CART", "سلة عرض السعر")}</div>
          <h2>{cart.number || t("New draft", "مسودة جديدة")}</h2>
          <p className="muted cart-subtitle">
            {t(
              "Review customer details, add internal notes, and save the draft when ready.",
              "راجع بيانات العميل وأضف الملاحظات واحفظ المسودة عندما تصبح جاهزة.",
            )}
          </p>
        </div>
        <span className="pill">
          {cart.lines.length} {t("items", "أصناف")}
        </span>
      </div>
      <div className="form-grid">
        {[
          ["name", "Customer name", "اسم العميل"],
          ["number", "Customer number", "رقم العميل"],
          ["mobile", "Mobile", "الجوال"],
          ["reference", "Reference", "المرجع"],
        ].map(([key, en, ar]) => (
          <label key={key}>
            {t(en, ar)}
            <input
              value={cart.customer[key]}
              onChange={(e) =>
                setCart({
                  ...cart,
                  customer: { ...cart.customer, [key]: e.target.value },
                })
              }
              placeholder={
                key === "name"
                  ? t("Walk-in Customer (optional)", "عميل نقدي (اختياري)")
                  : ""
              }
            />
          </label>
        ))}
        <label className="cart-notes">
          {t("Notes", "ملاحظات")}
          <textarea
            rows={4}
            value={cart.customer.notes || ""}
            onChange={(e) =>
              setCart({
                ...cart,
                customer: { ...cart.customer, notes: e.target.value },
              })
            }
            placeholder={t(
              "Staff notes, customer requests, delivery details, or any extra quotation context.",
              "ملاحظات الموظف أو طلبات العميل أو تفاصيل التسليم أو أي تفاصيل إضافية لعرض السعر.",
            )}
          />
        </label>
      </div>
      {!cart.lines.length ? (
        <div className="empty-state">
          <h2>{t("Your cart is ready", "سلتك جاهزة")}</h2>
          <p>
            {t(
              "Add products from Lookup to start your quotation.",
              "أضف أصنافاً من البحث لبدء عرض السعر.",
            )}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Part / description", "الصنف / الوصف")}</th>
                <th>{t("Qty", "الكمية")}</th>
                <th>{t("Discount %", "الخصم %")}</th>
                <th>{t("Final excl. VAT", "النهائي قبل الضريبة")}</th>
                <th>{t("Total incl. VAT", "الإجمالي شامل الضريبة")}</th>
                <th>{t("Actions", "إجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {cart.lines.map((l: any, i: number) => (
                <tr key={i}>
                  <td>
                    <strong>{l.partNumber}</strong>
                    <small>{l.description}</small>
                    <label>
                      {t("Selling level", "مستوى سعر البيع")}
                      <select
                        aria-label={
                          t("Selling level", "مستوى سعر البيع") +
                          " " +
                          l.partNumber
                        }
                        disabled={busy}
                        onFocus={() => {
                          if (online) loadLevels(l.productId);
                        }}
                        value={
                          l.input.sellingLevel ??
                          l.sellingLevel ??
                          "END_CUSTOMER"
                        }
                        onChange={(e) =>
                          change(i, "sellingLevel", e.target.value)
                        }
                      >
                        <option
                          value={
                            l.input.sellingLevel ??
                            l.sellingLevel ??
                            "END_CUSTOMER"
                          }
                        >
                          {levelLabel(
                            l.input.sellingLevel ?? l.sellingLevel,
                            t,
                          )}
                        </option>
                        {(options[l.productId] ?? l.sellingLevels ?? [])
                          .filter(
                            (v) =>
                              v.code !==
                              (l.input.sellingLevel ??
                                l.sellingLevel ??
                                "END_CUSTOMER"),
                          )
                          .map((v) => (
                            <option key={v.code} value={v.code}>
                              {levelLabel(v.code, t)} · {v.masterExcl}
                            </option>
                          ))}
                      </select>
                    </label>
                  </td>
                  <td>
                    <input
                      aria-label={t("Quantity", "الكمية") + " " + l.partNumber}
                      className="compact"
                      type="number"
                      min="0.001"
                      step="any"
                      {...wheelSafeNumberInputProps}
                      value={l.input.quantity}
                      onChange={(e) => change(i, "quantity", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={t("Discount", "الخصم") + " " + l.partNumber}
                      className="compact"
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      {...wheelSafeNumberInputProps}
                      value={l.input.discount}
                      onChange={(e) => change(i, "discount", e.target.value)}
                    />
                  </td>
                  <td>{l.pending ? "—" : (l.price?.finalExcl ?? "—")}</td>
                  <td>{l.pending ? "—" : (l.price?.total ?? "—")}</td>
                  <td>
                    <div className="actions">
                      <button
                        title={t("Move up", "للأعلى")}
                        disabled={i === 0}
                        onClick={() => {
                          const lines = [...cart.lines];
                          [lines[i - 1], lines[i]] = [lines[i], lines[i - 1]];
                          setCart({ ...cart, lines });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        title={t("Remove", "حذف")}
                        onClick={() =>
                          setCart({
                            ...cart,
                            lines: cart.lines.filter(
                              (_: any, n: number) => n !== i,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!valid && (
        <div className="notice">
          {t(
            "Changes need online price validation. Use Recalculate before saving.",
            "تحتاج التغييرات إلى التحقق عبر الإنترنت. أعد الحساب قبل الحفظ.",
          )}
        </div>
      )}
      {sum && (
        <div className="cart-totals">
          <span>
            {t("Subtotal", "المجموع")} <b>{sum.subtotal}</b>
          </span>
          <span>
            {t("VAT", "الضريبة")} <b>{sum.vat}</b>
          </span>
          <span className="grand-total">
            {t("Grand total", "الإجمالي")} <b>SAR {sum.total}</b>
          </span>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="actions footer-actions">
        <button
          disabled={!online || busy || !cart.lines.length}
          onClick={reprice}
        >
          {t("Recalculate", "إعادة الحساب")}
        </button>
        <button
          className="primary"
          disabled={!online || busy || !cart.lines.length || !valid}
          onClick={save}
        >
          {busy ? t("Saving…", "جارٍ الحفظ…") : t("Save draft", "حفظ المسودة")}
        </button>
      </div>
      <p className="muted">
        {online
          ? t(
              "Customer details are optional. Master product prices are never changed by cart discounts.",
              "بيانات العميل اختيارية. خصومات السلة لا تغير أسعار الكتالوج.",
            )
          : t(
              "Offline draft — changes remain on this device until you reconnect and save.",
              "مسودة دون اتصال — تبقى التغييرات على الجهاز حتى الاتصال والحفظ.",
            )}
      </p>
    </section>
  );
}
