import Decimal from "decimal.js";

/** Presentation only: never round or replace a stored unit price. */
export function compactQuotationNumber(value: unknown): string {
  const text = String(value ?? "");
  return /^-?\d+\.\d+$/.test(text) ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
export function quotationMoney(value: unknown, currency = "SAR"): string {
  if (value === undefined || value === null || value === "") return "—";
  try { return currency === "SAR" ? new Decimal(String(value)).toFixed(2) : compactQuotationNumber(value); }
  catch { return String(value); }
}
