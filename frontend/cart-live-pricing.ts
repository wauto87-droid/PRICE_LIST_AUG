import Decimal from "decimal.js";

const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/;
const moneyInputPattern = /^\d{1,12}(?:\.\d{0,2})?$/;

const decimalField = (value: unknown) => String(value ?? "").trim();
const importedUnresolvedCustom = (line: any) =>
  line?.input?.type === "CUSTOM" &&
  line?.input?.importMeta?.source === "DELIVERY_NOTE" &&
  !decimalPattern.test(decimalField(line?.input?.unitPriceExcl));

export function catalogLivePricingInput(line: any) {
  if (!line?.input || line.input?.type === "CUSTOM" || !line.productId)
    return null;
  const quantity = decimalField(line.input.quantity);
  const discount = decimalField(line.input.discount || "0");
  if (!decimalPattern.test(quantity) || !decimalPattern.test(discount))
    return null;
  if (Number(discount) > 100) return null;
  return {
    productId: line.productId,
    sellingLevel:
      line.input.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER",
    quantity,
    discount,
    override: false,
    reason: "",
  };
}

export function discountForTargetPrice(masterValue: unknown, targetValue: unknown) {
  const masterRaw = decimalField(masterValue);
  const targetRaw = decimalField(targetValue);
  if (!targetRaw)
    return { ok: false as const, error: "Enter a final unit price before VAT." };
  if (!moneyInputPattern.test(targetRaw))
    return {
      ok: false as const,
      error: "Final price must be zero or positive, with no commas and at most two decimals.",
    };
  if (!decimalPattern.test(masterRaw))
    return { ok: false as const, error: "The selected selling-level price is unavailable." };
  const master = new Decimal(masterRaw);
  const target = new Decimal(targetRaw.endsWith(".") ? targetRaw.slice(0, -1) : targetRaw);
  if (target.gt(master))
    return {
      ok: true as const,
      target: target.toFixed(2),
      discount: "0",
      aboveBase: true,
    };
  if (master.isZero())
    return {
      ok: true as const,
      target: "0.00",
      discount: "0",
      aboveBase: false,
    };
  return {
    ok: true as const,
    target: target.toFixed(2),
    discount: master
      .minus(target)
      .div(master)
      .mul(100)
      .toDecimalPlaces(6)
      .toString(),
    aboveBase: false,
  };
}

export function cartLineHasBlockingError(line: any) {
  if (!line?.input) return true;
  if (line.targetPriceError) return true;
  if (line.input?.type === "CUSTOM") {
    if (importedUnresolvedCustom(line))
      return (
        !String(line.input.description ?? "").trim() ||
        !decimalPattern.test(decimalField(line.input.quantity)) ||
        !decimalPattern.test(decimalField(line.input.discount || "0")) ||
        Number(decimalField(line.input.discount || "0")) > 100
      );
    return (
      !String(line.input.description ?? "").trim() ||
      !decimalPattern.test(decimalField(line.input.quantity)) ||
      !decimalPattern.test(decimalField(line.input.unitPriceExcl)) ||
      !decimalPattern.test(decimalField(line.input.discount || "0")) ||
      Number(decimalField(line.input.discount || "0")) > 100
    );
  }
  return !catalogLivePricingInput(line);
}

export function livePricingSignature(line: any) {
  const input = catalogLivePricingInput(line);
  if (!input) return "";
  return JSON.stringify([
    input.productId,
    input.sellingLevel,
    input.quantity,
    input.discount,
  ]);
}
