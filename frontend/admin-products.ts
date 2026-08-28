"use client";

import type { Translate } from "./api";

export function buildBulkItems(selected: Record<string, unknown>) {
  return Object.entries(selected)
    .map(([id, version]) => ({
      id,
      version: normalizeBulkVersion(version),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function classifyBulkDeleteError(message: string) {
  if (/used in quotation|referenced by import/i.test(message)) return "blocked";
  if (
    /reload .* deleting|reload its current values before deleting|products changed/i.test(
      message,
    )
  )
    return "stale";
  if (
    /items(?:\.\d+)?(?:\.(?:id|version))?:|invalid input|expected .* received/i.test(
      message,
    )
  )
    return "invalid-selection";
  return "generic";
}

export function formatBulkDeleteError(message: string, t: Translate) {
  const kind = classifyBulkDeleteError(message);
  if (kind === "blocked") return message;
  if (kind === "stale")
    return t(
      "One or more selected products changed before deletion. Refresh the products list and try again.",
      "تغير واحد أو أكثر من الأصناف المحددة قبل الحذف. حدّث قائمة الأصناف ثم أعد المحاولة.",
    );
  if (kind === "invalid-selection")
    return t(
      "One or more selected products had invalid selection data. Refresh the products list and try again.",
      "تحتوي بعض الأصناف المحددة على بيانات تحديد غير صالحة. حدّث قائمة الأصناف ثم أعد المحاولة.",
    );
  return message;
}

export function getProductSuggestions(items: any[], query: string, limit = 6) {
  if (!query.trim()) return [];
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (!item?.id || !item?.partNumber || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, limit);
}

export function chunkBulkItems<T>(items: T[], size = 250) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}

function normalizeBulkVersion(version: unknown) {
  if (typeof version === "string" && /^-?\d+$/.test(version.trim()))
    return Number(version.trim());
  return version;
}
