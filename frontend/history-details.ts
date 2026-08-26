import Decimal from "decimal.js";
import { productInput, sellingLevels, levelPrice } from "../backend/pricing/engine";
import { levelCodes, levelLabel } from "./levels";
import type { Translate } from "./api";

const actions: Record<string, [string, string]> = {
  PRODUCT_CREATE: ["Product added", "تمت إضافة صنف"], PRODUCT_EDIT: ["Product updated", "تم تحديث الصنف"],
  PRODUCT_ARCHIVE: ["Product archived", "تمت أرشفة الصنف"], PRODUCT_REACTIVATE: ["Product reactivated", "تمت إعادة تفعيل الصنف"],
  PRICE_CHANGE: ["Pricing updated", "تم تحديث الأسعار"], MIN_PRICE_CHANGE: ["Minimum price updated", "تم تحديث الحد الأدنى للسعر"],
  DRAFT_CREATE: ["Draft quotation created", "تم إنشاء مسودة عرض سعر"], DRAFT_EDIT: ["Draft quotation updated", "تم تحديث مسودة عرض السعر"],
  QUOTATION_ISSUE: ["Quotation issued", "تم إصدار عرض السعر"], QUOTATION_DELETE: ["Draft quotation deleted", "تم حذف المسودة"],
  MIN_PRICE_OVERRIDE: ["Below-minimum price approved", "تم اعتماد سعر أقل من الحد الأدنى"],
  EXCEL_UPLOAD: ["Spreadsheet uploaded", "تم رفع جدول أسعار"], PDF_UPLOAD: ["PDF uploaded", "تم رفع ملف PDF"],
  EXCEL_IMPORT: ["Spreadsheet import completed", "اكتمل استيراد جدول الأسعار"], PDF_IMPORT: ["PDF import completed", "اكتمل استيراد ملف PDF"],
  IMPORT_ROLLBACK: ["Import changes reversed", "تم التراجع عن تغييرات الاستيراد"],
  USER_CREATE: ["User added", "تمت إضافة مستخدم"], USER_CHANGE: ["User account updated", "تم تحديث حساب المستخدم"],
  PERMISSION_CHANGE: ["Role permissions updated", "تم تحديث صلاحيات الدور"], TAXONOMY_CHANGE: ["Brand or category updated", "تم تحديث العلامة أو الفئة"],
  SETTINGS_CHANGE: ["Company settings updated", "تم تحديث إعدادات الشركة"], BACKUP_REQUEST: ["Backup requested", "تم طلب نسخة احتياطية"],
  LOGIN: ["Signed in", "تم تسجيل الدخول"], SETUP: ["Company setup completed", "اكتمل إعداد الشركة"],
};
const sources: Record<string, [string,string]> = { MANUAL: ["Manual edit", "تعديل يدوي"], BULK: ["Bulk pricing update", "تحديث أسعار جماعي"], IMPORT: ["Imported from a file", "مستورد من ملف"], ROLLBACK: ["Import changes reversed", "تراجع عن الاستيراد"] };
const fields: Record<string, [string,string]> = {
  partNumber: ["Part number", "رقم الصنف"], description: ["Description", "الوصف"], brand: ["Brand", "العلامة التجارية"], category: ["Category", "الفئة"],
  cost: ["Purchase cost", "تكلفة الشراء"], vat: ["VAT rate", "نسبة الضريبة"], unit: ["Unit", "الوحدة"], active: ["Status", "الحالة"],
  minimumEnabled: ["Minimum price protection", "حماية الحد الأدنى للسعر"], enabled: ["Minimum price protection", "حماية الحد الأدنى للسعر"], minimum: ["Minimum price before VAT", "الحد الأدنى قبل الضريبة"],
  defaultLevel: ["Default selling price", "سعر البيع الافتراضي"], aliases: ["Alternative part numbers", "أرقام الأصناف البديلة"], keywords: ["Search keywords", "كلمات البحث"], quantityPrecision: ["Quantity precision", "دقة الكمية"],
  name: ["Name", "الاسم"], username: ["Username", "اسم المستخدم"], disabled: ["Account disabled", "الحساب معطل"], role: ["Role", "الدور"], role_id: ["Role", "الدور"], maxDiscount: ["Maximum discount", "أقصى خصم"], max_discount: ["Maximum discount", "أقصى خصم"],
  permissions: ["Permissions", "الصلاحيات"], companyName: ["Company name", "اسم الشركة"], companyArabic: ["Arabic company name", "اسم الشركة بالعربية"], currency: ["Currency", "العملة"],
  draftPrefix: ["Draft number prefix", "بادئة رقم المسودة"], quotePrefix: ["Quotation number prefix", "بادئة رقم العرض"], staffDiscount: ["Staff discount limit", "حد خصم الموظفين"],
  minimumVisible: ["Show minimum prices to staff", "إظهار الحد الأدنى للموظفين"], showMaxDiscount: ["Show discount limits", "إظهار حدود الخصم"], allowOfflineCache: ["Allow offline price reference", "السماح بعرض الأسعار دون اتصال"], pdfUnitPrices: ["Prices shown on PDFs", "الأسعار المعروضة في PDF"], backupRetentionDays: ["Backup retention days", "أيام الاحتفاظ بالنسخ الاحتياطية"],
  new: ["Products added", "أصناف مضافة"], updated: ["Products updated", "أصناف محدثة"], skipped: ["Rows skipped", "صفوف متخطاة"], price: ["Approved price before VAT", "السعر المعتمد قبل الضريبة"],
};
const permissions: Record<string, [string,string]> = {
  PRODUCT_VIEW: ["View products", "عرض الأصناف"], PRODUCT_CREATE: ["Add products", "إضافة أصناف"], PRODUCT_EDIT: ["Edit products", "تعديل الأصناف"], COST_VIEW: ["View purchase costs", "عرض تكاليف الشراء"], MIN_PRICE_VIEW: ["View minimum prices", "عرض الحد الأدنى"], PRICE_HISTORY_VIEW: ["View price history", "عرض سجل الأسعار"],
  QUOTE_CREATE: ["Create quotations", "إنشاء عروض"], QUOTE_EDIT: ["Edit quotations", "تعديل عروض"], QUOTE_DELETE: ["Delete drafts", "حذف مسودات"], QUOTE_ISSUE: ["Issue quotations", "إصدار عروض"], QUOTE_VIEW_ALL: ["View all quotations", "عرض جميع العروض"], QUOTE_EDIT_ALL: ["Edit all drafts", "تعديل جميع المسودات"], OVERRIDE_MINIMUM_PRICE: ["Approve below-minimum prices", "اعتماد أسعار أقل من الحد الأدنى"],
  IMPORT_EXCEL: ["Upload spreadsheets", "رفع جداول"], IMPORT_PDF: ["Upload PDF files", "رفع ملفات PDF"], IMPORT_CONFIRM: ["Confirm imports", "تأكيد الاستيراد"], USER_MANAGE: ["Manage users", "إدارة المستخدمين"], BACKUP_MANAGE: ["Manage backups", "إدارة النسخ الاحتياطية"], SETTINGS_MANAGE: ["Manage settings", "إدارة الإعدادات"], AUDIT_VIEW: ["View activity log", "عرض سجل النشاط"], ADMIN_VIEW: ["Open administration", "فتح الإدارة"], EXPORT: ["Export spreadsheets", "تصدير الجداول"],
};
const object = (v: any): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const money = (v: unknown) => { try { return "SAR " + new Decimal(String(v)).toFixed(2); } catch { return "—"; } };
const number = (v: unknown) => { try { return new Decimal(String(v)).toString(); } catch { return String(v); } };
function value(key: string, v: any, t: Translate): string {
  if (v === undefined || v === null || v === "") return t("Not set", "غير محدد");
  if (key === "active") return v ? t("Active", "نشط") : t("Archived", "مؤرشف");
  if (typeof v === "boolean") return v ? t("Enabled", "مفعّل") : t("Disabled", "غير مفعّل");
  if (["cost", "minimum", "price"].includes(key)) return money(v);
  if (["vat", "maxDiscount", "max_discount", "staffDiscount"].includes(key)) return number(v) + "%";
  if (key === "defaultLevel") return levelLabel(v, t);
  if (key === "quantityPrecision") return Number(v) === 0 ? t("Whole quantities only", "كميات صحيحة فقط") : `${v} ${t("decimal places", "منازل عشرية")}`;
  if (key === "pdfUnitPrices") return v === "BOTH" ? t("Before and including VAT", "قبل الضريبة وشامل الضريبة") : v === "EXCL" ? t("Before VAT", "قبل الضريبة") : t("Including VAT", "شامل الضريبة");
  if (key === "role" || key === "role_id") return v === "ADMIN" ? t("Administrator", "مدير") : v === "STAFF" ? t("Staff", "موظف") : v;
  if (Array.isArray(v)) return v.map(x => key === "permissions" ? (permissions[x] ? t(...permissions[x]) : t("Other permission", "صلاحية أخرى")) : String(x)).join(t(", ", "، ")) || t("None", "لا يوجد");
  return typeof v === "object" ? t("Updated", "تم التحديث") : String(v);
}
function productValues(raw: any, t: Translate) {
  const parsed = productInput.safeParse(raw);
  if (!parsed.success) return [];
  const p = parsed.data;
  return sellingLevels(p).map(l => ({ code: l.code, active: l.active, price: money(levelPrice(p,l)),
    formula: l.method === "FIXED" ? t("Fixed selling price", "سعر بيع ثابت") : l.method === "COST_MARKUP" ? `${t("Purchase cost +", "تكلفة الشراء +")} ${number(l.markup)}%` : `${t("List price", "سعر القائمة")} ${money(l.listPrice)} − ${number(l.baseDiscount)}%` }));
}
export function describeHistory(row: any, t: Translate) {
  const before = object(row.before_value), after = object(row.after_value);
  const action = row.action ?? (row.source === "ROLLBACK" ? "IMPORT_ROLLBACK" : row.before_value ? "PRICE_CHANGE" : "PRODUCT_CREATE");
  const title = actions[action] ? t(...actions[action]) : t("Activity recorded", "تم تسجيل النشاط");
  const changes: { label: string; before: string; after: string }[] = [];
  const created = row.before_value == null;
  for (const [key, labels] of Object.entries(fields)) {
    if (!(key in before) && !(key in after)) continue;
    if (created && (after[key] == null || after[key] === "" || (Array.isArray(after[key]) && !after[key].length))) continue;
    const old = value(key, before[key], t), next = value(key, after[key], t);
    if (created || old !== next) changes.push({ label: t(...labels), before: created ? "—" : old, after: next });
  }
  const previous = productValues(row.before_value,t), current = productValues(row.after_value,t);
  for (const code of levelCodes) {
    const old = previous.find(l => l.code === code), next = current.find(l => l.code === code);
    if (!old && !next) continue;
    const price = (l: typeof old) => !l ? t("Not available", "غير متاح") : !l.active ? t("Not available to staff", "غير متاح للموظفين") : l.price;
    if (!old || price(old) !== price(next)) changes.push({ label: `${levelLabel(code,t)} · ${t("before VAT", "قبل الضريبة")}`, before: created ? "—" : price(old), after: price(next) });
    if (next && (!old || old.formula !== next.formula)) changes.push({ label: `${levelLabel(code,t)} · ${t("price calculation", "حساب السعر")}`, before: old?.formula ?? "—", after: next.formula });
  }
  const highlights = current.filter(l => l.active).map(l => `${levelLabel(l.code,t)}: ${l.price}`);
  if (current.length) highlights.push(`${t("Default", "الافتراضي")}: ${levelLabel(after.defaultLevel ?? "END_CUSTOMER",t)}`);
  return { title, subject: after.partNumber || before.partNumber || row.part_number || after.name || after.username || "",
    description: after.description || before.description || "",
    source: sources[row.source] ? t(...sources[row.source]) : "", created, changes, highlights,
    reason: typeof row.reason === "string" ? row.reason : "" };
}
