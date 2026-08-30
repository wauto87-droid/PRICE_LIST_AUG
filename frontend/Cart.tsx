"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";
import { totals, calculateCustom } from "@/backend/pricing/engine";
import { levelLabel, visibleLevels } from "./levels";
import { wheelSafeNumberInputProps } from "./number-input";
import CustomLineForm from "./CustomLineForm";
import QuotationLineQuickAdd from "./QuotationLineQuickAdd";
import { humanizeCustomLineError } from "./custom-line-errors";
import {
  cartLineHasBlockingError,
  catalogLivePricingInput,
  livePricingSignature,
} from "./cart-live-pricing";

const sanitizeCustomInput = (input: any) => {
  if (!input || input.type !== "CUSTOM") return input;
  const { override, reason, sellingLevel, ...safe } = input;
  return safe;
};

export default function Cart({
  t,
  user,
  cart,
  setCart,
  settings,
  online,
  onSaved,
}: {
  t: Translate;
  user: any;
  cart: any;
  setCart: (c: any) => void;
  settings: any;
  online: boolean;
  onSaved: (q: any) => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestedCustomPart, setSuggestedCustomPart] = useState("");
  const [options, setOptions] = useState<Record<string, any[]>>({});
  const [repricingRows, setRepricingRows] = useState<Record<number, boolean>>({});
  const cartRef = useRef(cart);
  const pricingTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pricingSignatures = useRef<Record<number, string>>({});
  const pricingGenerations = useRef<Record<number, number>>({});
  const hasPendingLines = cart.lines.some((l: any) => l.pending);
  const hasBlockingErrors = cart.lines.some((line: any) =>
    cartLineHasBlockingError(line),
  );
  const sum = cart.lines.every((l: any) => l.price)
    ? totals(cart.lines.map((l: any) => l.price))
    : null;
  cartRef.current = cart;

  const setCartLine = (index: number, build: (line: any) => any) => {
    const current = cartRef.current;
    if (!current.lines[index]) return;
    const lines = current.lines.map((line: any, i: number) =>
      i === index ? build(line) : line,
    );
    const next = { ...current, lines };
    cartRef.current = next;
    setCart(next);
  };

  async function loadLevels(productId: string) {
    try {
      const p = await api("products/" + productId);
      setOptions((v) => ({ ...v, [productId]: visibleLevels(p) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function change(index: number, key: string, value: string) {
    setError("");
    const lines = cart.lines.map((l: any, i: number) =>
      i === index
        ? {
            ...l,
            pending: true,
            livePriceError: "",
            input:
              l.input?.type === "CUSTOM"
                ? { ...sanitizeCustomInput(l.input), [key]: value }
                : { ...l.input, [key]: value, override: false, reason: "" },
          }
        : l,
    );
    setCart({ ...cart, lines });
  }

  useEffect(() => {
    for (const key of Object.keys(pricingTimers.current)) {
      const index = Number(key);
      if (index < cart.lines.length) continue;
      clearTimeout(pricingTimers.current[index]);
      delete pricingTimers.current[index];
      delete pricingSignatures.current[index];
      delete pricingGenerations.current[index];
    }
    if (!online) return;
    cart.lines.forEach((line: any, index: number) => {
      const nextInput = catalogLivePricingInput(line);
      if (!line.pending || !nextInput) {
        if (pricingTimers.current[index]) {
          clearTimeout(pricingTimers.current[index]);
          delete pricingTimers.current[index];
        }
        delete pricingSignatures.current[index];
        setRepricingRows((current) =>
          current[index] ? { ...current, [index]: false } : current,
        );
        return;
      }
      const signature = livePricingSignature(line);
      if (pricingSignatures.current[index] === signature) return;
      if (pricingTimers.current[index]) clearTimeout(pricingTimers.current[index]);
      pricingSignatures.current[index] = signature;
      pricingTimers.current[index] = setTimeout(() => {
        const generation = (pricingGenerations.current[index] ?? 0) + 1;
        pricingGenerations.current[index] = generation;
        setRepricingRows((current) => ({ ...current, [index]: true }));
        void api("pricing", "POST", nextInput)
          .then((price) => {
            const current = cartRef.current.lines[index];
            if (!current) return;
            if (
              pricingGenerations.current[index] !== generation ||
              livePricingSignature(current) !== signature
            )
              return;
            setCartLine(index, (existing) => ({
              ...existing,
              price,
              pending: false,
              offline: false,
              livePriceError: "",
            }));
            setError("");
          })
          .catch((e) => {
            const current = cartRef.current.lines[index];
            if (
              !current ||
              pricingGenerations.current[index] !== generation ||
              livePricingSignature(current) !== signature
            )
              return;
            const message = humanizeCustomLineError((e as Error).message);
            setCartLine(index, (existing) => ({
              ...existing,
              livePriceError: message,
            }));
            setError(message);
          })
          .finally(() => {
            if (pricingGenerations.current[index] !== generation) return;
            setRepricingRows((current) => ({ ...current, [index]: false }));
          });
      }, 350);
    });
    return () => {
      for (const timer of Object.values(pricingTimers.current)) clearTimeout(timer);
      pricingTimers.current = {};
    };
  }, [cart.lines, online]);

  async function reprice() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const lines = [];
      for (const line of cart.lines)
        lines.push(
          line.input?.type === "CUSTOM"
            ? {
                ...line,
                price: calculateCustom(line.input, String(settings.vat)),
                pending: false,
                offline: false,
              }
            : {
                ...line,
                price: await api("pricing", "POST", {
                  ...line.input,
                  sellingLevel:
                    line.input.sellingLevel ??
                    line.sellingLevel ??
                    "END_CUSTOMER",
                }),
                pending: false,
                offline: false,
              },
        );
      setCart({ ...cart, lines });
    } catch (e) {
      setError(humanizeCustomLineError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    const requestId = cart.requestId || crypto.randomUUID();
    if (!cart.id && !cart.requestId) setCart({ ...cart, requestId });
    try {
      const q = await api(
        "quotations" + (cart.id ? "/" + cart.id : ""),
        cart.id ? "PUT" : "POST",
        {
          customer: cart.customer,
          lines: cart.lines.map((l: any) =>
            l.input?.type === "CUSTOM"
              ? sanitizeCustomInput(l.input)
              : {
                  ...l.input,
                  type: l.input?.type ?? "CATALOG",
                  sellingLevel:
                    l.input.sellingLevel ?? l.sellingLevel ?? "END_CUSTOMER",
                  override: false,
                  reason: "",
                },
          ),
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
      const reused = q.lines.filter(
        (line: any) => line.reusableResolution === "EXISTING",
      );
      if (reused.length)
        setNotice(
          t(
            `${reused.length} custom item${reused.length === 1 ? " was" : "s were"} linked to the existing reusable list without changing its saved price.`,
            `${reused.length} من الأصناف المخصصة تم ربطها بالقائمة المحفوظة دون تغيير سعرها المحفوظ.`,
          ),
        );
      onSaved(q);
    } catch (e) {
      setError(humanizeCustomLineError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="section-title">
        <div>
          <div className="eyebrow">{t("QUOTATION CART", "سلة عرض السعر")}</div>
          <h2>{cart.number || t("Current quotation", "عرض السعر الحالي")}</h2>
          <p className="muted cart-subtitle">
            {t(
              "Review customer details, add internal notes, and save the quotation when ready.",
              "راجع بيانات العميل وأضف الملاحظات واحفظ عرض السعر عندما يصبح جاهزاً.",
            )}
          </p>
        </div>
        <span className="pill">
          {cart.lines.length} {t("items", "أصناف")}
        </span>
      </div>
      <CustomLineForm
        t={t}
        vat={String(settings.vat)}
        suggestedPart={suggestedCustomPart}
        onAdd={(line) => {
          setCart({ ...cart, lines: [...cart.lines, line] });
          setSuggestedCustomPart("");
        }}
      />
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
              "Add products from Lookup or import a delivery note to start your quotation.",
              "أضف أصنافاً من البحث أو استورد إذن تسليم لبدء عرض السعر.",
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
              <QuotationLineQuickAdd
                t={t}
                user={user}
                online={online}
                onAdd={(line) => {
                  setCart({ ...cart, lines: [...cart.lines, line] });
                  setNotice(
                    t(
                      "Added product to the quotation.",
                      "تمت إضافة الصنف إلى عرض السعر.",
                    ),
                  );
                }}
                onAddCustom={(partNumber) => {
                  setSuggestedCustomPart(partNumber);
                  setNotice(
                    t(
                      `No catalog match for ${partNumber}. Complete it as a custom item.`,
                      `لا يوجد صنف مطابق لـ ${partNumber}. أكمله كعنصر مخصص.`,
                    ),
                  );
                }}
              />
              {cart.lines.map((l: any, i: number) => (
                <tr key={i}>
                  <td>
                    {l.input?.type === "CUSTOM" ? (
                      <>
                        <span className="pill custom-line-badge">
                          {t("Custom", "مخصص")}
                        </span>
                        <input
                          aria-label={t("Part / reference", "الصنف / المرجع")}
                          value={l.input.partNumber}
                          onChange={(e) =>
                            change(i, "partNumber", e.target.value)
                          }
                        />
                        <input
                          aria-label={t("Description", "الوصف")}
                          value={l.input.description}
                          onChange={(e) =>
                            change(i, "description", e.target.value)
                          }
                        />
                      </>
                    ) : (
                      <>
                        <strong>{l.partNumber}</strong>
                        <small>{l.description}</small>
                      </>
                    )}
                    {l.input?.type !== "CUSTOM" && (
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
                            if (online) void loadLevels(l.productId);
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
                    )}
                    {!!l.livePriceError && (
                      <small className="sales-check-error">{l.livePriceError}</small>
                    )}
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
                  <td>
                    {l.input?.type === "CUSTOM" && (
                      <input
                        aria-label={
                          t("Unit price", "سعر الوحدة") + " " + l.partNumber
                        }
                        className="compact"
                        type="number"
                        min="0"
                        step="0.01"
                        {...wheelSafeNumberInputProps}
                        value={l.input.unitPriceExcl}
                        onChange={(e) =>
                          change(i, "unitPriceExcl", e.target.value)
                        }
                      />
                    )}
                    {l.input?.type === "CUSTOM" ? (
                      <small>{l.pending ? "—" : l.price?.finalExcl}</small>
                    ) : l.pending ? (
                      <small>
                        {repricingRows[i]
                          ? t("Refreshing…", "جارٍ التحديث…")
                          : "—"}
                      </small>
                    ) : (
                      (l.price?.finalExcl ?? "—")
                    )}
                  </td>
                  <td>
                    {l.pending ? (
                      <small>
                        {repricingRows[i]
                          ? t("Refreshing…", "جارٍ التحديث…")
                          : "—"}
                      </small>
                    ) : (
                      l.price?.total ?? "—"
                    )}
                  </td>
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
      {hasPendingLines && (
        <div className="notice">
          {t(
            "Some edited lines will be refreshed when you save or issue the quotation. Recalculate is optional.",
            "سيتم تحديث بعض الأسطر المعدلة عند حفظ أو إصدار عرض السعر. إعادة الحساب اختيارية.",
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
      {notice && (
        <div className="notice success" role="status">
          {notice}
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
          disabled={!online || busy || !cart.lines.length || hasBlockingErrors}
          onClick={save}
        >
          {busy
            ? t("Saving…", "جارٍ الحفظ…")
            : cart.id
              ? t("Update quotation", "تحديث عرض السعر")
              : t("Save quotation", "حفظ عرض السعر")}
        </button>
      </div>
      <p className="muted">
        {online
          ? t(
              "Customer details are optional. Catalog discounts now refresh automatically; Recalculate remains an optional manual check.",
              "بيانات العميل اختيارية. خصومات أصناف الكتالوج تتحدث تلقائياً، وتبقى إعادة الحساب فحصاً اختيارياً.",
            )
          : t(
              "Offline quotation — changes remain on this device until you reconnect and save.",
              "عرض سعر دون اتصال — تبقى التغييرات على الجهاز حتى الاتصال والحفظ.",
            )}
      </p>
    </section>
  );
}
