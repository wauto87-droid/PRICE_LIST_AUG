"use client";

export function normalizeLookupQuery(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
}

export function isSelectedLookupQuery(
  query: string,
  selectedPartNumber: string | null | undefined,
) {
  return (
    !!selectedPartNumber &&
    normalizeLookupQuery(query) === normalizeLookupQuery(selectedPartNumber)
  );
}

export function relatedLookupResults<T extends { id: string }>(
  results: T[],
  selected: { id: string } | null,
) {
  if (!selected) return results;
  return results.filter((product) => product.id !== selected.id);
}
