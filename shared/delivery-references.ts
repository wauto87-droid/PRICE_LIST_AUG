/** Customer reference stays within its existing limit; full sources remain in notes and row metadata. */
export function deliveryReference(numbers: string[]): string {
  const values = [...new Set(numbers.map(value => String(value).trim()).filter(Boolean))];
  const prefix = "Delivery notes: ";
  if (!values.length) return "";
  const full = prefix + values.join(", ");
  if (full.length <= 200) return full;
  const shown: string[] = [];
  for (const value of values) {
    const candidate = [...shown, value];
    const suffix = ` +${values.length - candidate.length} more (see notes)`;
    if ((prefix + candidate.join(", ") + suffix).length > 200) break;
    shown.push(value);
  }
  return shown.length ? prefix + shown.join(", ") + ` +${values.length - shown.length} more (see notes)`
    : prefix + values.length + " reference(s) (see notes)";
}

const meta = (line: any) => line?.input?.importMeta ?? line?.importMeta;
export function deliveryCustomerReferences<T extends { reference?: string; notes?: string }>(customer: T, lines: any[], previous: any[] = lines): T {
  if (![...lines, ...previous].some(line => meta(line)?.source === "DELIVERY_NOTE")) return customer;
  const imported = lines.map(meta).filter(value => value?.source === "DELIVERY_NOTE");
  const unique = (key: string) => [...new Set(imported.map(value => String(value[key] ?? "").trim()).filter(Boolean))].join(", ");
  const numbers = unique("docNo"), dates = unique("docDate");
  const generated = (prefix: string, value: string) => value ? prefix + value : "";
  const notes = String(customer.notes ?? "").split("\n").flatMap(line => {
    if (line.startsWith("Imported from delivery notes: ")) return generated("Imported from delivery notes: ", numbers) || [];
    if (line.startsWith("Delivery dates: ")) return generated("Delivery dates: ", dates) || [];
    return line;
  }).join("\n");
  const reference = String(customer.reference ?? "").startsWith("Delivery notes: ") ? deliveryReference(imported.map(value => String(value.docNo ?? ""))) : customer.reference;
  return { ...customer, reference, notes };
}
