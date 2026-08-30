import Decimal from "decimal.js";
import { z } from "zod";
Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
export const decimal = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Use a positive decimal, without commas");
export const percent = decimal.refine(
  (v) => new Decimal(v).lte(100),
  "Maximum is 100%",
);
export const levelCode = z.enum(["WHOLESALE", "RETAIL", "END_CUSTOMER"]);
export type LevelCode = z.infer<typeof levelCode>;
export const levelInput = z
  .object({
    code: levelCode,
    active: z.boolean().default(true),
    method: z.enum(["FIXED", "COST_MARKUP", "LIST_DISCOUNT"]),
    fixedPrice: decimal.default("0"),
    markup: decimal.default("0"),
    listPrice: decimal.default("0"),
    baseDiscount: percent.default("0"),
  })
  .strict();
export type SellingLevel = z.infer<typeof levelInput>;
export const productInput = z
  .object({
    partNumber: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1000),
    brand: z.string().trim().max(100).default(""),
    category: z.string().trim().max(100).default(""),
    keywords: z.string().max(500).default(""),
    aliases: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    method: z.enum(["COST_MARKUP", "LIST_DISCOUNT"]).default("COST_MARKUP"),
    cost: decimal.default("0"),
    markup: decimal.default("0"),
    listPrice: decimal.default("0"),
    baseDiscount: percent.default("0"),
    vat: percent.default("15"),
    minimumEnabled: z.boolean().default(false),
    minimum: decimal.default("0"),
    unit: z.string().trim().min(1).max(20).default("pcs"),
    quantityPrecision: z.number().int().min(0).max(3).default(0),
    active: z.boolean().default(true),
    levels: z.array(levelInput).min(1).max(3).optional(),
    defaultLevel: levelCode.optional(),
  })
  .strict();
export type ProductInput = z.infer<typeof productInput>;
export type PricePolicy = { maxDiscount: string; canOverride: boolean };
export const lineInput = z
  .object({
    productId: z.string().uuid(),
    sellingLevel: levelCode.optional(),
    quantity: decimal,
    discount: percent.default("0"),
    override: z.boolean().default(false),
    reason: z.string().trim().max(500).default(""),
  })
  .strict();
export type LineInput = z.infer<typeof lineInput>;
export const customLineInput = z
  .object({
    type: z.literal("CUSTOM"),
    partNumber: z.string().trim().max(100).default(""),
    description: z.string().trim().min(1).max(1000),
    unit: z.string().trim().min(1).max(20).default("pcs"),
    quantity: decimal,
    unitPriceExcl: decimal,
    discount: percent.default("0"),
    vat: percent.optional(),
    reusableItemId: z.string().uuid().optional(),
  })
  .strict();
export type CustomLineInput = z.infer<typeof customLineInput>;
export const money = (value: Decimal.Value) =>
  new Decimal(value).toDecimalPlaces(2).toFixed(2);
export const normalizePart = (value: string) =>
  value.normalize("NFKC").trim().toUpperCase();
