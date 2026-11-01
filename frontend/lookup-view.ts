"use client";

export function normalizeLookupQuery(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
}

export function normalizeLookupCleanPart(value: string | null | undefined) {
  return normalizeLookupQuery(value).replace(/[^A-Z0-9\u0600-\u06FF]+/g, "");
}

export function isSelectedLookupQuery(
  query: string,
  selectedPartNumber: string | null | undefined,
) {
  if (!selectedPartNumber) return false;
  const qClean = normalizeLookupCleanPart(query);
  const pClean = normalizeLookupCleanPart(selectedPartNumber);
  return qClean === pClean && qClean.length > 0;
}

export function relatedLookupResults<T extends { id: string }>(
  results: T[],
  selected: { id: string } | null,
) {
  if (!selected) return results;
  return results.filter((product) => product.id !== selected.id);
}
