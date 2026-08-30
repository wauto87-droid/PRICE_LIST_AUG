const cleanPart = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .-]+|[ .-]+$/g, "")
    .slice(0, 100);

const encode5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export function quotationPdfFilename(quote: any) {
  const number = cleanPart(quote?.number) || "quotation";
  const rawCustomer = cleanPart(quote?.customer?.name);
  const customer =
    rawCustomer && rawCustomer.toLocaleLowerCase("en") !== "walk-in customer"
      ? rawCustomer
      : "";
  return `${number}${customer ? ` - ${customer}` : ""}.pdf`;
}

export function quotationPdfDisposition(quote: any) {
  const filename = quotationPdfFilename(quote);
  const fallback = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encode5987(filename)}`;
}
