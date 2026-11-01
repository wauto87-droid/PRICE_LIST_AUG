"use client";

export type PermissionMeta = {
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  highlight?: boolean;
};

export const PERMISSION_METADATA: Record<string, PermissionMeta> = {
  QUOTE_PRICE_HISTORY: {
    nameEn: "Recent Quotation Prices (F10) & Customer History",
    nameAr: "الأسعار السابقة لعروض الأسعار (اختصار F10) وسجل العميل",
    descEn:
      "Enables viewing recent quotation pricing history via the F10 button and shortcut in the quotation cart, and using customer previous prices.",
    descAr:
      "يتيح زر واختصار F10 لعرض الأسعار السابقة للصنف في سلة عروض الأسعار، وتفعيل خيار استخدام الأسعار السابقة للعميل.",
    highlight: true,
  },
  PRODUCT_VIEW: {
    nameEn: "View Products",
    nameAr: "عرض الأصناف والكتالوج",
    descEn: "View catalog products, descriptions, and standard pricing levels.",
    descAr: "استعراض أصناف الكتالوج والأوصاف ومستويات الأسعار القياسية.",
  },
  PRODUCT_CREATE: {
    nameEn: "Create Products",
    nameAr: "إضافة أصناف جديدة",
    descEn: "Add new products to the catalog.",
    descAr: "إضافة أصناف جديدة إلى الكتالوج.",
  },
  PRODUCT_EDIT: {
    nameEn: "Edit Products",
    nameAr: "تعديل بيانات الأصناف",
    descEn: "Edit product details, categories, brands, and base prices.",
    descAr: "تعديل تفاصيل الصنف والفئات والعلامات التجارية والأسعار الأساسية.",
  },
  PRODUCT_DELETE: {
    nameEn: "Delete Products",
    nameAr: "حذف الأصناف",
    descEn: "Remove products from the catalog.",
    descAr: "حذف وإلغاء الأصناف من الكتالوج.",
  },
  COST_VIEW: {
    nameEn: "View Cost Prices",
    nameAr: "عرض سعر التكلفة",
    descEn: "View purchase cost in catalog and pricing calculations.",
    descAr: "عرض سعر تكلفة الشراء في الكتالوج وحسابات التسعير.",
  },
  MIN_PRICE_VIEW: {
    nameEn: "View Minimum Selling Prices",
    nameAr: "عرض الحد الأدنى لسعر البيع",
    descEn: "View minimum allowable selling prices.",
    descAr: "عرض الحد الأدنى المسموح به لسعر بيع الصنف.",
  },
  PRICE_HISTORY_VIEW: {
    nameEn: "View Price Adjustment History",
    nameAr: "عرض سجل تعديلات الأسعار",
    descEn: "View historical price adjustments and version changes.",
    descAr: "استعراض سجل التعديلات والتحديثات لأسعار الصنف عبر الوقت.",
  },
  QUOTE_CREATE: {
    nameEn: "Create Quotations",
    nameAr: "إنشاء عروض الأسعار",
    descEn: "Create new draft quotations for customers.",
    descAr: "إنشاء مسودات عروض أسعار جديدة للعملاء.",
  },
  QUOTE_EDIT: {
    nameEn: "Edit Own Quotations",
    nameAr: "تعديل عروض الأسعار الخاصة",
    descEn: "Modify lines, discounts, and customer details on own draft quotes.",
    descAr: "تعديل البنود والخصومات وبيانات العميل في عروض الأسعار الخاصة.",
  },
  QUOTE_DELETE: {
    nameEn: "Delete Quotations",
    nameAr: "حذف مسودات عروض الأسعار",
    descEn: "Delete own draft quotations.",
    descAr: "حذف مسودات عروض الأسعار الخاصة.",
  },
  QUOTE_ISSUE: {
    nameEn: "Issue Quotations",
    nameAr: "إصدار واعتماد عروض الأسعار",
    descEn: "Finalize and issue official quotations with PDF generation.",
    descAr: "إصدار واعتماد عروض الأسعار الرسمية وتوليد ملفات PDF.",
  },
  QUOTE_VIEW_ALL: {
    nameEn: "View All Staff Quotations",
    nameAr: "استعراض عروض أسعار كافة الموظفين",
    descEn: "View quotations created by other staff members.",
    descAr: "استعراض ومتابعة عروض الأسعار المنشأة من موظفي المبيعات الآخرين.",
  },
  QUOTE_EDIT_ALL: {
    nameEn: "Edit All Staff Quotations",
    nameAr: "تعديل عروض أسعار كافة الموظفين",
    descEn: "Edit or update quotations created by other staff members.",
    descAr: "تعديل وتحديث مسودات عروض الأسعار المنشأة من موظفين آخرين.",
  },
  OVERRIDE_MINIMUM_PRICE: {
    nameEn: "Override Minimum Price",
    nameAr: "تجاوز الحد الأدنى للبيع",
    descEn: "Permit selling below the calculated minimum price limit.",
    descAr: "السماح بالبيع والتسعير بأقل من الحد الأدنى المسموح به للصنف.",
  },
  IMPORT_EXCEL: {
    nameEn: "Import Excel Price Lists",
    nameAr: "استيراد قوائم أسعار إكسل",
    descEn: "Upload Excel sheets for catalog pricing and inventory.",
    descAr: "رفع واستيراد ملفات إكسل لتحديث الكتالوج والأسعار.",
  },
  IMPORT_PDF: {
    nameEn: "Import Quotations from PDF",
    nameAr: "استيراد عروض من ملفات PDF",
    descEn: "Extract quotation lines and products from PDF documents.",
    descAr: "استخراج بنود عروض الأسعار والأصناف من وثائق PDF.",
  },
  IMPORT_CONFIRM: {
    nameEn: "Confirm & Commit Imports",
    nameAr: "اعتماد وتطبيق الاستيراد",
    descEn: "Review and commit staged import batches into live catalog.",
    descAr: "مراجعة وتأكيد تطبيق دفعات الاستيراد إلى الكتالوج الحي.",
  },
  USER_MANAGE: {
    nameEn: "Manage Users & Roles",
    nameAr: "إدارة المستخدمين والأدوار",
    descEn: "Create users, reset passwords, and edit role permissions.",
    descAr: "إنشاء المستخدمين وتعيين كلمات المرور وتعديل صلاحيات الأدوار.",
  },
  BACKUP_MANAGE: {
    nameEn: "Manage Backups",
    nameAr: "إدارة النسخ الاحتياطي",
    descEn: "Create, download, and manage system database backups.",
    descAr: "إنشاء وتنزيل وإدارة النسخ الاحتياطية لقاعدة البيانات.",
  },
  SETTINGS_MANAGE: {
    nameEn: "Manage System Settings",
    nameAr: "إدارة إعدادات النظام",
    descEn: "Configure company details, currency, VAT, and system policies.",
    descAr: "ضبط بيانات المنشأة والعملة وضريبة القيمة المضافة وسياسات النظام.",
  },
  AUDIT_VIEW: {
    nameEn: "View Audit Log",
    nameAr: "سجل حركات وتدقيق النظام",
    descEn: "Inspect immutable audit logs of user actions and changes.",
    descAr: "استعراض سجل تدقيق العمليات وحركات وتعديلات المستخدمين.",
  },
  ADMIN_VIEW: {
    nameEn: "Admin Portal Access",
    nameAr: "الوصول إلى لوحة الإدارة",
    descEn: "Grants access to administrative portal and dashboard.",
    descAr: "إمكانية الدخول إلى لوحة التحكم والإدارة الرئيسية.",
  },
  EXPORT: {
    nameEn: "Export Catalog & Data",
    nameAr: "تصدير البيانات والكتالوج",
    descEn: "Export products, price lists, and reports to Excel.",
    descAr: "تصدير الأصناف وقوائم الأسعار والتقارير إلى ملفات Excel.",
  },
  SALES_PRICE_CHECK: {
    nameEn: "Sales Price Check Tool",
    nameAr: "أداة فحص وتدقيق الأسعار",
    descEn: "Compare line items and pricing against official price lists.",
    descAr: "فحص وتدقيق ومقارنة أسعار بنود العروض مع قوائم الأسعار الرسمية.",
  },
  QUANTITY_FINDER: {
    nameEn: "Quantity & Stock Finder",
    nameAr: "البحث عن الكميات والتوفر",
    descEn: "Search item stock across multiple branches and warehouses.",
    descAr: "الاستعلام عن كميات وتوفر الأصناف عبر الفروع والمستودعات.",
  },
  DN_TRACKER_VIEW: {
    nameEn: "View Delivery Notes",
    nameAr: "عرض سندات التسليم",
    descEn: "Track and view outgoing customer delivery notes.",
    descAr: "استعراض سندات التسليم ومتابعة حالتها.",
  },
  DN_TRACKER_EDIT: {
    nameEn: "Update Delivery Notes",
    nameAr: "تحديث سندات التسليم",
    descEn: "Update status, dispatch notes, and fulfillment progress.",
    descAr: "تحديث مراحل وسجلات تسليم البضائع وملاحظات الإرسال.",
  },
  DN_TRACKER_MANAGE: {
    nameEn: "Manage Delivery Notes",
    nameAr: "إدارة سندات التسليم بالكامل",
    descEn: "Full management and workflow control over delivery notes.",
    descAr: "تحكم كامل وإدارة متقدمة لمسارات سندات التسليم.",
  },
  REUSABLE_CUSTOM_MANAGE: {
    nameEn: "Manage Custom Items",
    nameAr: "إدارة الأصناف المخصصة",
    descEn: "Manage reusable custom item templates and default pricing.",
    descAr: "إدارة قوالب الأصناف المخصصة القابلة لإعادة الاستخدام وتسعيرها.",
  },
  PRICE_WATCHER: {
    nameEn: "Price Watcher & Discount Requests",
    nameAr: "مراقب الأسعار وطلبات الخصم",
    descEn: "Review price deviations, discount requests, and sales logs.",
    descAr: "متابعة انحرافات الأسعار وسجلات طلبات الخصم المقدمة للعملاء.",
  },
  AI_PRODUCT_ENRICH: {
    nameEn: "AI Catalog Enrichment",
    nameAr: "الإثراء الذكي للأصناف (AI)",
    descEn: "Use AI to normalize descriptions, brands, and search keywords.",
    descAr: "استخدام الذكاء الاصطناعي لتحسين وتوحيد أوصاف وكلمات البحث للأصناف.",
  },
  DELIVERY_ALIAS_MANAGE: {
    nameEn: "Manage Part Aliases",
    nameAr: "إدارة الأسماء البديلة للأصناف",
    descEn: "Add alternative part codes and delivery note aliases.",
    descAr: "إضافة وتعيين الأرقام والأسماء البديلة لأرقام الأصناف وسندات التسليم.",
  },
  QUOTE_TEMPLATE_MANAGE: {
    nameEn: "Quotation Templates",
    nameAr: "قوالب عروض الأسعار",
    descEn: "Create and publish shared quotation templates for staff.",
    descAr: "إنشاء وإدارة ونشر قوالب عروض الأسعار الجاهزة لموظفي المبيعات.",
  },
  COMMERCIAL_VIEW: {
    nameEn: "Commercial Platform",
    nameAr: "منصة عملاء الأعمال B2B",
    descEn: "View business portal accounts, RFQs, and commercial orders.",
    descAr: "استعراض حسابات عملاء الأعمال B2B والطلبات التجارية.",
  },
  QUOTE_APPROVE: {
    nameEn: "Approve Quotations & Discounts",
    nameAr: "اعتماد العروض وتجاوز الخصم",
    descEn: "Approve or reject discount approval requests beyond limits.",
    descAr: "اعتماد أو رفض طلبات الخصومات الاستثنائية التي تتجاوز حدود الموظف.",
  },
  SALES_ORDER_MANAGE: {
    nameEn: "Manage Sales Orders",
    nameAr: "إدارة أوامر البيع",
    descEn: "Process approved quotations into active sales orders.",
    descAr: "تحويل عروض الأسعار المعتمدة إلى أوامر بيع ومتابعة تنفيذها.",
  },
  INVENTORY_VIEW: {
    nameEn: "View Inventory Levels",
    nameAr: "عرض أرصدة المخزون",
    descEn: "Inspect available warehouse stock balances.",
    descAr: "استعراض أرصدة المخزون المتاحة في المستودعات.",
  },
  INVENTORY_MANAGE: {
    nameEn: "Manage Inventory Operations",
    nameAr: "إدارة حركات المخزون",
    descEn: "Post adjustments, receipts, and inventory counts.",
    descAr: "تسجيل تسويات وجرد وحركات التوريد للمخزون.",
  },
  INVENTORY_OVERRIDE: {
    nameEn: "Override Inventory Limits",
    nameAr: "تجاوز فحص المخزون",
    descEn: "Permit selling or committing items with zero warehouse stock.",
    descAr: "السماح بإصدار عروض وطلبات لأصناف برصيد صفري دون توقف.",
  },
  COST_ACCOUNTING_VIEW: {
    nameEn: "View Cost Accounting",
    nameAr: "عرض محاسبة التكاليف",
    descEn: "Inspect margins, landed costs, and accounting profitability.",
    descAr: "استعراض هوامش الربحية وتفاصيل التكاليف المحاسبية.",
  },
  PURCHASE_MANAGE: {
    nameEn: "Purchase Orders",
    nameAr: "إدارة المشتريات",
    descEn: "Manage supplier purchase orders and inbound shipments.",
    descAr: "إنشاء ومتابعة أوامر الشراء الصادرة للموردين والشحنات الواردة.",
  },
  STOREFRONT_MANAGE: {
    nameEn: "Storefront Management",
    nameAr: "إدارة المتجر الإلكتروني",
    descEn: "Manage published products, banners, and online store settings.",
    descAr: "إدارة الأصناف المعروضة بالمتجر واللافتات الترويجية والإعدادات.",
  },
};

export function getPermissionMeta(key: string): PermissionMeta {
  return (
    PERMISSION_METADATA[key] || {
      nameEn: key.replace(/_/g, " "),
      nameAr: key,
      descEn: `Permission: ${key}`,
      descAr: `صلاحية: ${key}`,
    }
  );
}
