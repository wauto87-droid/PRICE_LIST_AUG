import {
  calculate,
  type Calculation,
  type LevelCode,
  type ProductInput,
} from "@/backend/pricing/engine";

type LookupLevel = {
  code: LevelCode;
  masterExcl: string;
};

type LookupProduct = {
  id: string;
  partNumber: string;
  description: string;
  brand?: string;
  category?: string;
  unit?: string;
  quantityPrecision?: number;
  vat?: string;
  masterExcl?: string;
  defaultLevel?: LevelCode;
  sellingLevels?: LookupLevel[];
  minimumEnabled?: boolean;
  minimum?: string;
  maxDiscount?: string;
};

type LookupUser = {
  maxDiscount?: string;
};

export type LookupLineRequest = {
  productId: string;
  sellingLevel: LevelCode;
  quantity: string;
  discount: string;
  override: boolean;
  reason: string;
};

const draftDecimal = /^\d+(\.\d*)?$/;

function normalizeDraftDecimal(value: string, blankValue: string | null) {
  const trimmed = value.trim();
  if (!trimmed) return blankValue;
  if (!draftDecimal.test(trimmed)) return null;
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

function defaultLookupLevels(product: LookupProduct) {
  return (
    product.sellingLevels?.length
      ? product.sellingLevels
      : [
          {
            code: product.defaultLevel ?? "END_CUSTOMER",
            masterExcl: product.masterExcl ?? "0",
          },
        ]
  ).map((level) => ({
    code: level.code,
    active: true,
    method: "FIXED" as const,
    fixedPrice: level.masterExcl,
    markup: "0",
    listPrice: "0",
    baseDiscount: "0",
  }));
}

function toPreviewProduct(product: LookupProduct): ProductInput {
  return {
    partNumber: product.partNumber,
    description: product.description,
    brand: product.brand ?? "",
    category: product.category ?? "",
    keywords: "",
    aliases: [],
    method: "LIST_DISCOUNT",
    cost: "0",
    markup: "0",
    listPrice: product.masterExcl ?? "0",
    baseDiscount: "0",
    vat: product.vat ?? "15",
    minimumEnabled:
      product.minimumEnabled === true && typeof product.minimum === "string",
    minimum: typeof product.minimum === "string" ? product.minimum : "0",
    unit: product.unit ?? "pcs",
    quantityPrecision: product.quantityPrecision ?? 0,
    active: true,
    defaultLevel: product.defaultLevel ?? "END_CUSTOMER",
    levels: defaultLookupLevels(product),
  };
}

function previewPolicy(product: LookupProduct, user: LookupUser) {
  return {
    maxDiscount:
      typeof product.maxDiscount === "string" && product.maxDiscount
        ? product.maxDiscount
        : String(user.maxDiscount ?? "100"),
    canOverride: false,
  };
}

export function normalizeLookupDiscountInput(value: string) {
  return normalizeDraftDecimal(value, "0");
}

export function normalizeLookupQuantityInput(value: string) {
  return normalizeDraftDecimal(value, null);
}

export function buildLookupLineRequest(
  productId: string,
  sellingLevel: LevelCode,
  quantity: string,
  discount: string,
): LookupLineRequest {
  const normalizedQuantity = normalizeLookupQuantityInput(quantity);
  const normalizedDiscount = normalizeLookupDiscountInput(discount);
  if (!normalizedQuantity)
    throw new Error("Quantity must be a positive decimal value");
  if (!normalizedDiscount)
    throw new Error("Discount must be a positive decimal value");
  return {
    productId,
    sellingLevel,
    quantity: normalizedQuantity,
    discount: normalizedDiscount,
    override: false,
    reason: "",
  };
}

export function previewLookupPrice(
  product: LookupProduct,
  user: LookupUser,
  input: Omit<LookupLineRequest, "productId">,
): Calculation {
  return calculate(toPreviewProduct(product), previewPolicy(product, user), input);
}
