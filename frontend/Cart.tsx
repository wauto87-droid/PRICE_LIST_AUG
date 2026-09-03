"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Translate } from "./api";
import { totals, calculateCustom } from "@/backend/pricing/engine";
import { levelLabel, visibleLevels } from "./levels";
import {
  discountSafeNumberInputProps,
  wheelSafeNumberInputProps,
} from "./number-input";
import CustomLineForm from "./CustomLineForm";
import QuotationLineQuickAdd from "./QuotationLineQuickAdd";
import CustomLineCatalogResolver from "./CustomLineCatalogResolver";
import { buildLookupLineRequest } from "./lookup-pricing";
import { humanizeCustomLineError } from "./custom-line-errors";
import {
  formatDeliveryDocNo,
  formatDeliveryDate,
} from "@/backend/pricing/normalize";
import {
  cartLineHasBlockingError,
  catalogLivePricingInput,
  normalizeTargetPrice,
  livePricingSignature,
} from "./cart-live-pricing";
import RecentQuotationPrices, { priceHistoryItemKey } from "./RecentQuotationPrices";
import { showConfirm } from "./confirm";

const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/;
const importedDeliveryMeta = (line: any) =>
  line?.input?.importMeta?.source === "DELIVERY_NOTE"
    ? line.input.importMeta
    : line?.importMeta?.source === "DELIVERY_NOTE"
      ? line.importMeta
      : null;
const unresolvedImportedCustom = (line: any) =>
  line?.input?.type === "CUSTOM" &&
  importedDeliveryMeta(line)?.unresolved === true;
export const blankZeroDiscount = (value: unknown) =>
  Number(String(value ?? "").trim() || "0") === 0 ? "" : String(value);
const catalogUsesMarkup = (line: any, loadedLevels: any[] = []) => {
  // Current server configuration must override stale fields stored in a draft.
  if (line.price?.adjustmentMode)
    return line.price.adjustmentMode === "MARKUP";
  const code = line.input?.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER";
  const level = (loadedLevels.length ? loadedLevels : line.sellingLevels ?? []).find(
    (candidate: any) => candidate.code === code,
  );
  if (level?.entryMode) return level.entryMode === "MARKUP";
  if (level?.method) return level.method === "COST_MARKUP";
  return (
    line.price?.pricingMode === "STAFF_MARKUP" ||
    line.input?.markup !== undefined
  );
};
export const normalizedCustomReference = (value: unknown) =>
  String(value ?? "").trim().toUpperCase();
export function matchingCustomLineIndexes(
  lines: any[],
  index: number,
  scope: "ROW" | "ALL_IDENTICAL",
) {
  const reference = normalizedCustomReference(lines[index]?.input?.partNumber);
  if (scope === "ROW" || !reference) return [index];
  return lines.flatMap((line, lineIndex) =>
    line.input?.type === "CUSTOM" &&
    normalizedCustomReference(line.input.partNumber) === reference
      ? [lineIndex]
      : [],
  );
}
export function nextEditableRow(
  lines: any[],
  currentIndex: number,
  field: "discount" | "unitPriceExcl",
) {
  for (let index = currentIndex + 1; index < lines.length; index++) {
    if (field === "discount" || field === "unitPriceExcl") return index;
  }
  return -1;
}

