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
  const reference = String(customer.reference ?? "").startsWith("Delivery notes: ") ? generated("Delivery notes: ", numbers) : customer.reference;
  return { ...customer, reference, notes };
}
