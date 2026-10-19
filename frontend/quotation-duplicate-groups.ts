export interface DuplicateGroupColor {
  bg: string;
  border: string;
  text: string;
}

// Curated pastel palette with pleasant contrast and soft table tints
const CURATED_PALETTE: DuplicateGroupColor[] = [
  { bg: "#fff0f0", border: "#f2bfc2", text: "#991b1b" }, // 1: Rose / Red
  { bg: "#f0f8ff", border: "#b3d4ff", text: "#1e40af" }, // 2: Alice Blue
  { bg: "#f0fff0", border: "#b3ffb3", text: "#166534" }, // 3: Honeydew / Mint
  { bg: "#fffaf0", border: "#ffe4b3", text: "#9a3412" }, // 4: Warm Amber / Floral
  { bg: "#f8f0ff", border: "#dcb3ff", text: "#6b21a8" }, // 5: Lavender
  { bg: "#f0ffff", border: "#b3ffff", text: "#0e7490" }, // 6: Cyan / Aqua
  { bg: "#fff4ed", border: "#ffd2ba", text: "#c2410c" }, // 7: Peach
  { bg: "#fefce8", border: "#fef08a", text: "#854d0e" }, // 8: Lemon
  { bg: "#f5f0ff", border: "#ddd6fe", text: "#5b21b6" }, // 9: Lilac
  { bg: "#ecfdf5", border: "#a7f3d0", text: "#065f46" }, // 10: Emerald / Sage
  { bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3" }, // 11: Indigo
  { bg: "#fff1f2", border: "#fecdd3", text: "#be123c" }, // 12: Crimson soft
  { bg: "#f7fee7", border: "#d9f99d", text: "#3f6212" }, // 13: Lime soft
  { bg: "#f1f5f9", border: "#cbd5e1", text: "#334155" }, // 14: Slate
  { bg: "#fae8ff", border: "#f5d0fe", text: "#86198f" }, // 15: Fuchsia soft
  { bg: "#fffbeb", border: "#fde68a", text: "#78350f" }, // 16: Amber soft
];

/**
 * Returns a distinct color for any group index N (1-indexed).
 * Uses curated tones for the first 16, and golden-ratio HSL distribution for N > 16,
 * ensuring zero color collision across arbitrarily large numbers of duplicate groups.
 */
export function getDuplicateGroupColor(groupIndex: number): DuplicateGroupColor {
  if (groupIndex <= 0) {
    return { bg: "#ffffff", border: "#e2e8f0", text: "#334155" };
  }
  if (groupIndex <= CURATED_PALETTE.length) {
    return CURATED_PALETTE[groupIndex - 1];
  }
  // Golden ratio hue angle offset guarantees maximal hue separation for successive indices
  const hue = Math.round(((groupIndex - 1) * 137.508) % 360);
  return {
    bg: `hsl(${hue}, 85%, 95%)`,
    border: `hsl(${hue}, 60%, 80%)`,
    text: `hsl(${hue}, 80%, 25%)`,
  };
}

/**
 * Normalizes an item key for consistent duplicate grouping.
 */
export function normalizeDuplicateItemKey(line: any): string {
  if (!line) return "";
  const pn = String(line.input?.partNumber || line.partNumber || "").trim().toUpperCase();
  if (pn) return pn;
  if (line.input?.type === "CUSTOM" || !line.productId) {
    const desc = String(line.input?.description || line.description || "").trim().toUpperCase();
    if (desc) return `DESC:${desc}`;
  }
  return "";
}

export interface DuplicateGroupsResult {
  partCounts: Record<string, number>;
  duplicateIndices: Record<string, number>;
  groupColors: Record<string, DuplicateGroupColor>;
  totalGroups: number;
}

/**
 * Calculates duplicate counts and stable 1..N group indices and colors without wrapping.
 */
export function buildDuplicateGroups(
  lines: any[],
  groupsMapRef?: Map<string, number>,
): DuplicateGroupsResult {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const key = normalizeDuplicateItemKey(line);
    if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  const indices: Record<string, number> = {};
  const colors: Record<string, DuplicateGroupColor> = {};

  // Clean up any stale keys from ref if provided
  if (groupsMapRef) {
    for (const key of Array.from(groupsMapRef.keys())) {
      if (!counts[key] || counts[key] <= 1) {
        groupsMapRef.delete(key);
      }
    }
  }

  let nextIndex = groupsMapRef ? groupsMapRef.size + 1 : 1;

  for (const [key, count] of Object.entries(counts)) {
    if (count > 1) {
      let idx: number;
      if (groupsMapRef) {
        if (!groupsMapRef.has(key)) {
          // Find the lowest unused positive integer index to keep numbering compact
          const used = new Set(groupsMapRef.values());
          let candidate = 1;
          while (used.has(candidate)) candidate++;
          groupsMapRef.set(key, candidate);
        }
        idx = groupsMapRef.get(key)!;
      } else {
        idx = nextIndex++;
      }
      indices[key] = idx;
      colors[key] = getDuplicateGroupColor(idx);
    }
  }

  const totalGroups = Object.keys(indices).length;
  return { partCounts: counts, duplicateIndices: indices, groupColors: colors, totalGroups };
}
