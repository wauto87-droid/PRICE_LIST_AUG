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
  if (
    decimal.decimalPlaces() > places &&
    decimal.sub(rounded).abs().gt("0.000000001")
  )
    return { value: source };
  const value = twoDecimalFields.has(leaf)
    ? rounded.toFixed(2)
    : rounded.toString();
  return value === source
    ? { value }
    : { value, normalized: { source, value } };
}
