"use client";
import { useEffect, useState } from "react";
import {
  canonicalProduct,
  levelPrice,
  masterPrice,
  money,
  productInput,
  sellingLevels,
  validateProduct,
} from "@/backend/pricing/engine";
import Decimal from "decimal.js";
import { api, type Translate } from "./api";
import { levelCodes, levelLabel } from "./levels";
import { wheelSafeNumberInputProps } from "./number-input";

export const blankProduct = {
  partNumber: "",
  description: "",
  brand: "",
  category: "",
  keywords: "",
  aliases: [],
  method: "COST_MARKUP",
  cost: "0",
  markup: "25",
  listPrice: "0",
  baseDiscount: "0",
  vat: "15",
  minimumEnabled: false,
  minimum: "0",
  unit: "pcs",
  quantityPrecision: 0,
  active: true,
};

const emptyLevel = (code: string) => ({
  code,
  active: true,
  method: "FIXED",
  fixedPrice: "0",
  markup: "0",
  listPrice: "0",
  baseDiscount: "0",
});

export default function ProductEditor({
  t,
  initial,
  onSave,
  onClose,
  actionBusy,
}: {
  t: Translate;
  initial: any;
  onSave: (p: any) => Promise<unknown>;
  onClose: () => void;
  actionBusy: boolean;
}) {
  const [p, setP] = useState<any>(() => ({
      ...blankProduct,
      ...initial,
      levels: sellingLevels({ ...blankProduct, ...initial }),
      defaultLevel: initial.defaultLevel ?? "END_CUSTOMER",
    })),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [brands, setBrands] = useState<any[]>([]),
    [categories, setCategories] = useState<any[]>([]);

  useEffect(() => {
    api("admin/brands")
      .then(setBrands)
      .catch(() => {});
    api("admin/categories")
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !actionBusy) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [actionBusy, onClose]);

  const set = (key: string, value: any) => {
    const match =
      key === "brand" && !initial.id
        ? brands.find((b) => b.name === value)
        : null;
    setP((current: any) => ({
      ...current,
      [key]: value,
      ...(match
        ? {
            method: match.default_method,
            levels: current.levels.map((level: any) => ({
              ...level,
              ...(level.code === current.defaultLevel
                ? { method: match.default_method }
                : {}),
            })),
          }
        : {}),
    }));
    setPreview(false);
  };

  const replaceLevels = (levels: any[]) => {
    set("levels", levels);
  };

  const activeLevel = (() => {
    const existing = p.levels.find((level: any) => level.code === p.defaultLevel);
    return existing || p.levels[0] || emptyLevel("END_CUSTOMER");
  })();

  const updateDefaultLevel = (changes: Record<string, any>) => {
    const exists = p.levels.some((level: any) => level.code === p.defaultLevel);
    const nextLevels = exists
      ? p.levels.map((level: any) =>
          level.code === p.defaultLevel ? { ...level, ...changes } : level,
        )
      : [...p.levels, { ...emptyLevel(p.defaultLevel), ...changes }];
    replaceLevels(nextLevels);
  };

  const setDefaultMethod = (method: string) => {
    updateDefaultLevel({
      method,
      ...(method === "COST_MARKUP"
        ? { markup: activeLevel.markup || p.markup || "25" }
        : { listPrice: activeLevel.listPrice || p.listPrice || "0" }),
    });
    set("method", method);
  };

  const defaultExcl = (() => {
    try {
      return masterPrice(p).toFixed(2);
    } catch {
      return "—";
    }
  })();
  const defaultIncl =
    defaultExcl === "—"
      ? "—"
      : money(
          new Decimal(defaultExcl).mul(
            new Decimal(1).add(new Decimal(p.vat).div(100)),
          ),
        );

  const basicMethod =
    activeLevel.method === "FIXED" ? "LIST_DISCOUNT" : activeLevel.method;
  const basicPrice =
    basicMethod === "COST_MARKUP"
      ? activeLevel.markup || p.markup || "25"
      : activeLevel.listPrice || p.listPrice || "0";
  const basicDiscount = activeLevel.baseDiscount || p.baseDiscount || "0";

  const input = (key: string, en: string, ar: string, type = "text") => (
    <label>
      {t(en, ar)}
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        min={type === "number" ? "0" : undefined}
        value={p[key]}
        list={
          key === "brand"
            ? "amt-brands"
            : key === "category"
              ? "amt-categories"
              : undefined
        }
        onChange={(e) => set(key, e.target.value)}
        required={["partNumber", "description"].includes(key)}
      />
    </label>
  );

  return (
    <div className="modal-backdrop">
      <datalist id="amt-brands">
        {brands
          .filter((b) => b.active)
          .map((b) => (
            <option key={b.id} value={b.name} />
          ))}
      </datalist>
      <datalist id="amt-categories">
        {categories
          .filter((c) => c.active)
          .map((c) => (
            <option key={c.id} value={c.name} />
          ))}
      </datalist>
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            validateProduct(
              productInput.parse((({ id, version, ...data }) => data)(p)),
            );
          } catch (e) {
            setError((e as Error).message);
            return;
          }
          setError("");
          if (!preview) {
            setPreview(true);
            return;
          }
          const { version, ...data } = p;
          await onSave({
            ...canonicalProduct(productInput.parse(data)),
            ...(version ? { version } : {}),
          });
        }}
      >
        <div className="section-title">
          <div>
            <h2>{t("Product & pricing", "الصنف والتسعير")}</h2>
            <p className="muted">
              {t(
                "Use the basic pricing fields for daily setup. Open Advanced pricing only when you need extra levels or detailed control.",
                "استخدم حقول التسعير الأساسية للإعداد اليومي. وافتح التسعير المتقدم فقط عند الحاجة إلى مستويات إضافية أو تحكم تفصيلي.",
              )}
            </p>
          </div>
          <button type="button" disabled={actionBusy} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="form-grid">
          {input("partNumber", "Part number", "رقم الصنف")}
          {input("description", "Description", "الوصف")}
          {input("brand", "Brand", "العلامة التجارية")}
          {input("category", "Category", "الفئة")}
          {input("vat", "VAT %", "الضريبة %", "number")}
          {input("unit", "Unit (pcs, m, box…)", "الوحدة (قطعة، متر، صندوق)")}
          <label>
            {t("Quantity precision", "دقة الكمية")}
            <select
              value={p.quantityPrecision}
              onChange={(e) => set("quantityPrecision", Number(e.target.value))}
            >
              {[0, 1, 2, 3].map((n) => (
                <option value={n} key={n}>
                  {n === 0
                    ? t("Whole quantities", "كميات صحيحة")
                    : n + " " + t("decimal places", "منازل عشرية")}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={p.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            {t("Active product", "صنف نشط")}
          </label>
        </div>

        <section className="basic-pricing-panel">
          <div className="section-title">
            <div>
              <h3>{t("Basic pricing", "التسعير الأساسي")}</h3>
              <p className="muted">
                {t(
                  `Main selling price uses ${levelLabel(p.defaultLevel, t)}. Salesman discount limits stay controlled from Roles and Users.`,
                  `سعر البيع الرئيسي يستخدم ${levelLabel(p.defaultLevel, t)}. وتظل حدود خصم المندوب مضبوطة من الأدوار والمستخدمين.`,
                )}
              </p>
            </div>
            <span className="pill">{levelLabel(p.defaultLevel, t)}</span>
          </div>
          <div className="form-grid">
            <label>
              {t("Pricing method", "طريقة التسعير")}
              <select
                value={basicMethod}
                onChange={(e) => setDefaultMethod(e.target.value)}
              >
                <option value="COST_MARKUP">
                  {t("Cost + markup", "التكلفة + الزيادة")}
                </option>
                <option value="LIST_DISCOUNT">
                  {t("Public/List price - discount", "السعر العام/القائمة - الخصم")}
                </option>
              </select>
            </label>
            {basicMethod === "COST_MARKUP" ? (
              <>
                <label>
                  {t("Purchase cost", "تكلفة الشراء")}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    {...wheelSafeNumberInputProps}
                    value={p.cost}
                    onChange={(e) => set("cost", e.target.value)}
                  />
                </label>
                <label>
                  {t("Markup %", "نسبة الزيادة %")}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    {...wheelSafeNumberInputProps}
                    value={basicPrice}
                    onChange={(e) =>
                      updateDefaultLevel({ markup: e.target.value })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  {t("Public/List price", "السعر العام/القائمة")}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    {...wheelSafeNumberInputProps}
                    value={basicPrice}
                    onChange={(e) =>
                      updateDefaultLevel({ listPrice: e.target.value })
                    }
                  />
                </label>
                <label>
                  {t("Discount %", "نسبة الخصم %")}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    {...wheelSafeNumberInputProps}
                    value={basicDiscount}
                    onChange={(e) =>
                      updateDefaultLevel({ baseDiscount: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={p.minimumEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  set("minimumEnabled", enabled);
                  if (!enabled) set("minimum", "0");
                }}
              />
              {t("Minimum selling price protection", "حماية أقل سعر بيع")}
            </label>
            <label>
              {t("Minimum price excl. VAT", "أقل سعر قبل الضريبة")}
              <input
                type="number"
                min="0"
                step="any"
                disabled={!p.minimumEnabled}
                {...wheelSafeNumberInputProps}
                value={p.minimumEnabled ? p.minimum : "0"}
                onChange={(e) => set("minimum", e.target.value)}
              />
            </label>
          </div>
          <div className="price-pair preview-prices">
            <div>
              <label>{t("Main selling price excl. VAT", "سعر البيع الرئيسي قبل الضريبة")}</label>
              <strong>{defaultExcl}</strong>
            </div>
            <div>
              <label>{t("Main selling price incl. VAT", "سعر البيع الرئيسي شامل الضريبة")}</label>
              <strong>{defaultIncl}</strong>
            </div>
          </div>
        </section>

        <details className="advanced-pricing">
          <summary>{t("Advanced pricing", "التسعير المتقدم")}</summary>
          <p className="muted">
            {t(
              "Use this only when you need multiple selling levels, a different default level, or exact per-level control.",
              "استخدم هذا فقط عند الحاجة إلى عدة مستويات بيع، أو مستوى افتراضي مختلف، أو تحكم دقيق لكل مستوى.",
            )}
          </p>
          <div className="form-grid">
            {input("keywords", "Keywords", "كلمات البحث")}
            <label>
              {t("Aliases (separate with |)", "أرقام بديلة (افصل بـ |)")}
              <input
                value={p.aliases.join("|")}
                onChange={(e) =>
                  set("aliases", e.target.value.split("|").filter(Boolean))
                }
              />
            </label>
          </div>
          <h3>{t("Selling levels", "مستويات أسعار البيع")}</h3>
          <p>
            {t(
              "Enable available levels and choose the default. All prices are before VAT. The minimum protects every level.",
              "فعّل المستويات المتاحة واختر الافتراضي. جميع الأسعار قبل الضريبة. الحد الأدنى يحمي كل المستويات.",
            )}
          </p>
          {levelCodes.map((code) => {
            const level = p.levels.find((entry: any) => entry.code === code);
            const edit = (field: string, value: any) =>
              replaceLevels(
                p.levels.map((entry: any) =>
                  entry.code === code ? { ...entry, [field]: value } : entry,
                ),
              );
            let amount = "—";
            try {
              if (level) amount = levelPrice(p, level).toFixed(2);
            } catch {}
            return (
              <fieldset key={code} className="level-editor">
                <legend>{levelLabel(code, t)}</legend>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!level?.active}
                    onChange={(e) => {
                      if (level) edit("active", e.target.checked);
                      else replaceLevels([...p.levels, { ...emptyLevel(code) }]);
                    }}
                  />
                  {t("Available to staff", "متاح للموظفين")}
                </label>
                {level?.active && (
                  <>
                    <label className="check">
                      <input
                        type="radio"
                        name="defaultLevel"
                        checked={p.defaultLevel === code}
                        onChange={() => set("defaultLevel", code)}
                      />
                      {t("Default selling level", "مستوى البيع الافتراضي")}
                    </label>
                    <div className="form-grid">
                      <label>
                        {t("Pricing method", "طريقة التسعير")}
                        <select
                          value={level.method}
                          onChange={(e) => edit("method", e.target.value)}
                        >
                          <option value="FIXED">
                            {t("Fixed price", "سعر ثابت")}
                          </option>
                          <option value="COST_MARKUP">
                            {t("Cost + markup", "التكلفة + الزيادة")}
                          </option>
                          <option value="LIST_DISCOUNT">
                            {t("List price - discount", "سعر القائمة - الخصم")}
                          </option>
                        </select>
                      </label>
                      {(level.method === "FIXED"
                        ? [
                            [
                              "fixedPrice",
                              "Fixed price excl. VAT",
                              "السعر الثابت قبل الضريبة",
                            ],
                          ]
                        : level.method === "COST_MARKUP"
                          ? [["markup", "Markup %", "نسبة الزيادة %"]]
                          : [
                              ["listPrice", "List price", "سعر القائمة"],
                              [
                                "baseDiscount",
                                "Supplier discount %",
                                "خصم المورد %",
                              ],
                            ]
                      ).map(([key, en, ar]) => (
                        <label key={key}>
                          {t(en, ar)}
                          <input
                            type="number"
                            min="0"
                            step="any"
                            {...wheelSafeNumberInputProps}
                            value={level[key]}
                            onChange={(e) => edit(key, e.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                    <p>
                      {t("Selling excl. VAT", "البيع قبل الضريبة")}:{" "}
                      <strong>SAR {amount}</strong>
                    </p>
                  </>
                )}
              </fieldset>
            );
          })}
        </details>

        {preview && (
          <div className="notice">
            {t(
              "Review the values above. Confirm to publish this product and record its price history.",
              "راجع القيم أعلاه. أكد لنشر الصنف وتسجيل سجل الأسعار.",
            )}
          </div>
        )}
        {error && <div className="notice error">{error}</div>}
        <div className="actions footer-actions">
          <button type="button" disabled={actionBusy} onClick={onClose}>
            {t("Cancel", "إلغاء")}
          </button>
          <button className="primary" disabled={actionBusy}>
            {preview
              ? actionBusy
                ? t("Saving…", "جارٍ الحفظ…")
                : t("Confirm & publish", "تأكيد ونشر")
              : t("Preview changes", "معاينة التغييرات")}
          </button>
        </div>
      </form>
    </div>
  );
}
