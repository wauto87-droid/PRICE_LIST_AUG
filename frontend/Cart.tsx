"use client";
import ResponsiveTable from "./ResponsiveTable";
import { compactQuotationNumber, quotationMoney } from "./quotation-display";
import { useEffect, useRef, useState, useMemo } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import SortableQuotationRow from './SortableQuotationRow';
import { QuotationRowIdentity, reorderQuotationRows } from './quotation-row-order';
import { api, type Translate } from "./api";
import { totals, calculateCustom } from "@/backend/pricing/engine";
import { levelLabel, visibleLevels } from "./levels";
import {
  discountSafeNumberInputProps,
  wheelSafeNumberInputProps,
} from "./number-input";
import CustomLineForm from "./CustomLineForm";
import WorkflowCostReference from "./WorkflowCostReference";
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
  recoverImportedCustomUnitPrice,
} from "./cart-live-pricing";
import RecentQuotationPrices, { priceHistoryItemKey } from "./RecentQuotationPrices";
import { showConfirm } from "./confirm";
import {
  normalizeEditableQuotationCart,
  quotationSellingLevel,
} from "@/shared/quotation-line-compat";

import { recalculateSharedDraft, sharedDraftCommand } from '../shared/shared-draft';
import { pendingQuotationCommand, quotationCommandRejected, type PendingQuotationCommand } from './shared-quotation-command';
import {
  buildDuplicateGroups,
  normalizeDuplicateItemKey,
} from "./quotation-duplicate-groups";
import {
  findRepeatedItemPriceMismatches,
  formatPriceMismatchWarning,
  getMismatchedRowIndexes,
} from "./quotation-price-mismatch";
import {
  syncQuotationDeliveryMeta,
  stripDeliveryNotesFromReference,
} from "./quotation-delivery-sync";
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
  if (line.input?.type === "CUSTOM") return line.input.markup !== undefined;
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
  field: "discount" | "unitPriceExcl" | "quantity",
) {
  for (let index = currentIndex + 1; index < lines.length; index++) {
    if (["discount", "unitPriceExcl", "quantity"].includes(field)) return index;
  }
  return -1;
}

