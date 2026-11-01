// Editor-only identities: never added to quotation inputs or save payloads.
export class QuotationRowIdentity {
  private previous: { line: any; id: string }[] = [];
  private sequence = 0;
  private document = '';

  sync(lines: any[], document: string): string[] {
    if (document !== this.document) { this.previous = []; this.document = document; }
    const unused = new Set(this.previous.map(row => row.id));
    const matched = lines.map(line => {
      const row = this.previous.find(row => row.line === line && unused.has(row.id));
      if (row) unused.delete(row.id);
      return row?.id;
    });
    const next = lines.map((line, index) => {
      // Input/repricing edits replace an object at its existing position.
      const prior = this.previous[index];
      const id = matched[index] || (prior && unused.has(prior.id) ? prior.id : `quotation-row-${++this.sequence}`);
      unused.delete(id);
      return { line, id };
    });
    this.previous = next;
    return next.map(row => row.id);
  }
}

export function reorderQuotationRows<T>(rows: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}
