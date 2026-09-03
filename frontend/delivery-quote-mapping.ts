export type DeliveryQuoteMapping = {
  date: string;
  docNo: string;
  customerName: string;
  customerCode: string;
  partNumber: string;
  description: string;
  quantity: string;
  price: string;
};

const normalizeHeader = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const autoMap = (columns: string[], names: string[]) =>
  names
    .map((name) =>
      columns.find((column) => normalizeHeader(column) === name),
    )
    .find(Boolean) || "";

export function deliveryQuoteMappingDefaults(
  columns: string[],
  saved: Partial<DeliveryQuoteMapping> = {},
): DeliveryQuoteMapping {
  const isDnnLayout = ["custname", "itemcode", "itemname", "balance"].every(
    (header) => columns.some((column) => normalizeHeader(column) === header),
  );
  return {
    date: saved.date || autoMap(columns, ["date", "docdate"]),
    docNo:
      saved.docNo || autoMap(columns, ["deliveryno", "documentno", "docno"]),
    customerName:
      saved.customerName ||
      autoMap(columns, ["custname", "customername", "customer", "partyname"]),
    customerCode:
      saved.customerCode ||
      autoMap(columns, ["customercode", "customerno", "customernumber", "custcode", "custno", "partycode", "accountcode"]),
    partNumber:
      saved.partNumber ||
      autoMap(columns, ["item", "partnumber", "partreference", "itemcode"]),
    description:
      saved.description ||
      autoMap(columns, ["description", "desc", "itemdescription", "itemname"]),
    quantity:
      saved.quantity ||
      autoMap(columns, isDnnLayout ? ["balance"] : ["qty", "quantity"]),
    price: saved.price || autoMap(columns, ["price", "unitprice", "rate", "amount"]),
  };
}
