const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/;

const decimalField = (value: unknown) => String(value ?? "").trim();

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

export function cartLineHasBlockingError(line: any) {
  if (!line?.input) return true;
  if (line.input?.type === "CUSTOM") {
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