function computeCartTotals(lines: any[], targetTotalValue: string) {
  const base = totals(
    lines.flatMap((line: any) =>
      line.price && !line.compatibilityIssue ? [line.price] : [],
    ),
  );
  const unresolvedLines = lines.filter(
    (line: any) => !line.price || line.compatibilityIssue,
  ).length;
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
  onReloadShared,
}: {
  t: Translate;
  user: any;
  cart: any;
  setCart: (c: any) => void;
  settings: any;
  online: boolean;
  onSaved: (q: any) => void;
  onTemplates?: () => void;
  onReloadShared?: () => void;
}) {
  cart = useMemo(() => normalizeEditableQuotationCart(cart), [cart]);
  const [error, setError] = useState("");
  const [focusTable, setFocusTable] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const activeDrag = useRef<string | null>(null);
  const dragStartOrder = useRef<string[]>([]);
  const identity = useRef(new QuotationRowIdentity());
  const rowIds = identity.current.sync(cart.lines, String(cart.sharedDocumentId || cart.id || 'NEW'));
  const colourGroups = useRef(new Map<string, number>());
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [editingPriceRow, setEditingPriceRowState] = useState<number | null>(null);
  const editingPriceRowRef = useRef<number | null>(null);
  const setEditingPriceRow = (val: number | null) => {
    editingPriceRowRef.current = val;
    setEditingPriceRowState(val);
  };
  const focusButton = useRef<HTMLButtonElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (error) { setFocusTable(false); setDetailsOpen(true); detailsRef.current?.scrollIntoView?.({block: 'nearest'}); }
  }, [error]);
  useEffect(() => {
    if (!focusTable) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !activeDrag.current) { setFocusTable(false); focusButton.current?.focus(); }
    };
    window.addEventListener('keydown', exit);
    return () => window.removeEventListener('keydown', exit);
  }, [focusTable]);
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
  const pendingSharedSave = useRef<PendingQuotationCommand | null>(null);
  const sharedSaving = useRef(false);
  const refreshBaseline = useRef(JSON.stringify(cart.customer));
  useEffect(() => { refreshBaseline.current = JSON.stringify(cart.customer); },
    [cart.sharedDocumentId, cart.sharedRevision, cart.sharedQuoteVersion]);
  useEffect(() => {
    if (!cart.lines?.length) return;
    const synced = syncQuotationDeliveryMeta(cart.lines, cart.customer);
    if (synced.reference !== (cart.customer.reference || "") || synced.notes !== (cart.customer.notes || "")) {
      const next = { ...cartRef.current, customer: synced };
      cartRef.current = next;
      setCart(next);
    }
  }, [cart.id]);
  async function refreshSharedDraft() {
    if ((cart.sharedDirty || refreshBaseline.current !== JSON.stringify(cart.customer)) &&
      !await showConfirm(t('Refresh prices and version? Unsaved quotation edits will be replaced.', 'تحديث الأسعار والنسخة؟ سيتم استبدال التعديلات غير المحفوظة.'))) return;
    onReloadShared?.();
  }
  const pricingTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pricingSignatures = useRef<Record<number, string>>({});
  const pricingGenerations = useRef<Record<number, number>>({});
  const hasPendingLines = cart.lines.some((l: any) => l.pending);
  const reorderDisabled = busy || reuseBusy || !!cart.sharedPendingCommand || hasPendingLines || Object.values(repricingRows).some(Boolean);
  function reorderRows(from: number, to: number) {
    if (reorderDisabled) return;
    const current = cartRef.current;
    const lines = reorderQuotationRows(current.lines, from, to);
    if (lines === current.lines) return;
    const focused = document.activeElement as HTMLElement | null;
    const remap = (index: number | null) => index === null ? null : lines.indexOf(current.lines[index]);
    setEditingPriceRow(remap(editingPriceRow));
    setRecentPriceRow(remap(recentPriceRow));
    activePriceRow.current = remap(activePriceRow.current);
    // Invalidate index-addressed responses before changing positions.
    for (const timer of Object.values(pricingTimers.current)) clearTimeout(timer);
    pricingTimers.current = {};
    pricingSignatures.current = {};
    for (const key of Object.keys(pricingGenerations.current)) pricingGenerations.current[Number(key)]++;
    setRepricingRows({});
    const next = { ...current, lines, ...(current.sharedWorkflow ? { sharedDirty: true } : {}) };
    cartRef.current = next;
    setCart(next);
    requestAnimationFrame(() => { if (focused?.isConnected) focused.focus({ preventScroll: true }); });
  }
  const targetTotalValue =
    cart.adjustment?.targetTotal ?? cart.totals?.targetTotal ?? "";
  const calculatedSum = computeCartTotals(cart.lines, cart.sharedWorkflow ? "" : targetTotalValue);
  // Changing display order must not replace authoritative saved totals with a
  // local preview. Actual quantity/price/tax changes still use the preview.
  const pricingKey = JSON.stringify([cart.workflowCurrency, cart.sharedTaxBasis, cart.sharedTaxRate,
    cart.lines.map((line: any) => [line.sharedItemId, line.input?.quantity, line.input?.unitPriceExcl]).sort((a: any[], b: any[]) => String(a[0]).localeCompare(String(b[0])))]);
  const savedPricing = useRef({ document: cart.sharedDocumentId, key: pricingKey });
  if (!cart.sharedDirty || savedPricing.current.document !== cart.sharedDocumentId) savedPricing.current = { document: cart.sharedDocumentId, key: pricingKey };
  const sum = cart.sharedWorkflow && (!cart.sharedDirty || pricingKey === savedPricing.current.key) && cart.sharedCanonicalTotals ? { ...calculatedSum, ...cart.sharedCanonicalTotals } : calculatedSum;
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

  useEffect(() => {
    if (cart.sharedWorkflow) return;
    let recovered = 0;
    const lines = cart.lines.map((line: any) => {
      const input = recoverImportedCustomUnitPrice(line.input);
      if (input === line.input) return line;
      recovered++;
      return {
        ...line,
        input,
        price: calculateCustom(input, String(settings.vat)),
        pending: false,
        offline: false,
        livePriceError: "",
      };
    });
    if (!recovered) return;
    const next = { ...cart, lines };
    cartRef.current = next;
    setCart(next);
    setNotice(t(
      `Recovered the unit price for ${recovered} imported custom item${recovered === 1 ? "" : "s"}. Review and save the quotation.`,
      `تمت استعادة سعر الوحدة لـ ${recovered} من الأصناف المخصصة المستوردة. راجع عرض السعر ثم احفظه.`,
    ));
  }, [cart.lines, settings.vat]);

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
    field: "discount" | "unitPriceExcl" | "quantity",
  ) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const nextIndex = nextEditableRow(cartRef.current.lines, index, field);
    if (nextIndex < 0) return;
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
      const cleanedRef = stripDeliveryNotesFromReference(customer.reference || "");
      const next = {
        ...current,
        customer: {
          ...current.customer,
          name: customer.name || current.customer.name,
          number: code,
          mobile: customer.mobile || "",
          reference: current.customer.reference || cleanedRef,
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
    if (cart.sharedWorkflow) {
      if (!['quantity', 'unitPriceExcl'].includes(key)) return;
      const lines = cart.lines.map((l: any, i: number) => i === index ? { ...l, input: { ...l.input, [key]: value } } : l);
      try { setCart(recalculateSharedDraft({ ...cart, lines })); setError(''); } catch { setError('Enter a valid quantity and selling price.'); }
      return;
    }
    setError("");
    const lines = cart.lines.map((l: any, i: number) => {
      if (i !== index) return l;
      if (l.input?.type === "CUSTOM") {
        let input = {
          ...sanitizeCustomInput(l.input),
          [key]: (key === "discount" || key === "markup") && !value.trim() ? "0" : value,
        };
        if (key === "adjustmentMode") {
          const percentage = l.input.markup ?? l.input.discount ?? "0";
          delete input.adjustmentMode;
          delete input.markup;
          input.discount = value === "DISCOUNT" ? percentage : "0";
          if (value === "MARKUP") input.markup = percentage;
        }
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
    const isPartialDecimal = String(value).trim().endsWith(".");
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
      if (isPartialDecimal)
        return {
          ...line,
          pending: false,
          targetPriceDraft: value,
          targetPriceRequested: undefined,
          targetPriceError: false,
          priceEntryNotice: "",
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
    if (!online || cart.sharedWorkflow) return;
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
    if (!online || cart.sharedWorkflow) return;
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
              const isCurrentlyEditing = editingPriceRowRef.current === index;
              return {
                ...existing,
                input: synchronizedInput,
                price,
                pending: false,
                offline: false,
                livePriceError: "",
                targetPriceDraft: isCurrentlyEditing ? existing.targetPriceDraft : undefined,
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
      }, 500);
    });
    return () => {
      for (const timer of Object.values(pricingTimers.current)) clearTimeout(timer);
      pricingTimers.current = {};
    };
  }, [cart.lines, online]);

  async function reprice() {
    if (cart.sharedWorkflow) { setCart(recalculateSharedDraft(cart)); return; }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const lines = [];
      for (const line of cart.lines) {
        const catalogInput = catalogLivePricingInput(line);
        if (line.input?.type !== "CUSTOM" && !catalogInput)
          throw new Error(`Review quantity and pricing for ${line.partNumber || "this catalog item"}.`);
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
                price: await api("pricing", "POST", catalogInput),
                pending: false,
                offline: false,
              },
        );
      }
      setCart({ ...cart, lines });
    } catch (e) {
      setError(humanizeCustomLineError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const isInclusive = Boolean(cart.sharedWorkflow && cart.sharedTaxBasis === "INCLUSIVE");
    const mismatches = findRepeatedItemPriceMismatches(cart.lines, isInclusive, cart.workflowCurrency || "SAR");
    if (mismatches.length > 0) {
      const message = formatPriceMismatchWarning(mismatches, t, cart.workflowCurrency || "SAR");
      const proceed = await showConfirm(message, {
        title: t("Warning: Different Prices for Repeated Items", "تحذير: أسعار مختلفة لنفس الأصناف المكررة"),
        confirmText: t("Save Anyway", "حفظ على أي حال"),
        cancelText: t("Review Items", "مراجعة الأصناف"),
        tone: "warning",
      });
      if (!proceed) {
        const firstMismatched = mismatches[0]?.occurrences[0]?.rowIndex;
        if (firstMismatched !== undefined) {
          activePriceRow.current = firstMismatched;
          const el = document.querySelector(`[data-cart-row-index="${firstMismatched}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        return;
      }
    }

    if (cart.sharedWorkflow) {
      if (sharedSaving.current) return;
      sharedSaving.current = true; setBusy(true); setError('');
      try {
        const payload = sharedDraftCommand(cart);
        const pendingSave: PendingQuotationCommand = cart.sharedPendingCommand || pendingQuotationCommand(pendingSharedSave.current, payload, () => crypto.randomUUID());
        pendingSharedSave.current = pendingSave;
        setCart({ ...cart, sharedPendingCommand: pendingSave });
        await api('shared-quotation', 'POST', { ...pendingSave.payload, eventId: pendingSave.eventId });
        pendingSharedSave.current = null; onSaved(cart);
      } catch (e) { if (quotationCommandRejected(e)) { pendingSharedSave.current = null; setCart({ ...cart, sharedPendingCommand: undefined }); } setError((e as Error).message); }
      finally { sharedSaving.current = false; setBusy(false); }
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const requestId = cart.requestId || crypto.randomUUID();
    if (!cart.id && !cart.requestId) setCart({ ...cart, requestId });
    const syncedCustomer = syncQuotationDeliveryMeta(cart.lines, cart.customer);
    try {
      const q = await api(
        "quotations" + (cart.id ? "/" + cart.id : ""),
        cart.id ? "PUT" : "POST",
        {
          customer: syncedCustomer,
          lines: cart.lines.map((l: any) =>
            l.input?.type === "CUSTOM"
              ? sanitizeCustomInput(l.input)
              : {
                  ...l.input,
                  type: l.input?.type ?? "CATALOG",
                  sellingLevel: quotationSellingLevel(l),
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
        customer: syncedCustomer,
        id: q.id,
        version: q.version,
        number: q.number,
        ownerId: q.owner_id,
        workflowCurrency: q.workflowCurrency || "SAR",
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

  const { partCounts, duplicateIndices, groupColors } = useMemo(() => {
    return buildDuplicateGroups(cart.lines, colourGroups.current);
  }, [cart.lines]);

  const { priceMismatches, mismatchedRowIndexes } = useMemo(() => {
    const isInclusive = Boolean(cart.sharedWorkflow && cart.sharedTaxBasis === "INCLUSIVE");
    const mismatches = findRepeatedItemPriceMismatches(cart.lines, isInclusive, cart.workflowCurrency || "SAR");
    return { priceMismatches: mismatches, mismatchedRowIndexes: getMismatchedRowIndexes(mismatches) };
  }, [cart.lines, cart.sharedWorkflow, cart.sharedTaxBasis, cart.workflowCurrency]);

  return (
    <section className={`card quotation-editor${focusTable ? ' quotation-focus-table' : ''}`}>
      {priceMismatches.length > 0 && (
        <div className="notice warning quotation-mismatch-banner" role="alert" style={{ marginBottom: "8px" }}>
          <span>
            ⚠️ <b>{t("Price mismatch detected:", "تم اكتشاف اختلاف في الأسعار:")}</b>{" "}
            {t(
              `${priceMismatches.length} repeated item${priceMismatches.length > 1 ? "s have" : " has"} different prices across rows. Review rows or align prices before saving.`,
              `${priceMismatches.length} صنف مكرر له أسعار مختلفة بين الصفوف. يرجى مراجعة الصفوف أو توحيد الأسعار قبل الحفظ.`,
            )}
          </span>
        </div>
      )}
      <div className="quotation-compact-header"><strong>{cart.number || t('Current quotation','عرض السعر الحالي')}</strong><span title={cart.customer.name}>{cart.customer.name || t('Walk-in Customer','عميل نقدي')}</span><span>{cart.lines.length} {t('items','أصناف')}</span></div>
      <div className="actions quotation-editor-actions" role="toolbar" aria-label="Quotation preparation actions">
        <strong className="editor-total">{cart.lines.length} {t("items", "أصناف")} · {cart.workflowCurrency || "SAR"} {quotationMoney(sum.total, cart.workflowCurrency || "SAR")}</strong>
        <button type="button" ref={focusButton} aria-pressed={focusTable} onClick={() => setFocusTable(value => !value)}>{focusTable ? t("Exit focus", "إنهاء التركيز") : t("Focus table", "تركيز الجدول")}</button>
        {cart.sharedWorkflow && onReloadShared && <button disabled={busy || !!cart.sharedPendingCommand} onClick={() => void refreshSharedDraft()}>Refresh prices and version</button>}
        {cart.sharedPendingCommand && <p role="status">Retry the pending save before editing or refreshing. It will use the original command.</p>}
        {!cart.sharedWorkflow && user.permissions.includes("QUOTE_TEMPLATE_MANAGE") && (
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
            : cart.sharedWorkflow
              ? cart.sharedQuoteVersion ? t("Save quotation version", "حفظ نسخة العرض") : t("Convert to quotation", "تحويل إلى عرض سعر")
            : cart.id
              ? t("Update quotation", "تحديث عرض السعر")
              : t("Save quotation", "حفظ عرض السعر")}
        </button>
      </div>
      <fieldset disabled={!!cart.sharedWorkflow && (busy || !!cart.sharedPendingCommand)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="quotation-entry-options">
      {!cart.sharedWorkflow && user.permissions.includes("QUOTE_PRICE_HISTORY") && (
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
      {!cart.sharedWorkflow && <CustomLineForm
        t={t}
        vat={String(settings.vat)}
        suggestedPart={suggestedCustomPart}
        onAdd={(line) => {
          setCart({ ...cart, lines: [...cart.lines, line] });
          setSuggestedCustomPart("");
        }}
      />}
      </div>
<div className="form-grid quotation-customer-fields">{[["name","Customer name","اسم العميل"],["number","Customer Code","رمز العميل"]].map(([key,en,ar])=><label key={key}>{t(en,ar)}<input value={cart.customer[key] || ''} onChange={e=>setCart({...cart,customer:{...cart.customer,[key]:e.target.value}})} onBlur={()=>{if(key==='number')void loadCustomerByCode(String(cart.customer.number||''));}}/></label>)}</div>
      <details ref={detailsRef} className="quotation-customer-extras" open={detailsOpen} onToggle={e=>setDetailsOpen(e.currentTarget.open)}><summary>{t('Quotation details','تفاصيل عرض السعر')} · {cart.workflowCurrency || 'SAR'} · {t('VAT','الضريبة')} {cart.sharedWorkflow ? cart.sharedTaxBasis === 'EXEMPT' ? '0' : cart.sharedTaxRate : settings.vat}%</summary>
      {cart.sharedWorkflow && <div className="form-grid quotation-customer-fields">
        <label>Currency<input value={cart.workflowCurrency} readOnly/></label>
        <label>Tax<select value={cart.sharedTaxBasis} onChange={e => setCart(recalculateSharedDraft({ ...cart, sharedTaxBasis: e.target.value, sharedTaxRate: e.target.value === 'EXEMPT' ? '0' : cart.sharedTaxRate }))}><option value="EXCLUSIVE">Tax additional</option><option value="INCLUSIVE">Tax included</option><option value="EXEMPT">Exempt</option></select></label>
        <label>Tax rate %<input type="number" min="0" max="100" value={cart.sharedTaxRate} disabled={cart.sharedTaxBasis === 'EXEMPT'} onChange={e => setCart(recalculateSharedDraft({ ...cart, sharedTaxRate: e.target.value }))}/></label>
        {user.role === 'ADMIN' && <label>Administrator reason<input value={cart.sharedOverrideReason} onChange={e => setCart({ ...cart, sharedOverrideReason: e.target.value })}/></label>}
      </div>}
<div className="form-grid quotation-customer-fields">{[["mobile","Mobile","الجوال"],["reference","Reference","المرجع"]].map(([key,en,ar])=><label key={key}>{t(en,ar)}<input value={cart.customer[key] || ''} onChange={e=>setCart({...cart,customer:{...cart.customer,[key]:e.target.value}})} onBlur={()=>{if(key==='number')void loadCustomerByCode(String(cart.customer.number||''));}}/></label>)}</div>        <div className="notice">
          <span>{t("Customer Code improves same-customer price highlighting.", "رمز العميل يحسن تمييز الأسعار السابقة لنفس العميل.")}</span>
          <button type="button" onClick={() => setCart({ ...cart, customer: { ...cart.customer, name: "", number: "1" } })}>{t("Walk-in Customer", "عميل نقدي")}</button>
        </div>
        <label className="cart-notes">
          {t("Notes", "ملاحظات")}
          <textarea
            rows={2}
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
      </details>
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
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          accessibility={{ screenReaderInstructions: { draggable: t('Press Space to pick up this item, arrow keys to move, Space to drop, or Escape to cancel.', 'اضغط المسافة لالتقاط الصنف والأسهم لنقله والمسافة لوضعه أو Escape للإلغاء.') }, announcements: {
            onDragStart: ({active}) => t(`Picked up item ${rowIds.indexOf(String(active.id))+1}.`, `تم التقاط الصنف ${rowIds.indexOf(String(active.id))+1}.`),
            onDragOver: ({over}) => over ? t(`Move to position ${rowIds.indexOf(String(over.id))+1}.`, `النقل إلى الموضع ${rowIds.indexOf(String(over.id))+1}.`) : undefined,
            onDragEnd: ({over}) => over ? t(`Dropped at position ${rowIds.indexOf(String(over.id))+1}.`, `تم الوضع في الموضع ${rowIds.indexOf(String(over.id))+1}.`) : t('Move cancelled.', 'تم إلغاء النقل.'),
            onDragCancel: () => t('Move cancelled.', 'تم إلغاء النقل.'),
          } }}
          onDragStart={({active}) => { activeDrag.current=String(active.id); dragStartOrder.current=[...rowIds]; setDragId(String(active.id)); }}
          onDragCancel={() => { activeDrag.current=null; setDragId(null); }}
          onDragEnd={({active,over}) => {
            if (over && dragStartOrder.current.join('|')===rowIds.join('|')) reorderRows(rowIds.indexOf(String(active.id)),rowIds.indexOf(String(over.id)));
            activeDrag.current=null; setDragId(null);
          }}>
        <SortableContext items={rowIds}>
        <div className="table-scroll quotation-entry-table">
          <ResponsiveTable aria-label={t("Quotation preparation items", "أصناف إعداد عرض السعر")}>
            <thead>
              <tr>
                <th>{t("Part / description", "الصنف / الوصف")}</th>
                <th>{t("Qty", "الكمية")}</th>
                <th>{t("Discount / Markup %", "الخصم / هامش الربح %")}</th>
                <th>{cart.sharedWorkflow && cart.sharedTaxBasis === "INCLUSIVE" ? t("Selling price incl. VAT", "السعر شامل الضريبة") : t("Final excl. VAT", "النهائي قبل الضريبة")}</th>
                <th>{t("Total incl. VAT", "الإجمالي شامل الضريبة")}</th>
                <th>{t("Actions", "إجراءات")}</th>
              </tr>
            </thead>
            <tbody>
              {!cart.sharedWorkflow && <QuotationLineQuickAdd
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
              />}
              {cart.lines.map((l: any, i: number) => {
                const itemKey = normalizeDuplicateItemKey(l);
                const isDuplicate = Boolean(itemKey && (partCounts[itemKey] || 0) > 1);
                const dupIndex = isDuplicate ? duplicateIndices[itemKey] || 0 : 0;
                const dupColor = isDuplicate ? groupColors[itemKey] : null;
                const hasPriceMismatch = mismatchedRowIndexes.has(i);
                const pn = l.input?.partNumber || l.partNumber;
                const dnMeta = importedDeliveryMeta(l);
                return (
                <SortableQuotationRow
                  id={rowIds[i]}
                  disabled={reorderDisabled}
                  handleLabel={t(`Drag item ${i+1}: ${pn || 'Custom item'}`, `اسحب الصنف ${i+1}: ${pn || 'صنف مخصص'}`)}
                  className={isDuplicate ? `duplicate-line duplicate-color-${dupIndex}` : ""}
                  style={dupColor ? ({
                    '--quotation-row-tint': dupColor.bg,
                    '--quotation-row-border': dupColor.border,
                  } as React.CSSProperties) : undefined}
                  key={rowIds[i]}
                  data-cart-row-index={i}
                  onFocusCapture={() => { activePriceRow.current = i; }}
                  onMouseEnter={() => { activePriceRow.current = i; }}
                >
                  {handle => <>
                  <td className="quotation-item-cell">
                    <div className="quotation-item-summary">{handle}<span className="quotation-row-number">{i+1}</span><div><strong>{pn || '—'}{" "}{isDuplicate && <span className="quotation-duplicate-label" style={dupColor ? { borderColor: dupColor.border, color: dupColor.text } : undefined} title={t(`Group #${dupIndex} · ${partCounts[itemKey]} occurrences of this item`, `المجموعة #${dupIndex} · ${partCounts[itemKey]} تكرارات لهذا الصنف`)}>#{dupIndex} {t('Repeated','مكرر')} ×{partCounts[itemKey]}</span>}{hasPriceMismatch && <span className="quotation-price-mismatch-badge" title={t("This repeated item has different prices across rows. Review before saving.", "هذا الصنف المكرر يحتوي على أسعار مختلفة بين الصفوف. يرجى المراجعة قبل الحفظ.")}>⚠️ {t("Different price", "سعر مختلف")}</span>}</strong><small className="quotation-line-description" title={l.input?.description || l.description}>{l.input?.description || l.description}</small>{dnMeta && (dnMeta.docNo || dnMeta.docDate) && <div className="quotation-dn-line"><span className="quotation-dn-badge" title={t(`Delivery note ${dnMeta.docNo || '—'}${dnMeta.docDate ? ` · Date: ${dnMeta.docDate}` : ''}${dnMeta.rowNumber ? ` · Row #${dnMeta.rowNumber}` : ''}`, `إذن تسليم ${dnMeta.docNo || '—'}${dnMeta.docDate ? ` · التاريخ: ${dnMeta.docDate}` : ''}`)}>📋 DN: <b>{dnMeta.docNo || '—'}</b>{dnMeta.docDate ? ` · ${dnMeta.docDate}` : ''}</span></div>}</div></div>
                    <details className="quotation-line-options"><summary aria-label={t('Item details','تفاصيل الصنف')+' '+(i+1)}>{t('Details','تفاصيل')}</summary><div className="quotation-expanded-item">
                    {l.input?.type === "CUSTOM" && !cart.sharedWorkflow ? (
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
                        <details><summary>{t("Find catalog match", "مطابقة الكتالوج")}</summary><CustomLineCatalogResolver
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
                        /></details>
                      </>
                    ) : (
                      <>
                        <strong>{l.partNumber}</strong>
                        <small className="quotation-line-description" title={l.description}>{l.description}</small>
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

                    {(l.description || l.input?.description) && <p className="quotation-full-description">{l.description || l.input.description}</p>}
                    <WorkflowCostReference
                      line={l}
                      visible={!!l.workflowCost || user.permissions.includes("COST_VIEW") || (!!cart.ownerId && cart.ownerId === user.id)}
                      currency={cart.workflowCurrency || "SAR"}
                      t={t}
                    />
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
                          value={quotationSellingLevel(l)}
                          onChange={(e) =>
                            change(i, "sellingLevel", e.target.value)
                          }
                        >
                          <option
                            value={quotationSellingLevel(l)}
                          >
                            {levelLabel(
                              quotationSellingLevel(l),
                              t,
                            )}
                          </option>
                          {(options[l.productId] ?? l.sellingLevels ?? [])
                            .filter(
                              (v) =>
                                v.code !==
                                quotationSellingLevel(l),
                            )
                            .map((v) => (
                              <option key={v.code} value={v.code}>
                                {levelLabel(v.code, t)} · {v.masterExcl}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    </div></details>
                    {!!l.livePriceError && (
                      <small className="sales-check-error">{l.livePriceError}</small>
                    )}
                    {!!l.compatibilityIssue && (
                      <small className="sales-check-error" role="alert">
                        {t(l.compatibilityIssue, l.compatibilityIssue)}
                      </small>
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
                      data-cart-field="quantity"
                      data-cart-row={i}
                      onKeyDown={(e) => moveToNextEntry(e, i, "quantity")}
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
                    {l.input?.type === "CUSTOM" && !cart.sharedWorkflow && (
                      <select aria-label={t("Adjustment", "التعديل") + " " + (i + 1)}
                        value={l.input.markup === undefined ? "DISCOUNT" : "MARKUP"}
                        onChange={(e) => change(i, "adjustmentMode", e.target.value)}>
                        <option value="DISCOUNT">{t("Discount", "خصم")}</option>
                        <option value="MARKUP">{t("Markup", "زيادة")}</option>
                      </select>
                    )}
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
                      disabled={cart.sharedWorkflow}
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
                        onFocus={() => setEditingPriceRow(i)}
                        onBlur={() => setEditingPriceRow(null)}
                        value={
                          unresolvedImportedCustom(l)
                            ? ""
                            : editingPriceRow === i ? l.input.unitPriceExcl : compactQuotationNumber(l.input.unitPriceExcl)
                        }
                        onChange={(e) =>
                          change(i, "unitPriceExcl", e.target.value)
                        }
                        onKeyDown={(e) =>
                          moveToNextEntry(e, i, "unitPriceExcl")
                        }
                      />
                    )}
                    {l.input?.type === "CUSTOM" ? null : (
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
                          onFocus={() => setEditingPriceRow(i)}
                          onBlur={() => {
                            setEditingPriceRow(null);
                            setCartLine(i, (existing) => {
                              if (existing.targetPriceDraft === undefined) return existing;
                              const raw = String(existing.targetPriceDraft).trim();
                              if (raw.endsWith(".")) {
                                const result = normalizeTargetPrice(raw);
                                if (result.ok) {
                                  return {
                                    ...existing,
                                    targetPriceDraft: undefined,
                                    targetPriceRequested: result.target,
                                    pending: true,
                                  };
                                }
                              }
                              return {
                                ...existing,
                                targetPriceDraft: undefined,
                              };
                            });
                          }}
                          data-cart-field="unitPriceExcl"
                          data-cart-row={i}
                          value={
                            editingPriceRow === i
                              ? (l.targetPriceDraft ?? (l.price?.finalExcl ? compactQuotationNumber(l.price.finalExcl) : ""))
                              : compactQuotationNumber(l.targetPriceDraft ?? l.price?.finalExcl ?? "")
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
                        {hasPriceMismatch && (
                          <small className="sales-check-error" style={{ display: "block", marginTop: "2px" }} title={t("This item has different prices on other rows", "هذا الصنف له أسعار مختلفة في صفوف أخرى")}>
                            ⚠️ {t("Different price", "سعر مختلف")}
                          </small>
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
                      quotationMoney(l.price?.total, cart.workflowCurrency || "SAR")
                    )}
                  </td>
                  <td>
                    <div className="actions"><details className="quotation-row-actions"><summary aria-label={t("Row actions","إجراءات السطر")+" "+(i+1)}>⋯</summary><div className="quotation-secondary-actions">
                      {user.permissions.includes("QUOTE_PRICE_HISTORY") && (
                        <button title={t("Recent prices (F10)", "الأسعار السابقة (F10)")} onClick={() => setRecentPriceRow(i)}>F10</button>
                      )}
                      <button
                        title={t("Move up", "للأعلى")}
                        aria-label={t(
                          `Move ${l.partNumber} up`,
                          `نقل ${l.partNumber} للأعلى`,
                        )}
                        disabled={reorderDisabled || i === 0}
                        onClick={() => reorderRows(i, i-1)}
                      >
                        ↑
                      </button>
                      <button
                        title={t("Move down", "للأسفل")}
                        aria-label={t(
                          `Move ${l.partNumber} down`,
                          `نقل ${l.partNumber} للأسفل`,
                        )}
                        disabled={reorderDisabled || i === cart.lines.length - 1}
                        onClick={() => reorderRows(i, i+1)}
                      >
                        ↓
                      </button>
                    </div></details>
                      <button
                        title={t("Remove", "حذف")}
                        onClick={() => {
                          const nextLines = cart.lines.filter(
                            (_: any, n: number) => n !== i,
                          );
                          const nextCustomer = syncQuotationDeliveryMeta(nextLines, cart.customer);
                          setCart({
                            ...cart,
                            customer: nextCustomer,
                            sharedDirty: cart.sharedWorkflow ? true : undefined,
                            lines: nextLines,
                          });
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                  </>}
                </SortableQuotationRow>
              )})}
            </tbody>
          </ResponsiveTable>
        </div>
        </SortableContext>
        <DragOverlay>{dragId && <div className="quotation-drag-preview">{t('Move item','نقل الصنف')} {rowIds.indexOf(dragId)+1} · {cart.lines[rowIds.indexOf(dragId)]?.input?.partNumber || cart.lines[rowIds.indexOf(dragId)]?.partNumber}</div>}</DragOverlay>
        </DndContext>
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
            {t("Subtotal", "المجموع")} <b>{quotationMoney(sum.subtotal, cart.workflowCurrency || 'SAR')}</b>
          </span>
          <span>
            {t("VAT", "الضريبة")} <b>{quotationMoney(sum.vat, cart.workflowCurrency || 'SAR')}</b>
          </span>
          {!cart.sharedWorkflow && <label className="cart-roundoff-field">
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
          </label>}
          {sum.quoteDiscount !== "0.00" && (
            <span>
              {t("Total discount", "خصم الإجمالي")} <b>{quotationMoney(sum.quoteDiscount, cart.workflowCurrency || 'SAR')}</b>
            </span>
          )}
          <span className="grand-total">
            {t("Grand total", "الإجمالي")} <b>{cart.workflowCurrency || "SAR"} {quotationMoney(sum.total, cart.workflowCurrency || 'SAR')}</b>
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
      </fieldset>
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
