export function importedDeliveryMeta(line: any) {
  if (line?.input?.importMeta?.source === "DELIVERY_NOTE") return line.input.importMeta;
  if (line?.importMeta?.source === "DELIVERY_NOTE") return line.importMeta;
  return null;
}

export function extractActiveDeliveryNotes(lines: any[] = []) {
  const docNosSet = new Set<string>();
  const docNos: string[] = [];
  const datesSet = new Set<string>();
  const dates: string[] = [];

  for (const line of lines) {
    const meta = importedDeliveryMeta(line);
    if (!meta) continue;
    const docNo = String(meta.docNo ?? "").trim();
    if (docNo && !docNosSet.has(docNo)) {
      docNosSet.add(docNo);
      docNos.push(docNo);
    }
    const docDate = String(meta.docDate ?? "").trim();
    if (docDate && !datesSet.has(docDate)) {
      datesSet.add(docDate);
      dates.push(docDate);
    }
  }

  return { docNos, dates };
}

export function syncQuotationReference(
  currentRef: string | undefined | null,
  activeDocNos: string[],
): string {
  const raw = String(currentRef ?? "").trim();
  const hasDn = /Delivery notes:\s*[^·;\n|]*/i.test(raw);

  if (activeDocNos.length > 0) {
    const clause = `Delivery notes: ${activeDocNos.join(", ")}`;
    if (hasDn) {
      return raw.replace(/Delivery notes:\s*[^·;\n|]*/i, clause).trim();
    }
    if (!raw) {
      return clause;
    }
    return raw;
  }

  // activeDocNos.length === 0
  if (!hasDn) {
    return raw;
  }

  let cleaned = raw.replace(/Delivery notes:\s*[^·;\n|]*/i, "").trim();
  cleaned = cleaned
    .replace(/^[\s·,;\-|]+/, "")
    .replace(/[\s·,;\-|]+$/, "")
    .replace(/\s*[·,;\-|]\s*[·,;\-|]\s*/g, " · ")
    .trim();

  return cleaned;
}

export function stripDeliveryNotesFromReference(
  currentRef: string | undefined | null,
): string {
  return syncQuotationReference(currentRef, []);
}

export function syncQuotationNotes(
  currentNotes: string | undefined | null,
  activeDocNos: string[],
  activeDates: string[],
): string {
  const raw = String(currentNotes ?? "");
  const lines = raw.split(/\r?\n/);

  const isDnLine = (l: string) =>
    /^\s*(?:Imported from delivery notes:|Delivery dates:)/i.test(l);

  const otherLines: string[] = [];

  for (const line of lines) {
    if (!isDnLine(line)) {
      otherLines.push(line);
    }
  }

  while (otherLines.length > 0 && !otherLines[0].trim()) {
    otherLines.shift();
  }
  while (otherLines.length > 0 && !otherLines[otherLines.length - 1].trim()) {
    otherLines.pop();
  }

  if (activeDocNos.length > 0) {
    const dnParts: string[] = [];
    if (activeDates.length > 0) {
      dnParts.push(`Delivery dates: ${activeDates.join(", ")}`);
    }
    dnParts.push(`Imported from delivery notes: ${activeDocNos.join(", ")}`);

    if (otherLines.length > 0) {
      return [...otherLines, ...dnParts].join("\n");
    }
    return dnParts.join("\n");
  }

  return otherLines.join("\n");
}

export function syncQuotationDeliveryMeta(lines: any[], customer: any) {
  const safeCustomer = customer || {};
  const { docNos, dates } = extractActiveDeliveryNotes(lines || []);

  const newRef = syncQuotationReference(safeCustomer.reference, docNos);
  const newNotes = syncQuotationNotes(safeCustomer.notes, docNos, dates);

  if (newRef === (safeCustomer.reference || "") && newNotes === (safeCustomer.notes || "")) {
    return safeCustomer;
  }

  return {
    ...safeCustomer,
    reference: newRef,
    notes: newNotes,
  };
}
