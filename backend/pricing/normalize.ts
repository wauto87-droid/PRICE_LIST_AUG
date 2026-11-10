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

export function formatDeliveryDateDisplay(input: unknown): string {
  if (input === null || input === undefined) return "";
  const source = String(input).trim();
  if (!source) return "";

  // If already in DD-MM-YY format (e.g. 29-10-26)
  if (/^\d{2}-\d{2}-\d{2}$/.test(source)) return source;

  // If in DD-MM-YYYY or DD/MM/YYYY format
  const dmyMatch = source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmyMatch && Number(dmyMatch[1]) <= 31 && Number(dmyMatch[2]) <= 12) {
    const [, d, m, y] = dmyMatch;
    return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y.slice(-2)}`;
  }

  // If in YYYY-MM-DD or YYYY/MM/DD format
  const ymdMatch = source.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${d.padStart(2, "0")}-${m.padStart(2, "0")}-${y.slice(-2)}`;
  }

  // Excel serial date number
  const num = Number(source);
  if (!isNaN(num) && num > 10000 && num < 100000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(date.getTime())) {
      const d = String(date.getUTCDate()).padStart(2, "0");
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      const y = String(date.getUTCFullYear()).slice(-2);
      return `${d}-${m}-${y}`;
    }
  }

  // Fallback via Date parser
  const parsed = new Date(source);
  if (!isNaN(parsed.getTime()) && source.length >= 6 && /\d/.test(source)) {
    const d = String(parsed.getUTCDate()).padStart(2, "0");
    const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const y = String(parsed.getUTCFullYear()).slice(-2);
    if (`${y}-${m}-${d}` !== "70-01-01") return `${d}-${m}-${y}`;
  }

  return source;
}
