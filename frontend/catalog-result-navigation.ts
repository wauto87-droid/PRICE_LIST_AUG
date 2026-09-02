export function nextCatalogResultHighlight(
  current: number,
  total: number,
  key: string,
  pageSize = 5,
) {
  if (total < 1) return 0;
  const last = total - 1;
  if (key === "ArrowDown") return (current + 1) % total;
  if (key === "ArrowUp") return (current - 1 + total) % total;
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (key === "PageDown") return Math.min(current + pageSize, last);
  if (key === "PageUp") return Math.max(current - pageSize, 0);
  return current;
}
