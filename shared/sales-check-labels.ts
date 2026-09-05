export const salesCheckMatchLabel = (code?: string | null) => ({ EXACT: "Exact catalog match", ALIAS: "Saved alias match", LOOSE: "Formatting-insensitive match" }[code ?? ""] ?? "Item not found");
export const salesCheckStatusLabel = (code?: string | null) => ({ MATCHED: "Checked", UNMATCHED: "Item not found", AMBIGUOUS: "Multiple possible items — review required", INVALID: "Invalid row — review required" }[code ?? ""] ?? "Review required");
export function salesCheckReasonLabel(reason?: string | null) {
  if (!reason) return "";
  if (/Sales price.*(?:invalid|number)|finite decimal/i.test(reason)) return "Invalid sales price";
  if (/no positive public list price/i.test(reason)) return "App list price unavailable";
  if (/more than one/i.test(reason)) return "Multiple possible items — review required";
  if (/no catalog product/i.test(reason)) return "Item not found";
  if (/inactive/i.test(reason)) return "Matched product is inactive";
  return reason;
}
