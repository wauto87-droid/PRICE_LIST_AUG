import {
  productInput,
  sellingLevels,
  levelInput,
  type ProductInput,
} from "./engine";
export const codes = ["WHOLESALE", "RETAIL", "END_CUSTOMER"] as const;
export const levelFields = [
  "active",
  "method",
  "fixedPrice",
  "markup",
  "listPrice",
  "baseDiscount",
] as const;
export const tierColumns = codes.flatMap((code) =>
  levelFields.map((field) => `${code}.${field}`),
);
const booleanValue = (v: unknown) =>
  typeof v === "string"
    ? ["true", "1", "yes", "on"].includes(v.toLowerCase())
    : v;
// Blank/unmapped cells never remove levels or reset an existing product's defaults.
export function importCandidate(
  mapped: Record<string, any>,
  defaults: Record<string, any>,
  existing?: ProductInput,
  applyPricingDefaultsToExisting = false,
) {
  const pricingDefaults = applyPricingDefaultsToExisting
    ? Object.fromEntries(
        [
          "method",
          "markup",
          "listPrice",
          "baseDiscount",
          "vat",
          ...tierColumns.filter((key) => key.startsWith("END_CUSTOMER.")),
        ].flatMap((key) =>
          defaults[key] === undefined ? [] : [[key, defaults[key]]],
        ),
      )
    : {};
  const pricingInputs = { ...pricingDefaults, ...mapped };
  const p: Record<string, any> = {
    ...(existing ?? defaults),
    ...pricingDefaults,
    ...mapped,
  };
  for (const key of ["active", "minimumEnabled"])
    if (p[key] !== undefined) p[key] = booleanValue(p[key]);
  if (p.quantityPrecision !== undefined)
    p.quantityPrecision = Number(p.quantityPrecision);
  if (typeof p.aliases === "string")
    p.aliases = p.aliases.split("|").filter(Boolean);
  const changes = codes.flatMap((code) => {
    const values: Record<string, any> = {};
    const sellingPrice = p[`${code}.sellingPrice`];
    delete p[`${code}.sellingPrice`];
    if (sellingPrice !== undefined && sellingPrice !== "") {
      values.method = "FIXED";
      values.fixedPrice = sellingPrice;
    }
    for (const field of levelFields) {
      const key = `${code}.${field}`;
      if (p[key] !== undefined && p[key] !== "")
        values[field] = field === "active" ? booleanValue(p[key]) : p[key];
      delete p[key];
    }
    return Object.keys(values).length ? [{ code, ...values }] : [];
  });
  if (existing || changes.length) {
    const levels = existing
      ? sellingLevels(existing).map((l) => ({ ...l }))
      : [];
    if (
      existing &&
      ["method", "markup", "listPrice", "baseDiscount"].some(
        (k) => pricingInputs[k] !== undefined,
      )
    ) {
      const current = levels.find((l) => l.code === existing.defaultLevel)!;
      if (pricingInputs.method !== undefined)
        current.method = pricingInputs.method;
      for (const k of ["markup", "listPrice", "baseDiscount"] as const)
        if (pricingInputs[k] !== undefined) current[k] = pricingInputs[k];
      if (current.method === "FIXED" && pricingInputs.listPrice !== undefined)
        current.fixedPrice = pricingInputs.listPrice;
    }
    for (const change of changes) {
      const index = levels.findIndex((l) => l.code === change.code);
      const next = levelInput.parse({
        ...(index >= 0 ? levels[index] : {}),
        ...change,
      });
      if (index < 0) levels.push(next);
      else levels[index] = next;
    }
    p.levels = levels;
  }
  return productInput.parse(p);
}
export function exportLevelValues(p: ProductInput, includeCosts: boolean) {
  const values: Record<string, any> = {
    defaultLevel: p.defaultLevel ?? "END_CUSTOMER",
  };
  for (const level of sellingLevels(p)) {
    if (includeCosts)
      for (const field of levelFields)
        values[`${level.code}.${field}`] = level[field];
  }
  return values;
}
