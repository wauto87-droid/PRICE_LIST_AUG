import type { Translate } from "./api";
import { normalizeDuplicateItemKey } from "./quotation-duplicate-groups";

export interface PriceOccurrence {
  rowIndex: number; // 0-based index in lines array
  rowNumber: number; // 1-based display number
  price: number;
  formattedPrice: string;
  quantity: string;
}

export interface PriceMismatchGroup {
  key: string;
  partNumber: string;
  description: string;
  distinctPrices: number[];
  occurrences: PriceOccurrence[];
}

/**
 * Extracts the effective unit selling price for a quotation line.
 */
export function extractLineEffectivePrice(
  line: any,
  isInclusive = false,
): number | null {
  if (!line) return null;

  // 1. Check if user typed a draft target price
  if (
    line.targetPriceDraft !== undefined &&
    line.targetPriceDraft !== null &&
    String(line.targetPriceDraft).trim() !== ""
  ) {
    const val = Number(line.targetPriceDraft);
    if (!isNaN(val)) return val;
  }

  // 2. In inclusive tax workflow, check finalIncl
  if (
    isInclusive &&
    line.price?.finalIncl !== undefined &&
    line.price?.finalIncl !== null &&
    String(line.price.finalIncl).trim() !== ""
  ) {
    const val = Number(line.price.finalIncl);
    if (!isNaN(val)) return val;
  }

  // 3. Calculated finalExcl
  if (
    line.price?.finalExcl !== undefined &&
    line.price?.finalExcl !== null &&
    String(line.price.finalExcl).trim() !== ""
  ) {
    const val = Number(line.price.finalExcl);
    if (!isNaN(val)) return val;
  }

  // 4. Custom line raw unitPriceExcl
  if (
    line.input?.unitPriceExcl !== undefined &&
    line.input?.unitPriceExcl !== null &&
    String(line.input.unitPriceExcl).trim() !== ""
  ) {
    const val = Number(line.input.unitPriceExcl);
    if (!isNaN(val)) return val;
  }

  return null;
}

/**
 * Scans quotation lines and returns all repeated items that have different prices.
 */
export function findRepeatedItemPriceMismatches(
  lines: any[],
  isInclusive = false,
  currency = "SAR",
): PriceMismatchGroup[] {
  const groups: Record<
    string,
    {
      partNumber: string;
      description: string;
      occurrences: PriceOccurrence[];
    }
  > = {};

  lines.forEach((line, index) => {
    const key = normalizeDuplicateItemKey(line);
    if (!key) return;

    const price = extractLineEffectivePrice(line, isInclusive);
    if (price === null) return;

    const pn = String(line.input?.partNumber || line.partNumber || "").trim();
    const desc = String(line.input?.description || line.description || "").trim();
    const qty = String(line.input?.quantity || line.quantity || "1").trim();

    if (!groups[key]) {
      groups[key] = {
        partNumber: pn || key.replace(/^DESC:/, ""),
        description: desc,
        occurrences: [],
      };
    }

    groups[key].occurrences.push({
      rowIndex: index,
      rowNumber: index + 1,
      price,
      formattedPrice: price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      quantity: qty,
    });
  });

  const mismatches: PriceMismatchGroup[] = [];

  for (const [key, group] of Object.entries(groups)) {
    if (group.occurrences.length < 2) continue;

    const distinctPrices: number[] = [];
    for (const occ of group.occurrences) {
      const isAlreadyInList = distinctPrices.some(
        (p) => Math.abs(p - occ.price) < 0.005,
      );
      if (!isAlreadyInList) {
        distinctPrices.push(occ.price);
      }
    }

    if (distinctPrices.length > 1) {
      mismatches.push({
        key,
        partNumber: group.partNumber,
        description: group.description,
        distinctPrices,
        occurrences: group.occurrences,
      });
    }
  }

  return mismatches;
}

/**
 * Returns a Set of row indices (0-indexed) that belong to price-mismatched groups.
 */
export function getMismatchedRowIndexes(
  mismatches: PriceMismatchGroup[],
): Set<number> {
  const indexes = new Set<number>();
  for (const group of mismatches) {
    for (const occ of group.occurrences) {
      indexes.add(occ.rowIndex);
    }
  }
  return indexes;
}

/**
 * Builds a clear, readable warning message detailing which items and lines have conflicting prices.
 */
export function formatPriceMismatchWarning(
  mismatches: PriceMismatchGroup[],
  t: Translate,
  currency = "SAR",
): string {
  const intro = t(
    `The following repeated item${mismatches.length > 1 ? "s have" : " has"} different prices in this quotation:`,
    `الأصناف المكررة التالية تحتوي على أسعار مختلفة في عرض السعر هذا:`,
  );

  const itemDetails = mismatches
    .map((group) => {
      const header = `• ${group.partNumber}${group.description ? ` (${group.description})` : ""}:`;
      const occs = group.occurrences
        .map(
          (occ) =>
            `   - ${t("Line", "السطر")} ${occ.rowNumber}: ${currency} ${occ.formattedPrice} (${t("Qty", "الكمية")}: ${occ.quantity})`,
        )
        .join("\n");
      return `${header}\n${occs}`;
    })
    .join("\n\n");

  const question = t(
    "Would you like to save anyway, or review and quote the same price for these items?",
    "هل ترغب في الحفظ على أي حال، أم مراجعة الأصناف وتوحيد السعر؟",
  );

  return `${intro}\n\n${itemDetails}\n\n${question}`;
}
