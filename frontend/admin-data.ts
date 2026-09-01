export type AdminResult = { section: string; payload: any } | null;
export const selfLoadingAdminSections = [
  "imports",
  "rules",
  "quotation-settings",
  "discount-requests",
  "sales-price-check",
  "quantity-finder",
  "price-watcher",
  "reusable-custom-items",
] as const;
export function sectionData(result: AdminResult, section: string) {
  return result?.section === section ? result.payload : null;
}
export function validateAdminData(section: string, value: any) {
  const object =
    value !== null && typeof value === "object" && !Array.isArray(value);
  const valid =
    section === "dashboard"
      ? object &&
        ["products", "quotes", "imports"].every(
          (key) => value[key] && typeof value[key] === "object",
        ) &&
        [
          "recentImports",
          "importErrors",
          "duplicateRows",
          "minimumProtected",
          "minimumProtectedSelectionItems",
          "updatedTodayItems",
          "draftQuotations",
          "issuedTodayItems",
        ].every((key) => Array.isArray(value[key])) &&
        Number.isInteger(value.minimumProtectedPage) &&
        Number.isInteger(value.minimumProtectedPageSize) &&
        Number.isInteger(value.minimumProtectedTotalRows) &&
        Number.isInteger(value.minimumProtectedTotalPages) &&
        typeof value.minimumProtectedHasMore === "boolean" &&
        Number.isInteger(value.minimumProtectedSelectionOffset) &&
        typeof value.minimumProtectedSelectionHasMore === "boolean" &&
        typeof value.minimumProtectedSelectionLimitReached === "boolean"
      : section === "roles"
        ? object &&
          Array.isArray(value.roles) &&
          Array.isArray(value.permissions)
        : section === "products"
          ? object &&
            Array.isArray(value.items) &&
            Array.isArray(value.selectableItems) &&
            Number.isInteger(value.page) &&
            Number.isInteger(value.pageSize) &&
            Number.isInteger(value.totalRows) &&
            Number.isInteger(value.totalPages) &&
            typeof value.hasMore === "boolean" &&
            ["ALL", "PROTECTED", "UNPROTECTED"].includes(value.minimumFilter) &&
            ["ALL", "ACTIVE", "ARCHIVED"].includes(value.statusFilter) &&
            ["ALL", "COST_MARKUP", "LIST_DISCOUNT", "FIXED"].includes(
              value.methodFilter,
            ) &&
            ["ALL", "MISSING", "COMPLETE"].includes(value.contentFilter) &&
            Number.isInteger(value.selectionOffset) &&
            typeof value.selectionHasMore === "boolean" &&
            typeof value.selectionLimitReached === "boolean"
          : section === "settings"
            ? object
            : Array.isArray(value);
  if (!valid)
    throw new Error(
      "Unexpected administration response. Refresh this section or try again.",
    );
  return value;
}
