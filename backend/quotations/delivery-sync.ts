import { formatDeliveryDateDisplay } from "../pricing/normalize";

export function importedDeliveryMeta(line: any) {
  if (line?.input?.importMeta?.source === "DELIVERY_NOTE") return line.input.importMeta;
  if (line?.importMeta?.source === "DELIVERY_NOTE") return line.importMeta;
  return null;
}

export function parseDeliveryDocNoNumber(docNo: unknown): number | null {
  if (docNo === null || docNo === undefined) return null;
  const str = String(docNo).trim();
  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num)) return num;
  }
  return null;
}

export function compareDeliveryNotes(aMeta: any, bMeta: any): number {
  if (!aMeta && !bMeta) return 0;
  if (!aMeta) return 1;
  if (!bMeta) return -1;

  const aDocNo = String(aMeta.docNo ?? "").trim();
  const bDocNo = String(bMeta.docNo ?? "").trim();

  const aNum = parseDeliveryDocNoNumber(aDocNo);
  const bNum = parseDeliveryDocNoNumber(bDocNo);

  if (aNum !== null && bNum !== null && aNum !== bNum) {
    return aNum - bNum;
  }
  if (aDocNo !== bDocNo) {
    return aDocNo.localeCompare(bDocNo, undefined, { numeric: true, sensitivity: "base" });
  }

  // Same DN number: compare dates ascending (oldest to newest)
  const aDate = String(aMeta.docDate ?? "").trim();
  const bDate = String(bMeta.docDate ?? "").trim();
  if (aDate && bDate && aDate !== bDate) {
    return aDate.localeCompare(bDate);
  }

  // Same date: compare row numbers
  const aRow = Number(aMeta.rowNumber ?? 0);
  const bRow = Number(bMeta.rowNumber ?? 0);
  return aRow - bRow;
}

export function sortLinesByDeliveryNote<T = any>(lines: T[]): T[] {
  return [...lines].sort((a: any, b: any) => {
    const aMeta = importedDeliveryMeta(a);
    const bMeta = importedDeliveryMeta(b);
    return compareDeliveryNotes(aMeta, bMeta);
  });
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

  docNos.sort((a, b) => {
    const an = parseDeliveryDocNoNumber(a);
    const bn = parseDeliveryDocNoNumber(b);
    if (an !== null && bn !== null && an !== bn) return an - bn;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  });

  return { docNos, dates };
}

export function formatDeliveryReference(docNos: string[], maxLen = 200): string {
  if (!docNos.length) return "";
  const full = `Delivery notes: ${docNos.join(", ")}`;
  if (full.length <= maxLen) return full;
  for (let count = docNos.length - 1; count >= 1; count--) {
    const remaining = docNos.length - count;
    const candidate = `Delivery notes: ${docNos.slice(0, count).join(", ")} (+${remaining} more)`;
    if (candidate.length <= maxLen) return candidate;
  }
  const fallback = `Delivery notes: ${docNos.length} delivery notes`;
  return fallback.length <= maxLen ? fallback : fallback.slice(0, maxLen);
}

export function formatDeliveryNotes(dates: string[], docNos: string[], maxLen = 1000): string {
  const parts: string[] = [];
  if (dates.length) {
    const formattedDates = dates.map((d) => formatDeliveryDateDisplay(d));
    const datesFull = `Delivery dates: ${formattedDates.join(", ")}`;
    if (datesFull.length <= 250) {
      parts.push(datesFull);
    } else {
      parts.push(`Delivery dates: ${formattedDates[0]} to ${formattedDates[formattedDates.length - 1]} (${formattedDates.length} dates)`);
    }
  }
  if (docNos.length) {
    const remainingBudget = Math.max(100, maxLen - parts.join("\n").length - 50);
    const docFull = `Imported from delivery notes: ${docNos.join(", ")}`;
    if (docFull.length <= remainingBudget) {
      parts.push(docFull);
    } else {
      let added = false;
      for (let count = docNos.length - 1; count >= 1; count--) {
        const remaining = docNos.length - count;
        const candidate = `Imported from delivery notes: ${docNos.slice(0, count).join(", ")} (+${remaining} more)`;
        if (candidate.length <= remainingBudget) {
          parts.push(candidate);
          added = true;
          break;
        }
      }
      if (!added) {
        parts.push(`Imported from ${docNos.length} delivery notes`);
      }
    }
  }
  return parts.join("\n");
}

export function syncQuotationReference(
  currentRef: string | undefined | null,
  activeDocNos: string[],
  maxLen = 200,
): string {
  const raw = String(currentRef ?? "").trim();
  const hasDn = /Delivery notes:\s*[^·;\n|]*/i.test(raw);

  if (activeDocNos.length > 0) {
    let budget = maxLen;
    if (hasDn) {
      const nonDnPart = raw.replace(/Delivery notes:\s*[^·;\n|]*/i, "").replace(/^[\s·,;\-|]+/, "").replace(/[\s·,;\-|]+$/, "").trim();
      if (nonDnPart) {
        budget = Math.max(50, maxLen - nonDnPart.length - 3);
      }
    } else if (raw) {
      budget = Math.max(50, maxLen - raw.length - 3);
    }
    const clause = formatDeliveryReference(activeDocNos, budget);
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
  maxLen = 1000,
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
    const otherText = otherLines.join("\n");
    const budget = Math.max(200, maxLen - (otherText ? otherText.length + 1 : 0));
    const dnText = formatDeliveryNotes(activeDates, activeDocNos, budget);

    if (otherLines.length > 0) {
      return `${otherText}\n${dnText}`;
    }
    return dnText;
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
