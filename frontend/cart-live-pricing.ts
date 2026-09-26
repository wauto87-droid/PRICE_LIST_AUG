const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/;
const moneyInputPattern = /^\d{1,12}(?:\.\d{0,2})?$/;

const decimalField = (value: unknown) => String(value ?? "").trim();
const importedUnresolvedCustom = (line: any) =>
  line?.input?.type === "CUSTOM" &&
  line?.input?.importMeta?.source === "DELIVERY_NOTE" &&
  !decimalPattern.test(decimalField(line?.input?.unitPriceExcl));

// A short-lived delivery-import build stored the entered custom unit price in
// discount while leaving unitPriceExcl at zero. The combination is otherwise
// invalid (discount > 100), so it can be repaired without changing a valid
// quotation line.
export function recoverImportedCustomUnitPrice(input: any) {
  if (
    input?.type !== "CUSTOM" ||
    input?.importMeta?.source !== "DELIVERY_NOTE" ||
    input.markup !== undefined
  )
    return input;
  const discount = decimalField(input.discount);
  const unitPrice = decimalField(input.unitPriceExcl);
  if (
    !decimalPattern.test(discount) ||
    Number(discount) <= 100 ||
    !decimalPattern.test(unitPrice) ||
    Number(unitPrice) !== 0
  )
    return input;
  return {
    ...input,
    discount: "0",
    unitPriceExcl: discount,
    importMeta: {
      ...input.importMeta,
      unresolved: false,
      recoveredUnitPrice: true,
    },
  };
}

export function catalogLivePricingInput(line: any) {
  if (!line?.input || line.input?.type === "CUSTOM" || !line.productId)
    return null;
  const quantity = decimalField(line.input.quantity);
  const discount = decimalField(line.input.discount || "0");
  const markup =
    line.input.markup === undefined
      ? undefined
      : decimalField(line.input.markup || "0");
  if (
    !decimalPattern.test(quantity) ||
    !decimalPattern.test(discount) ||
    (markup !== undefined && !decimalPattern.test(markup))
  )
    return null;
  if (Number(discount) > 100) return null;
  if (line.targetPriceRequested)
    return {
      productId: line.productId,
      sellingLevel:
        line.input.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER",
      quantity,
      targetFinalExcl: line.targetPriceRequested,
      override: false,
      reason: "",
    };
  return {
    productId: line.productId,
    sellingLevel:
      line.input.sellingLevel ?? line.sellingLevel ?? "END_CUSTOMER",
    quantity,
    discount,
    ...(markup === undefined ? {} : { markup }),
    override: false,
    reason: "",
  };
}

export function normalizeTargetPrice(targetValue: unknown) {
  const targetRaw = decimalField(targetValue);
  if (!targetRaw)
    return {
      ok: false as const,
      error: "Enter a final unit price before VAT.",
    };
  if (!moneyInputPattern.test(targetRaw))
    return {
      ok: false as const,
      error:
        "Final price must be zero or positive, with no commas and at most two decimals.",
    };
  const [whole, fraction = ""] = targetRaw.split(".");
  return {
    ok: true as const,
    target: `${whole}.${fraction.padEnd(2, "0")}`,
  };
}

export function cartLineHasBlockingError(line: any) {
  if (!line?.input) return true;
  if (line.targetPriceError) return true;
  if (line.input?.type === "CUSTOM") {
    if (
      line.input.markup !== undefined &&
      !decimalPattern.test(decimalField(line.input.markup))
    )
      return true;
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
  if (
    line.price?.adjustmentMode &&
    (line.price.adjustmentMode === "MARKUP") !==
      (line.input.markup !== undefined)
  )
    return true;
  return !catalogLivePricingInput(line);
}

export function livePricingSignature(line: any) {
  const input = catalogLivePricingInput(line);
  if (!input) return "";
  return JSON.stringify([input]);
}
