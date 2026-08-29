export function importSummaryLines(summary: any, status: string) {
  if (!summary || typeof summary !== "object") return ["No summary"];

  if (["AWAITING_REVIEW", "UPLOADED", "PROCESSING", "CONFIRMED"].includes(status)) {
    const rows = Number(summary.rows ?? 0);
    const columns = Array.isArray(summary.columns) ? summary.columns : [];
    const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
    const lines = [
      `${rows.toLocaleString()} rows`,
      `${columns.length.toLocaleString()} columns`,
      `${warnings.length.toLocaleString()} warnings`,
    ];
    if (rows === 0) lines.unshift("0 rows");
    return lines;
  }

  if (["IMPORTED", "ROLLED_BACK"].includes(status)) {
    const created = Number(summary.new ?? 0);
    const updated = Number(summary.updated ?? 0);
    const skipped = Number(summary.skipped ?? 0);
    const lines = [
      `${created.toLocaleString()} new`,
      `${updated.toLocaleString()} updated`,
      `${skipped.toLocaleString()} skipped`,
    ];
    if (status === "ROLLED_BACK") lines.push("Rolled back");
    return lines;
  }

  return Object.entries(summary).map(([key, value]) => `${key}: ${String(value)}`);
}

export function importSummaryDetails(summary: any) {
  if (!summary || typeof summary !== "object") return null;
  const columns = Array.isArray(summary.columns) ? summary.columns : [];
  const warnings = Array.isArray(summary.warnings) ? summary.warnings : [];
  if (!columns.length && !warnings.length) return null;
  return {
    columns,
    warnings,
  };
}