export function sellingLevels(p: ProductInput): SellingLevel[] {
  return (
    p.levels ?? [
      {
        code: "END_CUSTOMER",
        active: true,
        method: p.method,
        fixedPrice: "0",
        markup: p.markup,
        listPrice: p.listPrice,
        baseDiscount: p.baseDiscount,
      },
    ]
  );
}
export function selectedLevel(p: ProductInput, code?: LevelCode): SellingLevel {
  const level = sellingLevels(p).find(
    (l) => l.code === (code ?? p.defaultLevel ?? "END_CUSTOMER") && l.active,
  );
  if (!level)
    throw new Error(
      "Selected selling level is unavailable. Select an active level and review pricing again",
    );
  return level;
}
export function levelPrice(p: ProductInput, level: SellingLevel) {
  return new Decimal(
    money(
      level.method === "FIXED"
        ? level.fixedPrice
        : level.method === "COST_MARKUP"
          ? new Decimal(p.cost).mul(
              new Decimal(1).add(new Decimal(level.markup).div(100)),
            )
          : new Decimal(level.listPrice).mul(
              new Decimal(1).sub(new Decimal(level.baseDiscount).div(100)),
            ),
    ),
  );
}
export function masterPrice(p: ProductInput, code?: LevelCode) {
  return levelPrice(p, selectedLevel(p, code));
}
/* Legacy product fields mirror the default level for older clients and exports. */
export function canonicalProduct(p: ProductInput): ProductInput {
  const level = selectedLevel(p);
  return {
    ...p,
    levels: sellingLevels(p),
    defaultLevel: level.code,
    method: level.method === "FIXED" ? "LIST_DISCOUNT" : level.method,
    markup: level.markup,
    listPrice: level.method === "FIXED" ? level.fixedPrice : level.listPrice,
    baseDiscount: level.method === "FIXED" ? "0" : level.baseDiscount,
  };
}
export function validateProduct(p: ProductInput) {
  if (p.levels && !p.defaultLevel)
    throw new Error("Select a default selling level");
  const levels = sellingLevels(p);
  if (new Set(levels.map((l) => l.code)).size !== levels.length)
    throw new Error("Duplicate selling level");
  selectedLevel(p);
  for (const level of levels) {
    if (levelPrice(p, level).gt("999999999999.99"))
      throw new Error("Calculated master price exceeds the supported range");
    if (
      level.active &&
      p.minimumEnabled &&
      new Decimal(p.minimum).gt(levelPrice(p, level))
    )
      throw new Error(
        "Minimum price cannot exceed master price for " + level.code,
      );
  }
  if (new Decimal(p.minimum).decimalPlaces() > 2)
    throw new Error("Minimum price supports two decimal places");
  return p;
}
export function calculate(
  p: ProductInput,
  policy: PricePolicy,
  input: Pick<
    LineInput,
    "quantity" | "discount" | "override" | "reason" | "sellingLevel"
  >,
) {
  validateProduct(p);
  const qty = new Decimal(input.quantity);
  if (
    !qty.gt(0) ||
    qty.gt(1000000) ||
    qty.decimalPlaces() > p.quantityPrecision
  )
    throw new Error(
      `Quantity must be positive with at most ${p.quantityPrecision} decimals`,
    );
  const requested = new Decimal(input.discount);
  if (requested.lt(0) || requested.gt(100))
    throw new Error("Discount must be between 0 and 100");
  const unrestricted = !p.minimumEnabled || new Decimal(p.minimum).isZero();
  const effectiveLimit = unrestricted
    ? new Decimal(100)
    : new Decimal(policy.maxDiscount);
  const allowed = Decimal.min(requested, effectiveLimit);
  const level = selectedLevel(p, input.sellingLevel);
  const master = levelPrice(p, level);
  let final = new Decimal(
    money(master.mul(new Decimal(1).sub(allowed.div(100)))),
  );
  let overridden = false;
  const below = p.minimumEnabled && final.lt(p.minimum);
  if (input.override) {
    if (!policy.canOverride)
      throw new Error("Minimum price override is not permitted");
    if (!input.reason.trim()) throw new Error("Override reason is required");
    overridden = below;
  }
  if (below && !overridden) final = new Decimal(p.minimum);
  const subtotal = money(final.mul(qty));
  const vatAmount = money(new Decimal(subtotal).mul(p.vat).div(100));
  const unitVat = money(final.mul(p.vat).div(100));
  return {
    sellingLevel: level.code,
    masterExcl: master.toFixed(2),
    masterIncl: money(
      master.mul(new Decimal(1).add(new Decimal(p.vat).div(100))),
    ),
    requestedDiscount: requested.toString(),
    allowedDiscount: allowed.toString(),
    effectiveDiscount: master.isZero()
      ? "0"
      : master.sub(final).div(master).mul(100).toDecimalPlaces(6).toString(),
    finalExcl: final.toFixed(2),
    finalIncl: money(final.add(unitVat)),
    vatRate: new Decimal(p.vat).toString(),
    vatAmount,
    subtotal,
    total: money(new Decimal(subtotal).add(vatAmount)),
    quantity: qty.toString(),
    minimumReached: below && !overridden,
    discountLimited: allowed.lt(requested),
    discountLimitSource: unrestricted
      ? ("ZERO_FLOOR" as const)
      : ("ROLE_LIMIT" as const),
    overridden,
    maxDiscount: master.isZero()
      ? unrestricted
        ? "100"
        : "0"
      : Decimal.min(
          effectiveLimit,
          p.minimumEnabled && !policy.canOverride
            ? master.sub(p.minimum).div(master).mul(100)
            : 100,
        )
          .toDecimalPlaces(6)
          .toString(),
  };
}
export type Calculation = ReturnType<typeof calculate>;
export function calculateCustom(
  input: CustomLineInput,
  vat: string,
  quantityPrecision = 6,
) {
  const parsed = customLineInput.parse(input);
  const qty = new Decimal(parsed.quantity);
  if (!qty.gt(0) || qty.gt(1000000) || qty.decimalPlaces() > quantityPrecision)
    throw new Error(
      `Quantity must be positive with at most ${quantityPrecision} decimals`,
    );
  const rate = percent.parse(vat);
  const master = new Decimal(parsed.unitPriceExcl);
  const requested = new Decimal(parsed.discount);
  const final = new Decimal(
    money(master.mul(new Decimal(1).sub(requested.div(100)))),
  );
  const subtotal = money(final.mul(qty));
  const vatAmount = money(new Decimal(subtotal).mul(rate).div(100));
  return {
    sellingLevel: "CUSTOM" as const,
    masterExcl: master.toFixed(2),
    masterIncl: money(
      master.mul(new Decimal(1).add(new Decimal(rate).div(100))),
    ),
    requestedDiscount: requested.toString(),
    allowedDiscount: requested.toString(),
    effectiveDiscount: requested.toString(),
    finalExcl: final.toFixed(2),
    finalIncl: money(final.mul(new Decimal(1).add(new Decimal(rate).div(100)))),
    vatRate: new Decimal(rate).toString(),
    vatAmount,
    subtotal,
    total: money(new Decimal(subtotal).add(vatAmount)),
    quantity: qty.toString(),
    minimumReached: false,
    discountLimited: false,
    discountLimitSource: "CUSTOM" as const,
    overridden: false,
    maxDiscount: "100",
  };
}
export function totals(
  lines: { subtotal: string; vatAmount: string; total: string }[],
) {
  const sum = (key: "subtotal" | "vatAmount" | "total") =>
    money(lines.reduce((a, l) => a.add(l[key]), new Decimal(0)));
  return {
    subtotal: sum("subtotal"),
    vat: sum("vatAmount"),
    total: sum("total"),
  };
}