function computeCartTotals(lines: any[], targetTotalValue: string) {
  const base = totals(lines.flatMap((line: any) => (line.price ? [line.price] : [])));
  const unresolvedLines = lines.filter((line: any) => !line.price).length;
  const rawTarget = String(targetTotalValue ?? "").trim();
  if (!rawTarget)
    return {
      ...base,
      lineSubtotal: base.subtotal,
      lineVat: base.vat,
      lineTotal: base.total,
      quoteDiscount: "0.00",
      targetTotal: "",
      unresolvedLines,
      error: "",
    };
  if (unresolvedLines)
    return {
      ...base,
      lineSubtotal: base.subtotal,
      lineVat: base.vat,
      lineTotal: base.total,
      quoteDiscount: "0.00",
      targetTotal: rawTarget,
      unresolvedLines,
      error: "Enter prices for imported delivery rows before using a round-off total.",
    };
  if (!decimalPattern.test(rawTarget))
    return {
      ...base,
      lineSubtotal: base.subtotal,
      lineVat: base.vat,
      lineTotal: base.total,
      quoteDiscount: "0.00",
      targetTotal: rawTarget,
      unresolvedLines,
      error: "Enter the round-off total as a number like 525 or 525.50.",
    };
  const currentTotal = Number(base.total || 0);
  const targetTotal = Number(rawTarget);
  if (targetTotal > currentTotal)
    return {
      ...base,
      lineSubtotal: base.subtotal,
      lineVat: base.vat,
      lineTotal: base.total,
      quoteDiscount: "0.00",
      targetTotal: rawTarget,
      unresolvedLines,
      error: "Round-off total cannot be more than the current quotation total.",
    };
  const ratio = currentTotal === 0 ? 1 : targetTotal / currentTotal;
  const subtotalValue = Number(base.subtotal || 0);
  const adjustedSubtotal = (subtotalValue * ratio).toFixed(2);
  const adjustedVat = (targetTotal - Number(adjustedSubtotal)).toFixed(2);
  return {
    subtotal: adjustedSubtotal,
    vat: adjustedVat,
    total: targetTotal.toFixed(2),
    lineSubtotal: base.subtotal,
    lineVat: base.vat,
    lineTotal: base.total,
    quoteDiscount: (currentTotal - targetTotal).toFixed(2),
    targetTotal: targetTotal.toFixed(2),
    unresolvedLines,
    error: "",
  };
}

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
  onTemplates,
}: {
  t: Translate;
  user: any;
  cart: any;
  setCart: (c: any) => void;
  settings: any;
  online: boolean;
  onSaved: (q: any) => void;
  onTemplates?: () => void;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestedCustomPart, setSuggestedCustomPart] = useState("");
  const [options, setOptions] = useState<Record<string, any[]>>({});
  const [repricingRows, setRepricingRows] = useState<Record<number, boolean>>({});
  const [recentPriceRow, setRecentPriceRow] = useState<number | null>(null);
  const [reusePreviousPrices, setReusePreviousPrices] = useState(false);
  const [reuseBusy, setReuseBusy] = useState(false);
  const activePriceRow = useRef<number | null>(null);
  const customerIdentity = useRef(`${cart.id || "NEW"}|${cart.customer.number?.trim() || ""}|${cart.customer.name?.trim() || ""}`);
  const cartRef = useRef(cart);
  const pricingTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pricingSignatures = useRef<Record<number, string>>({});
  const pricingGenerations = useRef<Record<number, number>>({});
  const hasPendingLines = cart.lines.some((l: any) => l.pending);
  const targetTotalValue =
    cart.adjustment?.targetTotal ?? cart.totals?.targetTotal ?? "";
  const sum = computeCartTotals(cart.lines, targetTotalValue);
  const hasBlockingErrors =
    cart.lines.some((line: any) => cartLineHasBlockingError(line)) ||
    !!sum.error;
  cartRef.current = cart;
  useEffect(() => {
    if (!user.permissions.includes("QUOTE_PRICE_HISTORY")) return;
    const open = (event: KeyboardEvent) => {
      if (event.key !== "F10" || activePriceRow.current === null || !cartRef.current.lines[activePriceRow.current]) return;
      event.preventDefault();
      setRecentPriceRow(activePriceRow.current);
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [user.permissions]);

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

  useEffect(() => {
    const identity = `${cart.id || "NEW"}|${cart.customer.number?.trim() || ""}|${cart.customer.name?.trim() || ""}`;
    if (identity === customerIdentity.current) return;
    customerIdentity.current = identity;
    setReusePreviousPrices(false);
  }, [cart.id, cart.customer.number, cart.customer.name]);

  function applyPreviousPriceResults(result: any) {
    const byIndex = new Map(result.results.map((item: any) => [item.index, item]));
    const current = cartRef.current;
    const lines = current.lines.map((line: any, index: number) => {
      const match: any = byIndex.get(index);
      if (!match) return line;
      if (match.itemKey && match.itemKey !== priceHistoryItemKey(line)) return line;
      if (match.status !== "MATCHED" && match.status !== "ADJUSTED")
        return { ...line, previousPriceChecked: true };
      const input = { ...line.input, ...match.input };
      return {
        ...line,
        input,
        price: input.type === "CUSTOM" ? calculateCustom(input, String(settings.vat)) : match.price,
        pending: false,
        offline: false,
        livePriceError: "",
        targetPriceDraft: undefined,
        targetPriceRequested: undefined,
        targetPriceError: false,
        priceEntryNotice: match.reason || "",
        previousPriceChecked: true,
        previousPriceSource: match.previous,
      };
    });
    const next = { ...current, lines };
    cartRef.current = next;
    setCart(next);
  }

  async function findPreviousPrices(indexes: number[]) {
    return api("quotation-previous-prices", "POST", {
      customerNumber: String(cartRef.current.customer.number || "").trim(),
      customerName: String(cartRef.current.customer.name || "").trim(),
      ...(cartRef.current.id ? { excludeQuotationId: cartRef.current.id } : {}),
      lines: indexes.map((index) => ({ index, input: cartRef.current.lines[index].input })),
    });
  }

  async function enablePreviousPrices() {
    const customerNumber = String(cart.customer.number || "").trim();
    const customerName = String(cart.customer.name || "").trim();
    if ((!customerNumber && !customerName) || customerNumber === "1") {
      setError(t("Enter a named customer or Customer Code before using previous prices. Walk-in Customer is not supported.", "أدخل اسم العميل أو رمزه قبل استخدام الأسعار السابقة. العميل النقدي غير مدعوم."));
      return;
    }
    setReuseBusy(true); setError("");
    try {
      if (!cart.lines.length) { setReusePreviousPrices(true); return; }
      const result = await findPreviousPrices(cart.lines.map((_: any, index: number) => index));
      const accepted = await showConfirm(t(
        `Apply previous prices? Matched: ${result.summary.matched}, adjusted by current protection: ${result.summary.adjusted}, not found: ${result.summary.notFound}, invalid: ${result.summary.invalid}.`,
        `تطبيق الأسعار السابقة؟ مطابق: ${result.summary.matched}، عُدّل حسب الحماية الحالية: ${result.summary.adjusted}، غير موجود: ${result.summary.notFound}، غير صالح: ${result.summary.invalid}.`,
      ));
      if (!accepted) return;
      applyPreviousPriceResults(result);
      setReusePreviousPrices(true);
      setNotice(t("Previous customer prices were applied. Every price remains editable.", "تم تطبيق أسعار العميل السابقة. جميع الأسعار قابلة للتعديل."));
    } catch (e) { setError((e as Error).message); }
    finally { setReuseBusy(false); }
  }

  useEffect(() => {
    if (!reusePreviousPrices || reuseBusy || !online) return;
    const indexes = cart.lines.flatMap((line: any, index: number) => line.previousPriceChecked ? [] : [index]);
    if (!indexes.length) return;
    setReuseBusy(true);
    void findPreviousPrices(indexes).then((result) => {
      applyPreviousPriceResults(result);
      if (result.summary.matched || result.summary.adjusted)
        setNotice(t("Previous customer price applied. You can still edit it.", "تم تطبيق سعر العميل السابق ويمكنك تعديله."));
    }).catch((e) => setError(e.message)).finally(() => setReuseBusy(false));
  }, [reusePreviousPrices, reuseBusy, online, cart.lines.length]);

  const moveToNextEntry = (
    event: React.KeyboardEvent<HTMLInputElement>,
    index: number,
    field: "discount" | "unitPriceExcl",
  ) => {
    if (event.key !== "Enter") return;
    const nextIndex = nextEditableRow(cartRef.current.lines, index, field);
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = document.querySelector<HTMLInputElement>(
      `[data-cart-field="${field}"][data-cart-row="${nextIndex}"]`,
    );
    next?.focus();
    next?.select();
  };

  async function loadCustomerByCode(rawCode: string) {
    const code = rawCode.trim();
    if (!online || !code || code === "1") return;
    try {
      const customers = await api(`customers?q=${encodeURIComponent(code)}`);
      const customer = customers.find((item: any) => String(item.number || "").trim() === code);
      if (!customer) return;
      const current = cartRef.current;
      const next = {
        ...current,
        customer: {
          ...current.customer,
          name: customer.name || current.customer.name,
          number: code,
          mobile: customer.mobile || "",
          reference: customer.reference || current.customer.reference || "",
        },
      };
      cartRef.current = next;
      setCart(next);
      setNotice(t(`Customer ${code} loaded.`, `تم تحميل العميل ${code}.`));
    } catch (e) { setError((e as Error).message); }
  }

  async function loadLevels(productId: string) {
    try {
      const p = await api("products/" + productId);
      setOptions((v) => ({ ...v, [productId]: visibleLevels(p) }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function replaceCustomWithCatalog(
    index: number,
    product: any,
    scope: "ROW" | "ALL_IDENTICAL",
    remember: boolean,
  ) {
    const current = cartRef.current;
    const source = current.lines[index];
    if (!source || source.input?.type !== "CUSTOM")
      throw new Error("This custom line is no longer available. Reload and try again.");
    const indexes = matchingCustomLineIndexes(current.lines, index, scope);
    const replacements = await Promise.all(
      indexes.map(async (lineIndex) => {
        const line = current.lines[lineIndex];
        const importMeta = importedDeliveryMeta(line);
        const basePricingInput = buildLookupLineRequest(
          product.id,
          product.defaultLevel ?? "END_CUSTOMER",
          String(line.input.quantity),
          "0",
        );
        const selectedProductLevel = visibleLevels(product).find(
          (level) => level.code === (product.defaultLevel ?? "END_CUSTOMER"),
        );
        const pricingInput =
          selectedProductLevel?.entryMode === "MARKUP" ||
          selectedProductLevel?.method === "COST_MARKUP"
            ? { ...basePricingInput, markup: "0" }
            : basePricingInput;
        const input = {
          ...pricingInput,
          type: "CATALOG" as const,
          ...(importMeta
            ? {
                importMeta: {
                  ...importMeta,
                  sourcePartNumber:
                    importMeta.sourcePartNumber || line.input.partNumber,
                  unresolved: false,
                },
              }
            : {}),
        };
        return {
          lineIndex,
          line: {
            productId: product.id,
            sellingLevel: product.defaultLevel ?? "END_CUSTOMER",
            partNumber: product.partNumber,
            description: product.description,
            unit: product.unit,
            quantityPrecision: product.quantityPrecision,
            sellingLevels: visibleLevels(product),
            input,
            price: await api("pricing", "POST", pricingInput),
            pending: false,
            offline: false,
          },
        };
      }),
    );
    if (
      indexes.some(
        (lineIndex) => cartRef.current.lines[lineIndex] !== current.lines[lineIndex],
      )
    )
      throw new Error(
        "One of these quotation rows changed while pricing was checked. Review it and try again.",
      );
    if (remember) {
      await api(`products/${product.id}/aliases`, "POST", {
        alias: String(source.input.partNumber).trim(),
        kind: "DELIVERY_NOTE",
      });
    }
    const latest = cartRef.current;
    if (
      indexes.some((lineIndex) => latest.lines[lineIndex] !== current.lines[lineIndex])
    )
      throw new Error(
        "One of these quotation rows changed before replacement. The cart was left unchanged.",
      );
    const replacementMap = new Map(
      replacements.map((replacement) => [replacement.lineIndex, replacement.line]),
    );
    const lines = latest.lines.map((line: any, lineIndex: number) =>
      replacementMap.get(lineIndex) ?? line,
    );
    const next = { ...latest, lines };
    cartRef.current = next;
    setCart(next);
    setNotice(
      t(
        `${replacements.length} custom row(s) replaced with ${product.partNumber}.`,
        `تم استبدال ${replacements.length} صف مخصص بالصنف ${product.partNumber}.`,
      ),
    );
  }

  function change(index: number, key: string, value: string) {
    setError("");
    const lines = cart.lines.map((l: any, i: number) => {
      if (i !== index) return l;
      if (l.input?.type === "CUSTOM") {
        let input = {
          ...sanitizeCustomInput(l.input),
          [key]: key === "discount" && !value.trim() ? "0" : value,
        };
        if (key === "unitPriceExcl" && importedDeliveryMeta({ input })) {
          input = {
            ...input,
            importMeta: {
              ...input.importMeta,
              unresolved: !value.trim(),
            },
          };
        }
        const quantity = String(input.quantity ?? "").trim();
        const discount = String(input.discount ?? "0").trim();
        const unitPrice = String(input.unitPriceExcl ?? "").trim();
        const importMeta = importedDeliveryMeta({ input });
        const canLeavePriceBlank =
          importMeta?.source === "DELIVERY_NOTE" &&
          !decimalPattern.test(unitPrice);
        let price = null;
        let livePriceError = "";
        if (
          String(input.description ?? "").trim() &&
          decimalPattern.test(quantity) &&
          decimalPattern.test(discount) &&
          Number(discount) <= 100 &&
          decimalPattern.test(unitPrice)
        ) {
          try {
            price = calculateCustom(input, String(settings.vat));
          } catch (e) {
            livePriceError = humanizeCustomLineError((e as Error).message);
          }
        } else if (!canLeavePriceBlank && unitPrice && !decimalPattern.test(unitPrice)) {
          livePriceError =
            "Enter unit price as a number like 12.5 or 100, without commas.";
        }
        return {
          ...l,
          input,
          price,
          pending: false,
          offline: false,
          livePriceError,
        };
      }
      return {
        ...l,
        pending: true,
        livePriceError: "",
        targetPriceDraft: undefined,
        targetPriceRequested: undefined,
        targetPriceError: false,
        priceEntryNotice: "",
        input: {
          ...l.input,
          [key]:
            (key === "discount" || key === "markup") && !value.trim()
              ? "0"
              : value,
          ...(key === "markup" ? { discount: "0" } : {}),
          override: false,
          reason: "",
        },
      };
    });
    setCart({ ...cart, lines });
  }

  function changeCatalogFinalPrice(index: number, value: string) {
    setError("");
    delete pricingSignatures.current[index];
    const lines = cart.lines.map((line: any, lineIndex: number) => {
      if (lineIndex !== index || line.input?.type === "CUSTOM") return line;
      const result = normalizeTargetPrice(value);
      if (!result.ok)
        return {
          ...line,
          pending: false,
          targetPriceDraft: value,
          targetPriceRequested: undefined,
          targetPriceError: true,
          priceEntryNotice: result.error,
        };
      return {
        ...line,
        pending: true,
        livePriceError: "",
        targetPriceDraft: value,
        targetPriceRequested: result.target,
        targetPriceError: false,
        priceEntryNotice: "",
        input: { ...line.input, override: false, reason: "" },
      };
    });
    setCart({ ...cart, lines });
  }

  useEffect(() => {
    if (!online) return;
    let changed = false;
    const lines = cart.lines.map((line: any) => {
      const currentMode = line.price?.adjustmentMode;
      const savedMode =
        line.input?.markup === undefined ? "DISCOUNT" : "MARKUP";
      if (
        line.input?.type === "CUSTOM" ||
        line.targetPriceRequested ||
        !currentMode ||
        currentMode === savedMode ||
        !line.price?.finalExcl
      )
        return line;
      changed = true;
      return {
        ...line,
        pending: true,
        targetPriceDraft: line.price.finalExcl,
        targetPriceRequested: line.price.finalExcl,
        targetPriceError: false,
        priceEntryNotice: `Refreshing this saved line with the current ${currentMode.toLowerCase()} pricing rules.`,
      };
    });
    if (changed) setCart({ ...cart, lines });
  }, [cart.lines, online]);

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
            setCartLine(index, (existing) => {
              const requested = existing.targetPriceRequested;
              const adjusted =
                existing.priceEntryNotice ||
                (requested && requested !== price.finalExcl
                  ? `Requested SAR ${requested} was adjusted to SAR ${price.finalExcl} by pricing protection.`
                  : "");
              const { markup: _markup, ...discountInput } = existing.input;
              const synchronizedInput =
                price.pricingMode === "STAFF_MARKUP"
                  ? {
                      ...existing.input,
                      discount: "0",
                      markup: price.requestedMarkup,
                    }
                  : {
                      ...discountInput,
                      discount: price.requestedDiscount,
                    };
              return {
                ...existing,
                input: synchronizedInput,
                price,
                pending: false,
                offline: false,
                livePriceError: "",
                targetPriceDraft: undefined,
                targetPriceRequested: undefined,
                targetPriceError: false,
                priceEntryNotice: adjusted,
              };
            });
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
          adjustment: { targetTotal: targetTotalValue },
          ...(cart.id ? { version: cart.version } : { requestId }),
        },
      );
      setCart({
        ...cart,
        id: q.id,
        version: q.version,
        number: q.number,
        lines: q.lines,
        totals: q.totals,
        adjustment: { targetTotal: q.totals?.targetTotal || "" },
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
      {user.permissions.includes("QUOTE_PRICE_HISTORY") && (
        <label className="notice previous-price-toggle">
          <input
            type="checkbox"
            checked={reusePreviousPrices}
            disabled={reuseBusy || !online || String(cart.customer.number || "").trim() === "1" || (!String(cart.customer.number || "").trim() && !String(cart.customer.name || "").trim())}
            onChange={(event) => event.target.checked ? void enablePreviousPrices() : setReusePreviousPrices(false)}
          />
          <span><b>{t("Use this customer's previous prices", "استخدام أسعار العميل السابقة")}</b><small>{t("Issued prices are preferred, then Draft prices. Applied prices remain editable.", "تُفضّل الأسعار المصدرة ثم أسعار المسودات. تبقى الأسعار قابلة للتعديل.")}</small></span>
        </label>
      )}
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
          ["number", "Customer Code", "رمز العميل"],
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
              onBlur={() => { if (key === "number") void loadCustomerByCode(String(cart.customer.number || "")); }}
              placeholder={
                key === "name"
                  ? t("Walk-in Customer (optional)", "عميل نقدي (اختياري)")
                  : ""
              }
            />
          </label>
        ))}
        <div className="notice">
          <span>{t("Customer Code improves same-customer price highlighting.", "رمز العميل يحسن تمييز الأسعار السابقة لنفس العميل.")}</span>
          <button type="button" onClick={() => setCart({ ...cart, customer: { ...cart.customer, name: "", number: "1" } })}>{t("Walk-in Customer", "عميل نقدي")}</button>
        </div>
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
                <th>{t("Discount / Markup %", "الخصم / هامش الربح %")}</th>
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
                <tr key={i} data-cart-row-index={i} onFocusCapture={() => { activePriceRow.current = i; }} onMouseEnter={() => { activePriceRow.current = i; }}>
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
                        <CustomLineCatalogResolver
                          t={t}
                          sourceReference={String(l.input.partNumber ?? "")}
                          sourceDescription={String(l.input.description ?? "")}
                          identicalCount={
                            matchingCustomLineIndexes(
                              cart.lines,
                              i,
                              "ALL_IDENTICAL",
                            ).length
                          }
                          canRemember={user.permissions.includes("PRODUCT_EDIT")}
                          online={online}
                          disabled={busy}
                          onReplace={(product, scope, remember) =>
                            replaceCustomWithCatalog(i, product, scope, remember)
                          }
                        />
                      </>
                    ) : (
                      <>
                        <strong>{l.partNumber}</strong>
                        <small>{l.description}</small>
                        {importedDeliveryMeta(l) && (
                          <small>
                            {t("Delivery row", "صف التسليم")}{" "}
                            {importedDeliveryMeta(l)?.rowNumber || "—"} ·{" "}
                            {importedDeliveryMeta(l)?.docNo || "—"} ·{" "}
                            {importedDeliveryMeta(l)?.docDate || "—"}
                            {importedDeliveryMeta(l)?.sourcePartNumber &&
                              importedDeliveryMeta(l)?.sourcePartNumber !==
                                l.partNumber && (
                                <>
                                  {" · "}
                                  {t("Source part", "صنف المصدر")}: {importedDeliveryMeta(l)?.sourcePartNumber}
                                </>
                              )}
                          </small>
                        )}
                      </>
                    )}
                    {l.input?.type === "CUSTOM" && importedDeliveryMeta(l) && (
                      <small>
                        {t("Delivery source", "مصدر التسليم")}:{" "}
                        {importedDeliveryMeta(l)?.docNo || "—"} ·{" "}
                        {importedDeliveryMeta(l)?.docDate || "—"}
                      </small>
                    )}
                    {l.previousPriceSource && (
                      <span className="badge success" title={`${l.previousPriceSource.status} ${l.previousPriceSource.quotation_number}`}>
                        {t("Previous customer price", "سعر العميل السابق")}
                      </span>
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
                    {unresolvedImportedCustom(l) && !l.livePriceError && (
                      <small className="sales-check-error">
                        {t(
                          "Enter a unit price before issuing this quotation line.",
                          "أدخل سعر الوحدة قبل إصدار هذا السطر في عرض السعر.",
                        )}
                      </small>
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
                    {l.input?.type !== "CUSTOM" && (
                      <small>
                        {catalogUsesMarkup(l, options[l.productId])
                          ? t("Markup %", "هامش الربح %")
                          : t("Discount %", "الخصم %")}
                      </small>
                    )}
                    <input
                      aria-label={
                        (catalogUsesMarkup(l, options[l.productId])
                          ? t("Markup", "هامش الربح")
                          : t("Discount", "الخصم")) +
                        " " +
                        l.partNumber
                      }
                      className="compact"
                      type="number"
                      min="0"
                      max={
                        catalogUsesMarkup(l, options[l.productId])
                          ? undefined
                          : "100"
                      }
                      step="any"
                      placeholder="0"
                      {...discountSafeNumberInputProps}
                      data-cart-field="discount"
                      data-cart-row={i}
                      value={
                        blankZeroDiscount(
                          catalogUsesMarkup(l, options[l.productId])
                            ? l.input.markup
                            : l.input.discount,
                        )
                      }
                      onChange={(e) =>
                        change(
                          i,
                          catalogUsesMarkup(l, options[l.productId])
                            ? "markup"
                            : "discount",
                          e.target.value,
                        )
                      }
                      onKeyDown={(e) => moveToNextEntry(e, i, "discount")}
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
                        data-cart-field="unitPriceExcl"
                        data-cart-row={i}
                        value={
                          unresolvedImportedCustom(l)
                            ? ""
                            : l.input.unitPriceExcl
                        }
                        onChange={(e) =>
                          change(i, "unitPriceExcl", e.target.value)
                        }
                        onKeyDown={(e) =>
                          moveToNextEntry(e, i, "unitPriceExcl")
                        }
                      />
                    )}
                    {l.input?.type === "CUSTOM" ? (
                      !unresolvedImportedCustom(l) && (
                        <small>{l.pending ? "—" : l.price?.finalExcl}</small>
                      )
                    ) : (
                      <>
                        <input
                          aria-label={
                            t("Final unit price before VAT", "سعر الوحدة النهائي قبل الضريبة") +
                            " " +
                            l.partNumber
                          }
                          className="compact"
                          type="text"
                          inputMode="decimal"
                          maxLength={15}
                          data-cart-field="unitPriceExcl"
                          data-cart-row={i}
                          value={
                            l.targetPriceDraft ?? l.price?.finalExcl ?? ""
                          }
                          onChange={(e) =>
                            changeCatalogFinalPrice(i, e.target.value)
                          }
                          onKeyDown={(e) =>
                            moveToNextEntry(e, i, "unitPriceExcl")
                          }
                        />
                        {repricingRows[i] && (
                          <small>{t("Refreshing…", "جارٍ التحديث…")}</small>
                        )}
                        {!!l.priceEntryNotice && (
                          <small className="sales-check-error">
                            {l.priceEntryNotice}
                          </small>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {unresolvedImportedCustom(l) ? null : l.pending ? (
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
                      {user.permissions.includes("QUOTE_PRICE_HISTORY") && (
                        <button title={t("Recent prices (F10)", "الأسعار السابقة (F10)")} onClick={() => setRecentPriceRow(i)}>F10</button>
                      )}
                      <button
                        title={t("Move up", "للأعلى")}
                        aria-label={t(
                          `Move ${l.partNumber} up`,
                          `نقل ${l.partNumber} للأعلى`,
                        )}
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
                        title={t("Move down", "للأسفل")}
                        aria-label={t(
                          `Move ${l.partNumber} down`,
                          `نقل ${l.partNumber} للأسفل`,
                        )}
                        disabled={i === cart.lines.length - 1}
                        onClick={() => {
                          const lines = [...cart.lines];
                          [lines[i], lines[i + 1]] = [lines[i + 1], lines[i]];
                          setCart({ ...cart, lines });
                        }}
                      >
                        ↓
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
      {recentPriceRow !== null && cart.lines[recentPriceRow] && (
        <RecentQuotationPrices t={t} line={cart.lines[recentPriceRow]} customer={cart.customer} quotationId={cart.id} onClose={() => setRecentPriceRow(null)} />
      )}
      {sum && (
        <div className="cart-totals">
          <span>
            {t("Subtotal", "المجموع")} <b>{sum.subtotal}</b>
          </span>
          <span>
            {t("VAT", "الضريبة")} <b>{sum.vat}</b>
          </span>
          <label className="cart-roundoff-field">
            <span>{t("Round-off total", "إجمالي التقريب")}</span>
            <input
              value={targetTotalValue}
              onChange={(e) =>
                setCart({
                  ...cart,
                  adjustment: { targetTotal: e.target.value },
                })
              }
              placeholder={t("Leave blank for no total discount", "اتركه فارغاً بدون خصم إجمالي")}
            />
            <small>
              {t(
                "Enter the final customer total. The total discount is calculated automatically.",
                "أدخل إجمالي العميل النهائي وسيتم حساب خصم الإجمالي تلقائياً.",
              )}
            </small>
          </label>
          {sum.quoteDiscount !== "0.00" && (
            <span>
              {t("Total discount", "خصم الإجمالي")} <b>{sum.quoteDiscount}</b>
            </span>
          )}
          <span className="grand-total">
            {t("Grand total", "الإجمالي")} <b>SAR {sum.total}</b>
          </span>
        </div>
      )}
      {!!sum.error && (
        <div className="notice">
          {t(sum.error, sum.error)}
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
        {user.permissions.includes("QUOTE_TEMPLATE_MANAGE") && (
          <button disabled={!cart.lines.length} onClick={onTemplates}>
            {t("Save as template", "حفظ كقالب")}
          </button>
        )}
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
