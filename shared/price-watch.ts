export type WatchColumn = {
  key: string;
  en: string;
  ar: string;
  kind?: "number" | "date" | "percent";
};
export const activityColumns: WatchColumn[] = [
  {
    key: "last_seen_at",
    en: "Date / time",
    ar: "التاريخ والوقت",
    kind: "date",
  },
  { key: "part_number", en: "Reference", ar: "المرجع" },
  { key: "description", en: "Description", ar: "الوصف" },
  { key: "staff_name", en: "Staff", ar: "الموظف" },
  { key: "stage", en: "Stage", ar: "المرحلة" },
  { key: "source", en: "Source", ar: "المصدر" },
  { key: "selling_level", en: "Selling level", ar: "مستوى البيع" },
  { key: "customer_name", en: "Customer", ar: "العميل" },
  { key: "quantity", en: "Qty", ar: "الكمية", kind: "number" },
  {
    key: "final_excl",
    en: "Unit price excl. VAT",
    ar: "سعر الوحدة دون ضريبة",
    kind: "number",
  },
  {
    key: "effective_discount",
    en: "Discount %",
    ar: "الخصم %",
    kind: "percent",
  },
  { key: "effective_markup", en: "Markup %", ar: "الزيادة %", kind: "percent" },
  {
    key: "subtotal",
    en: "Activity value excl. VAT",
    ar: "قيمة النشاط دون ضريبة",
    kind: "number",
  },
  { key: "quotation_number", en: "Quotation", ar: "عرض السعر" },
  { key: "evidence", en: "Evidence", ar: "الدليل" },
];
// Keep the main screen readable. The complete record remains in Details.
export const activitySummaryColumns: WatchColumn[] = [
  { key: "last_seen_at", en: "When", ar: "الوقت", kind: "date" },
  { key: "part_number", en: "Item", ar: "الصنف" },
  { key: "staff_name", en: "Staff", ar: "الموظف" },
  { key: "stage", en: "Activity", ar: "النشاط" },
  { key: "quantity", en: "Qty", ar: "الكمية", kind: "number" },
  { key: "final_excl", en: "Unit price", ar: "سعر الوحدة", kind: "number" },
  { key: "effective_discount", en: "Discount", ar: "الخصم", kind: "percent" },
  { key: "subtotal", en: "Value", ar: "القيمة", kind: "number" },
];
export const groupColumns: WatchColumn[] = [
  { key: "latest_at", en: "Latest activity", ar: "أحدث نشاط", kind: "date" },
  ...activityColumns.filter((c) =>
    ["part_number", "description", "staff_name"].includes(c.key),
  ),
  { key: "events", en: "Count", ar: "العدد", kind: "number" },
  activityColumns.find((c) => c.key === "quantity")!,
  ...[
    ["weighted_average", "Weighted avg.", "المتوسط الموزون"],
    ["median", "Median", "الوسيط"],
    ["minimum", "Minimum", "الأدنى"],
    ["maximum", "Maximum", "الأعلى"],
    ["latest", "Latest price", "أحدث سعر"],
  ].map(([key, en, ar]) => ({ key, en, ar, kind: "number" as const })),
  {
    key: "weighted_discount",
    en: "Weighted discount %",
    ar: "الخصم الموزون %",
    kind: "percent",
  },
  {
    key: "zero_price_events",
    en: "Zero-price flags",
    ar: "تنبيهات السعر الصفري",
    kind: "number",
  },
];
export const groupSummaryColumns: WatchColumn[] = [
  { key: "latest_at", en: "Latest", ar: "الأحدث", kind: "date" },
  { key: "part_number", en: "Item", ar: "الصنف" },
  { key: "staff_name", en: "Staff", ar: "الموظف" },
  { key: "events", en: "Activity", ar: "النشاط", kind: "number" },
  { key: "quantity", en: "Qty", ar: "الكمية", kind: "number" },
  { key: "latest", en: "Latest price", ar: "أحدث سعر", kind: "number" },
  { key: "weighted_discount", en: "Discount", ar: "الخصم", kind: "percent" },
];
export const staffColumns: WatchColumn[] = [
  { key: "staff_name", en: "Staff", ar: "الموظف" },
  ...[
    ["events", "Activity", "النشاط"],
    ["items", "Items", "الأصناف"],
    ["quotations", "Quotations", "العروض"],
    ["subtotal", "Activity value", "قيمة النشاط"],
  ].map(([key, en, ar]) => ({ key, en, ar, kind: "number" as const })),
  {
    key: "weighted_discount",
    en: "Weighted discount %",
    ar: "الخصم الموزون %",
    kind: "percent",
  },
  {
    key: "high_discount_events",
    en: "High-discount flags",
    ar: "تنبيهات الخصم العالي",
    kind: "number",
  },
];
export const staffSummaryColumns: WatchColumn[] = [
  { key: "staff_name", en: "Staff", ar: "الموظف" },
  { key: "events", en: "Activity", ar: "النشاط", kind: "number" },
  { key: "items", en: "Items", ar: "الأصناف", kind: "number" },
  { key: "subtotal", en: "Value", ar: "القيمة", kind: "number" },
  { key: "weighted_discount", en: "Discount", ar: "الخصم", kind: "percent" },
];
export const personalColumns = activityColumns.filter(
  (c) =>
    ![
      "staff_name",
      "customer_name",
      "quotation_number",
      "source",
      "stage",
    ].includes(c.key),
);
export function watchValue(value: unknown, kind?: WatchColumn["kind"]) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "date")
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Riyadh",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(String(value)));
  if (kind === "number" || kind === "percent")
    return (
      Number(value).toLocaleString("en", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + (kind === "percent" ? "%" : "")
    );
  return String(value);
}
