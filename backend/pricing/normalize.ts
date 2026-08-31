import Decimal from "decimal.js";

const twoDecimalFields = new Set(["minimum", "fixedPrice", "sellingPrice"]);
const numericFields = new Set([
  "cost",
  "markup",
  "listPrice",
  "baseDiscount",
  "vat",
  "minimum",
  "fixedPrice",
  "sellingPrice",
]);

export function normalizeImportedDecimal(field: string, input: unknown) {
  const leaf = field.split(".").at(-1) ?? field;
  if (!numericFields.has(leaf)) return { value: input };
  const source = String(input).trim();
  if (!/^\d+(?:\.\d+)?$/.test(source)) return { value: source };
  let decimal: Decimal;
  try {
    decimal = new Decimal(source);
  } catch {
    return { value: source };
  }
  if (!decimal.isFinite()) return { value: source };
  const places = twoDecimalFields.has(leaf) ? 2 : 6;
  const rounded = decimal.toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  const value = twoDecimalFields.has(leaf)
    ? rounded.toFixed(2)
    : rounded.toString();
  return value === source
    ? { value }
    : { value, normalized: { source, value } };
}

export function formatDeliveryDocNo(input: unknown): string {
  if (input === null || input === undefined) return "";
  const source = String(input).trim();
  if (!source) return "";
  const num = Number(source);
  if (!isNaN(num) && Number.isInteger(num)) {
    return String(Math.trunc(num));
  }
  return source.replace(/\.0+$/, "");
}

export function formatDeliveryDate(input: unknown): string {
  if (input === null || input === undefined) return "";
  const source = String(input).trim();
  if (!source) return "";
  const num = Number(source);
  // Excel serial dates: e.g. 10000 to 100000 represents years 1927 to 2173
  if (!isNaN(num) && num > 10000 && num < 100000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(source);
  if (!isNaN(parsed.getTime()) && source.length >= 8 && /\d/.test(source)) {
    const iso = parsed.toISOString().slice(0, 10);
    if (iso !== "1970-01-01") return iso;
  }
  return source;
}
