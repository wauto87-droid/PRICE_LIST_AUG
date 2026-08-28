"use client";

export function clampHighlightedIndex(index: number, length: number) {
  if (!length) return -1;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

export function moveHighlightedIndex(
  current: number,
  direction: "next" | "previous",
  length: number,
) {
  if (!length) return -1;
  if (current < 0) return direction === "next" ? 0 : length - 1;
  if (direction === "next") return Math.min(current + 1, length - 1);
  return Math.max(current - 1, 0);
}

export function suggestionOptionId(baseId: string, index: number) {
  return `${baseId}-option-${index}`;
}

export function activeSuggestionIndex(index: number, length: number) {
  if (!length) return -1;
  if (index >= 0 && index < length) return index;
  return 0;
}

export function topSuggestions<T>(items: T[], limit = 8) {
  return items.slice(0, limit);
}
